require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const OpenAI = require('openai');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const { extractVideoIdFromFilename } = require('./videoDownloader.js');

const execAsync = promisify(exec);

// Configuration from environment variables
const config = {
    outputFolder: process.env.OUTPUT_FOLDER || './downloads',
    vttOutputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles',
    openaiApiKey: process.env.OPENAI_API_KEY,
    whisperModel: process.env.WHISPER_MODEL || 'base',
    silenceThreshold: parseFloat(process.env.SILENCE_THRESHOLD) || 0.01,
    musicDetectionEnabled: process.env.MUSIC_DETECTION_ENABLED === 'true',
    forceLanguage: process.env.FORCE_LANGUAGE || null // Set to 'en', 'ar', etc. to force a language, or null for auto-detect
};

// Initialize OpenAI client if API key is provided
let openai = null;
if (config.openaiApiKey) {
    openai = new OpenAI({
        apiKey: config.openaiApiKey
    });
}

/**
 * Checks if local Whisper is installed
 */
async function checkWhisperInstalled() {
    try {
        await execAsync('which whisper');
        return true;
    } catch (error) {
        try {
            await execAsync('whisper --help');
            return true;
        } catch (error2) {
            return false;
        }
    }
}

/**
 * Ensures the VTT output directory exists
 */
function ensureVttOutputDirectory() {
    if (!fs.existsSync(config.vttOutputFolder)) {
        fs.mkdirSync(config.vttOutputFolder, { recursive: true });
        console.log(`Created VTT output directory: ${config.vttOutputFolder}`);
    }
    return config.vttOutputFolder;
}

/**
 * Converts seconds to VTT timestamp format (HH:MM:SS.mmm)
 */
function secondsToVttTimestamp(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

/**
 * Extracts video information from filename
 */
function parseVideoFilename(filename) {
    const videoId = extractVideoIdFromFilename(filename);
    if (videoId) {
        // New format: [videoId]_title.mp4
        const titlePart = filename.replace(/^\[[^\]]+\]_/, '').replace(/\.mp4$/, '');
        return { videoId, title: titlePart, hasVideoId: true };
    } else {
        // Old format: title.mp4
        const titlePart = filename.replace(/\.mp4$/, '');
        return { videoId: null, title: titlePart, hasVideoId: false };
    }
}

/**
 * Extracts audio from video file using ffmpeg
 */
async function extractAudio(videoPath, outputAudioPath) {
    return new Promise((resolve, reject) => {
        console.log(`🎵 Extracting audio from: ${path.basename(videoPath)}`);
        
        ffmpeg(videoPath)
            .audioCodec('pcm_s16le')
            .audioFrequency(16000)
            .audioChannels(1)
            .format('wav')
            .on('end', () => {
                console.log(`✅ Audio extracted to: ${outputAudioPath}`);
                resolve(outputAudioPath);
            })
            .on('error', (err) => {
                console.error(`❌ Error extracting audio:`, err.message);
                reject(err);
            })
            .save(outputAudioPath);
    });
}

/**
 * Analyzes audio for silent segments and music detection
 */
async function analyzeAudio(audioPath) {
    return new Promise((resolve, reject) => {
        console.log(`🔍 Analyzing audio for silence and music detection...`);
        
        const silenceSegments = [];
        const musicSegments = [];
        
        // Use ffmpeg to detect silence
        const silenceDetection = ffmpeg(audioPath)
            .audioFilters([
                `silencedetect=noise=${config.silenceThreshold}:duration=1.0`
            ])
            .format('null')
            .on('stderr', (stderrLine) => {
                // Parse silence detection output
                const silenceStartMatch = stderrLine.match(/silence_start: (\d+\.?\d*)/);
                const silenceEndMatch = stderrLine.match(/silence_end: (\d+\.?\d*)/);
                
                if (silenceStartMatch) {
                    const startTime = parseFloat(silenceStartMatch[1]);
                    silenceSegments.push({ start: startTime, end: null });
                }
                
                if (silenceEndMatch && silenceSegments.length > 0) {
                    const endTime = parseFloat(silenceEndMatch[1]);
                    const lastSegment = silenceSegments[silenceSegments.length - 1];
                    if (lastSegment.end === null) {
                        lastSegment.end = endTime;
                    }
                }
            })
            .on('end', () => {
                console.log(`📊 Found ${silenceSegments.length} silence segments`);
                
                if (config.musicDetectionEnabled) {
                    console.log(`🎼 Music detection enabled (simplified heuristic)`);
                }
                
                resolve({ silenceSegments, musicSegments });
            })
            .on('error', (err) => {
                console.error(`❌ Error analyzing audio:`, err.message);
                reject(err);
            });
        
        // Save to null (we just want the analysis, not the output)
        silenceDetection.save('/dev/null');
    });
}

/**
 * Transcribes audio using local Whisper (auto-detect language or forced language)
 */
async function transcribeWithLocalWhisper(audioPath, forceLanguage = null) {
    const languageInfo = forceLanguage ? `forced to ${forceLanguage}` : 'auto-detected';
    console.log(`🎤 Transcribing with local Whisper (${config.whisperModel} model, language ${languageInfo})...`);
    
    const whisperInstalled = await checkWhisperInstalled();
    
    if (!whisperInstalled) {
        console.log(`❌ Local Whisper not found.`);
        return {
            text: '[Local Whisper not installed]',
            segments: [{
                start: 0,
                end: 10,
                text: '[Local Whisper not installed]'
            }],
            language: 'unknown'
        };
    }
    
    return new Promise((resolve, reject) => {
        const outputDir = path.dirname(audioPath);
        const baseFilename = path.basename(audioPath, path.extname(audioPath));
        
        console.log(`📝 Running whisper transcription...`);
        
        // Build whisper command
        const whisperArgs = [
            audioPath,
            '--model', config.whisperModel,
            '--output_format', 'json',
            '--output_dir', outputDir,
            '--task', 'transcribe'
        ];
        
        // Add language parameter if forced
        if (forceLanguage) {
            whisperArgs.push('--language', forceLanguage);
        }
        
        console.log(`🔄 Executing: whisper ${whisperArgs.join(' ')}`);
        
        const whisperProcess = spawn('whisper', whisperArgs);
        
        let stdout = '';
        let stderr = '';
        
        whisperProcess.stdout.on('data', (data) => {
            stdout += data.toString();
            const progressMatch = data.toString().match(/(\d+)%/);
            if (progressMatch) {
                process.stdout.write(`\r🎤 Transcribing: ${progressMatch[1]}%`);
            }
        });
        
        whisperProcess.stderr.on('data', (data) => {
            stderr += data.toString();
            const progressMatch = data.toString().match(/(\d+)%/);
            if (progressMatch) {
                process.stdout.write(`\r🎤 Transcribing: ${progressMatch[1]}%`);
            }
        });
        
        whisperProcess.on('close', (code) => {
            console.log(`\n🎤 Whisper transcription completed (exit code: ${code})`);
            
            if (code !== 0) {
                console.error(`❌ Whisper failed with exit code ${code}`);
                resolve({
                    text: '[Whisper transcription failed]',
                    segments: [{
                        start: 0,
                        end: 10,
                        text: '[Whisper transcription failed]'
                    }],
                    language: 'unknown'
                });
                return;
            }
            
            try {
                // Find the JSON output file (Whisper creates filename based on input)
                const audioBasename = path.basename(audioPath, path.extname(audioPath));
                const generatedJsonPath = path.join(outputDir, `${audioBasename}.json`);
                
                if (fs.existsSync(generatedJsonPath)) {
                    const jsonContent = fs.readFileSync(generatedJsonPath, 'utf8');
                    const transcription = JSON.parse(jsonContent);
                    
                    console.log(`✅ Transcription loaded (detected language: ${transcription.language || 'unknown'})`);
                    
                    // Clean up JSON file
                    fs.unlinkSync(generatedJsonPath);
                    
                    // Convert Whisper format to standardized format
                    const convertedTranscription = {
                        text: transcription.text,
                        segments: transcription.segments || [],
                        language: transcription.language || 'unknown'
                    };
                    
                    resolve(convertedTranscription);
                } else {
                    console.error(`❌ JSON output file not found`);
                    resolve({
                        text: '[Transcription file not found]',
                        segments: [{
                            start: 0,
                            end: 10,
                            text: '[Transcription file not found]'
                        }],
                        language: 'unknown'
                    });
                }
            } catch (error) {
                console.error(`❌ Error reading transcription JSON:`, error.message);
                resolve({
                    text: '[Error processing transcription]',
                    segments: [{
                        start: 0,
                        end: 10,
                        text: '[Error processing transcription]'
                    }],
                    language: 'unknown'
                });
            }
        });
        
        whisperProcess.on('error', (error) => {
            console.error(`❌ Failed to start whisper process:`, error.message);
            resolve({
                text: '[Failed to start Whisper]',
                segments: [{
                    start: 0,
                    end: 10,
                    text: '[Failed to start Whisper]'
                }],
                language: 'unknown'
            });
        });
    });
}

/**
 * Transcribes audio using OpenAI Whisper API
 */
async function transcribeWithOpenAI(audioPath) {
    console.log(`🎤 Transcribing with OpenAI Whisper API...`);
    
    try {
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: 'whisper-1',
            response_format: 'verbose_json',
            timestamp_granularities: ['segment']
        });
        
        return {
            text: transcription.text,
            segments: transcription.segments || [],
            language: transcription.language || 'unknown'
        };
    } catch (error) {
        console.error(`❌ OpenAI Whisper API error:`, error.message);
        throw error;
    }
}

/**
 * Generates VTT content from transcription and audio analysis
 */
function generateVttContent(transcription, audioAnalysis, videoInfo) {
    console.log(`📝 Generating VTT content (detected language: ${transcription.language})...`);
    
    let vttContent = 'WEBVTT\n';
    
    // Add metadata comments with video information
    if (videoInfo.hasVideoId) {
        vttContent += `NOTE Video ID: ${videoInfo.videoId}\n`;
        vttContent += `NOTE Title: ${videoInfo.title}\n`;
    }
    vttContent += `NOTE Language: ${transcription.language}\n`;
    vttContent += `NOTE Generated by API.video VTT Generator\n`;
    vttContent += `NOTE Music Detection: ${config.musicDetectionEnabled ? 'Enabled' : 'Disabled'}\n`;
    vttContent += `NOTE Silence Threshold: ${config.silenceThreshold}\n\n`;
    
    if (!transcription.segments || transcription.segments.length === 0) {
        // Fallback for simple transcription
        vttContent += `1\n`;
        vttContent += `00:00:00.000 --> 00:00:10.000\n`;
        vttContent += `${transcription.text || 'No transcription available'}\n\n`;
        return vttContent;
    }
    
    transcription.segments.forEach((segment, index) => {
        const startTime = secondsToVttTimestamp(segment.start);
        const endTime = secondsToVttTimestamp(segment.end);
        let text = segment.text.trim();
        
        // Check if this segment overlaps with silence
        const isInSilence = audioAnalysis.silenceSegments.some(silence => 
            silence.start <= segment.start && silence.end >= segment.end
        );
        
        // Check if this segment might be music (simplified heuristic)
        const mightBeMusic = config.musicDetectionEnabled && (
            text.match(/♪|♫|🎵|music|instrumental|♬/i) ||
            text.length < 10 && !text.match(/\w{3,}/) // Very short non-word content
        );
        
        // Add special markers for music and silence
        if (mightBeMusic) {
            text = `♪ ${text} ♪`;
        }
        
        if (isInSilence && text.trim().length === 0) {
            text = '[Silence]';
        }
        
        // Add warning for potentially music segments
        if (mightBeMusic && config.musicDetectionEnabled) {
            text += ' [Possible Music]';
        }
        
        vttContent += `${index + 1}\n`;
        vttContent += `${startTime} --> ${endTime}\n`;
        vttContent += `${text}\n\n`;
    });
    
    return vttContent;
}

/**
 * Generates VTT file for a single video
 */
async function generateVttForVideo(videoPath) {
    const videoFilename = path.basename(videoPath);
    const videoInfo = parseVideoFilename(videoFilename);
    
    // Create VTT filename (original language)
    let vttFilename;
    if (videoInfo.hasVideoId) {
        vttFilename = `[${videoInfo.videoId}]_${videoInfo.title}.vtt`;
    } else {
        vttFilename = `${videoInfo.title}.vtt`;
    }
    
    const audioPath = path.join(config.vttOutputFolder, `${videoInfo.title}_temp.wav`);
    const vttPath = path.join(config.vttOutputFolder, vttFilename);
    
    console.log(`\n🎬 Processing: ${videoInfo.title}`);
    if (videoInfo.hasVideoId) {
        console.log(`🆔 Video ID: ${videoInfo.videoId}`);
    }
    
    // Check if VTT already exists
    if (fs.existsSync(vttPath)) {
        console.log(`⏭️  VTT already exists: ${vttFilename}`);
        return vttPath;
    }
    
    try {
        // Step 1: Extract audio
        await extractAudio(videoPath, audioPath);
        
        // Step 2: Analyze audio for silence and music
        const audioAnalysis = await analyzeAudio(audioPath);
        
        // Step 3: Transcribe audio
        let transcription;
        const whisperInstalled = await checkWhisperInstalled();
        
        if (whisperInstalled) {
            console.log(`🎤 Using local Whisper for transcription`);
            transcription = await transcribeWithLocalWhisper(audioPath, config.forceLanguage);
        } else if (openai) {
            console.log(`🎤 Local Whisper not found, using OpenAI API`);
            transcription = await transcribeWithOpenAI(audioPath);
        } else {
            console.log(`❌ No transcription method available`);
            transcription = {
                text: "[No transcription available - install Whisper or set OpenAI API key]",
                segments: [{
                    start: 0,
                    end: 10,
                    text: "[No transcription available - install Whisper or set OpenAI API key]"
                }],
                language: 'unknown'
            };
        }
        
        // Step 4: Generate VTT content
        const vttContent = generateVttContent(transcription, audioAnalysis, videoInfo);
        
        // Step 5: Save VTT file
        fs.writeFileSync(vttPath, vttContent, 'utf8');
        console.log(`✅ VTT generated: ${vttFilename} (language: ${transcription.language})`);
        if (videoInfo.hasVideoId) {
            console.log(`💡 Ready for translation or direct caption upload`);
        }
        
        // Step 6: Cleanup temporary audio file
        if (fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
            console.log(`🗑️  Cleaned up temporary audio file`);
        }
        
        return vttPath;
        
    } catch (error) {
        console.error(`❌ Error generating VTT for ${videoInfo.title}:`, error.message);
        
        // Cleanup on error
        if (fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
        }
        
        throw error;
    }
}

/**
 * Generates VTT files for all videos in the downloads folder
 */
async function generateVttForAllVideos() {
    ensureVttOutputDirectory();
    
    const downloadsDir = config.outputFolder;
    
    if (!fs.existsSync(downloadsDir)) {
        console.error(`❌ Downloads directory not found: ${downloadsDir}`);
        return;
    }
    
    const videoFiles = fs.readdirSync(downloadsDir)
        .filter(file => file.toLowerCase().endsWith('.mp4'))
        .map(file => path.join(downloadsDir, file));
    
    if (videoFiles.length === 0) {
        console.log(`📭 No video files found in ${downloadsDir}`);
        return;
    }
    
    console.log(`🎬 Found ${videoFiles.length} video files to process`);
    console.log(`📂 VTT files will be saved to: ${config.vttOutputFolder}`);
    
    let successCount = 0;
    let failureCount = 0;
    
    for (let i = 0; i < videoFiles.length; i++) {
        const videoFile = videoFiles[i];
        try {
            console.log(`\n📹 Processing ${i + 1}/${videoFiles.length}: ${path.basename(videoFile)}`);
            await generateVttForVideo(videoFile);
            successCount++;
        } catch (error) {
            console.error(`❌ Failed to process ${path.basename(videoFile)}:`, error.message);
            failureCount++;
        }
        
        // Add delay between processing to avoid overwhelming the system
        if (i < videoFiles.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    console.log(`\n📊 VTT Generation Summary:`);
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failureCount}`);
    console.log(`📁 VTT files location: ${config.vttOutputFolder}`);
    console.log(`\n💡 Next step: Use vttTranslator.js to create multi-language versions!`);
}

/**
 * Main function for VTT generation
 */
async function main() {
    try {
        console.log('🎬 Starting VTT generation process...');
        console.log(`📂 Video source: ${config.outputFolder}`);
        console.log(`📂 VTT destination: ${config.vttOutputFolder}`);
        console.log(`🤖 Whisper model: ${config.whisperModel}`);
        console.log(`🔇 Silence threshold: ${config.silenceThreshold}`);
        console.log(`🎵 Music detection: ${config.musicDetectionEnabled ? 'Enabled' : 'Disabled'}`);
        console.log(`🌐 Language mode: ${config.forceLanguage ? `Forced to ${config.forceLanguage}` : 'Auto-detect'}`);
        
        // Check available transcription methods
        const whisperInstalled = await checkWhisperInstalled();
        console.log(`🎤 Local Whisper: ${whisperInstalled ? 'Available' : 'Not installed'}`);
        console.log(`🔑 OpenAI API: ${openai ? 'Available' : 'Not configured'}`);
        
        if (!whisperInstalled && !openai) {
            console.log(`\n⚠️  No transcription method available. Please:`);
            console.log(`   1. Install local Whisper: pip install openai-whisper`);
            console.log(`   2. OR set OpenAI API key in .env: OPENAI_API_KEY=your_key_here\n`);
        } else if (whisperInstalled) {
            console.log(`\n✅ Using local Whisper for transcription (recommended for privacy)`);
        } else {
            console.log(`\n✅ Using OpenAI Whisper API for transcription`);
        }
        
        await generateVttForAllVideos();
        
        console.log('\n🎉 VTT generation process completed!');
        
    } catch (error) {
        console.error('❌ Error in VTT generation process:', error.message);
        process.exit(1);
    }
}

// Execute if this file is run directly
if (require.main === module) {
    main();
}

module.exports = { 
    generateVttForVideo, 
    generateVttForAllVideos, 
    main,
    config,
    parseVideoFilename
}; 