require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const OpenAI = require('openai');
const axios = require('axios');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const { extractVideoIdFromFilename } = require('./videoDownloader.js');

const execAsync = promisify(exec);

// Configuration from environment variables
const config = {
    outputFolder: process.env.OUTPUT_FOLDER || './downloads',
    vttOutputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles',
    openaiApiKey: process.env.OPENAI_API_KEY,
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    openrouterModel: process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku',
    whisperModel: process.env.WHISPER_MODEL || 'base',
    silenceThreshold: parseFloat(process.env.SILENCE_THRESHOLD) || 0.01,
    musicDetectionEnabled: process.env.MUSIC_DETECTION_ENABLED === 'true',
    captionLanguages: (process.env.CAPTION_LANGUAGES || 'ar,en,fr,es,it').split(','),
    translationMethod: process.env.TRANSLATION_METHOD || 'whisper' // 'whisper' or 'translate'
};

// Language mapping for Whisper and API.video
const languageMapping = {
    'ar': { name: 'Arabic', whisperCode: 'ar', apiVideoCode: 'ar', nativeName: 'العربية' },
    'en': { name: 'English', whisperCode: 'en', apiVideoCode: 'en', nativeName: 'English' },
    'fr': { name: 'French', whisperCode: 'fr', apiVideoCode: 'fr', nativeName: 'Français' },
    'es': { name: 'Spanish', whisperCode: 'es', apiVideoCode: 'es', nativeName: 'Español' },
    'it': { name: 'Italian', whisperCode: 'it', apiVideoCode: 'it', nativeName: 'Italiano' }
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
 * Transcribes audio using local Whisper for a specific language
 */
async function transcribeWithLocalWhisperForLanguage(audioPath, languageCode) {
    console.log(`🎤 Transcribing with local Whisper (${config.whisperModel} model, ${languageMapping[languageCode].name})...`);
    
    const whisperInstalled = await checkWhisperInstalled();
    
    if (!whisperInstalled) {
        console.log(`❌ Local Whisper not found.`);
        return {
            text: `[Local Whisper not installed for ${languageMapping[languageCode].name}]`,
            segments: [{
                start: 0,
                end: 10,
                text: `[Local Whisper not installed for ${languageMapping[languageCode].name}]`
            }]
        };
    }
    
    return new Promise((resolve, reject) => {
        const outputDir = path.dirname(audioPath);
        const baseFilename = path.basename(audioPath, path.extname(audioPath));
        const jsonOutputPath = path.join(outputDir, `${baseFilename}_${languageCode}.json`);
        
        console.log(`📝 Running whisper transcription for ${languageMapping[languageCode].name}...`);
        
        // Run whisper command with specific language
        const whisperArgs = [
            audioPath,
            '--model', config.whisperModel,
            '--output_format', 'json',
            '--output_dir', outputDir,
            '--language', languageMapping[languageCode].whisperCode,
            '--task', 'transcribe'
        ];
        
        console.log(`🔄 Executing: whisper ${whisperArgs.join(' ')}`);
        
        const whisperProcess = spawn('whisper', whisperArgs);
        
        let stdout = '';
        let stderr = '';
        
        whisperProcess.stdout.on('data', (data) => {
            stdout += data.toString();
            const progressMatch = data.toString().match(/(\d+)%/);
            if (progressMatch) {
                process.stdout.write(`\r🎤 Transcribing ${languageMapping[languageCode].name}: ${progressMatch[1]}%`);
            }
        });
        
        whisperProcess.stderr.on('data', (data) => {
            stderr += data.toString();
            const progressMatch = data.toString().match(/(\d+)%/);
            if (progressMatch) {
                process.stdout.write(`\r🎤 Transcribing ${languageMapping[languageCode].name}: ${progressMatch[1]}%`);
            }
        });
        
        whisperProcess.on('close', (code) => {
            console.log(`\n🎤 Whisper transcription for ${languageMapping[languageCode].name} completed (exit code: ${code})`);
            
            if (code !== 0) {
                console.error(`❌ Whisper failed for ${languageMapping[languageCode].name} with exit code ${code}`);
                resolve({
                    text: `[Whisper transcription failed for ${languageMapping[languageCode].name}]`,
                    segments: [{
                        start: 0,
                        end: 10,
                        text: `[Whisper transcription failed for ${languageMapping[languageCode].name}]`
                    }]
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
                    
                    console.log(`✅ Transcription loaded for ${languageMapping[languageCode].name}`);
                    
                    // Clean up JSON file
                    fs.unlinkSync(generatedJsonPath);
                    
                    // Convert Whisper format to standardized format
                    const convertedTranscription = {
                        text: transcription.text,
                        segments: transcription.segments || [],
                        language: languageCode
                    };
                    
                    resolve(convertedTranscription);
                } else {
                    console.error(`❌ JSON output file not found for ${languageMapping[languageCode].name}`);
                    resolve({
                        text: `[Transcription file not found for ${languageMapping[languageCode].name}]`,
                        segments: [{
                            start: 0,
                            end: 10,
                            text: `[Transcription file not found for ${languageMapping[languageCode].name}]`
                        }],
                        language: languageCode
                    });
                }
            } catch (error) {
                console.error(`❌ Error reading transcription JSON for ${languageMapping[languageCode].name}:`, error.message);
                resolve({
                    text: `[Error processing transcription for ${languageMapping[languageCode].name}]`,
                    segments: [{
                        start: 0,
                        end: 10,
                        text: `[Error processing transcription for ${languageMapping[languageCode].name}]`
                    }],
                    language: languageCode
                });
            }
        });
        
        whisperProcess.on('error', (error) => {
            console.error(`❌ Failed to start whisper process for ${languageMapping[languageCode].name}:`, error.message);
            resolve({
                text: `[Failed to start Whisper for ${languageMapping[languageCode].name}]`,
                segments: [{
                    start: 0,
                    end: 10,
                    text: `[Failed to start Whisper for ${languageMapping[languageCode].name}]`
                }],
                language: languageCode
            });
        });
    });
}

/**
 * Translates text using OpenRouter API
 */
async function translateTextWithOpenRouter(text, targetLanguage) {
    if (!config.openrouterApiKey) {
        return `[OpenRouter API key not configured for ${languageMapping[targetLanguage].name}]`;
    }
    
    if (!text || text.trim().length === 0) {
        return '';
    }
    
    try {
        const targetLangInfo = languageMapping[targetLanguage];
        
        const prompt = `Translate the following text to ${targetLangInfo.name} (${targetLangInfo.nativeName}). 
Return ONLY the translated text without any additional explanation or formatting:

${text}`;

        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: config.openrouterModel,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.3,
            max_tokens: Math.min(text.length * 3, 4000) // Estimate token usage
        }, {
            headers: {
                'Authorization': `Bearer ${config.openrouterApiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://api.video-downloader.local',
                'X-Title': 'API.video Multi-Language Caption Generator'
            }
        });
        
        const translatedText = response.data.choices[0].message.content.trim();
        
        // Log successful translation (first 50 chars for debugging)
        const previewText = text.length > 50 ? text.substring(0, 50) + '...' : text;
        const previewTranslated = translatedText.length > 50 ? translatedText.substring(0, 50) + '...' : translatedText;
        console.log(`✅ Translated to ${targetLangInfo.name}: "${previewText}" → "${previewTranslated}"`);
        
        return translatedText;
        
    } catch (error) {
        console.error(`❌ OpenRouter translation error for ${languageMapping[targetLanguage].name}:`, error.response?.data || error.message);
        return `[Translation failed for ${languageMapping[targetLanguage].name}: ${text}]`;
    }
}

/**
 * Translates text (wrapper function for compatibility)
 */
async function translateText(text, targetLanguage) {
    return await translateTextWithOpenRouter(text, targetLanguage);
}

/**
 * Generates VTT content from transcription and audio analysis
 */
function generateVttContent(transcription, audioAnalysis, videoInfo, languageCode) {
    console.log(`📝 Generating VTT content for ${languageMapping[languageCode].name}...`);
    
    let vttContent = 'WEBVTT\n';
    
    // Add metadata comments with video information
    if (videoInfo.hasVideoId) {
        vttContent += `NOTE Video ID: ${videoInfo.videoId}\n`;
        vttContent += `NOTE Title: ${videoInfo.title}\n`;
    }
    vttContent += `NOTE Language: ${languageMapping[languageCode].name} (${languageCode})\n`;
    vttContent += `NOTE Generated by API.video Multi-Language VTT Generator\n`;
    vttContent += `NOTE Translation: OpenRouter (${config.openrouterModel})\n`;
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
 * Generates VTT files for all configured languages for a single video
 */
async function generateMultiLanguageVttForVideo(videoPath) {
    const videoFilename = path.basename(videoPath);
    const videoInfo = parseVideoFilename(videoFilename);
    
    const audioPath = path.join(config.vttOutputFolder, `${videoInfo.title}_temp.wav`);
    
    console.log(`\n🎬 Processing: ${videoInfo.title}`);
    if (videoInfo.hasVideoId) {
        console.log(`🆔 Video ID: ${videoInfo.videoId}`);
    }
    console.log(`🌐 Target languages: ${config.captionLanguages.map(lang => languageMapping[lang].name).join(', ')}`);
    
    try {
        // Step 1: Extract audio
        await extractAudio(videoPath, audioPath);
        
        // Step 2: Analyze audio for silence and music
        const audioAnalysis = await analyzeAudio(audioPath);
        
        // Step 3: Generate transcriptions for each language
        const transcriptions = {};
        
        if (config.translationMethod === 'whisper') {
            // Use Whisper for each language
            const whisperInstalled = await checkWhisperInstalled();
            
            if (whisperInstalled) {
                for (const languageCode of config.captionLanguages) {
                    console.log(`\n🔄 Processing ${languageMapping[languageCode].name}...`);
                    transcriptions[languageCode] = await transcribeWithLocalWhisperForLanguage(audioPath, languageCode);
                }
            } else {
                console.log(`❌ Whisper not available. Skipping transcription.`);
                return [];
            }
        } else {
            // Use one language for transcription, then translate
            console.log(`🎤 Transcribing in primary language (English)...`);
            const primaryTranscription = await transcribeWithLocalWhisperForLanguage(audioPath, 'en');
            
            transcriptions['en'] = primaryTranscription;
            
            // Translate to other languages
            for (const languageCode of config.captionLanguages) {
                if (languageCode !== 'en') {
                    console.log(`🔄 Translating to ${languageMapping[languageCode].name}...`);
                    
                    const translatedSegments = [];
                    for (const segment of primaryTranscription.segments) {
                        const translatedText = await translateText(segment.text, languageCode);
                        translatedSegments.push({
                            ...segment,
                            text: translatedText
                        });
                    }
                    
                    transcriptions[languageCode] = {
                        text: await translateText(primaryTranscription.text, languageCode),
                        segments: translatedSegments,
                        language: languageCode
                    };
                }
            }
        }
        
        // Step 4: Generate VTT files for each language
        const generatedFiles = [];
        
        for (const languageCode of config.captionLanguages) {
            if (transcriptions[languageCode]) {
                // Create VTT filename with language code
                let vttFilename;
                if (videoInfo.hasVideoId) {
                    vttFilename = `[${videoInfo.videoId}]_${videoInfo.title}_${languageCode}.vtt`;
                } else {
                    vttFilename = `${videoInfo.title}_${languageCode}.vtt`;
                }
                
                const vttPath = path.join(config.vttOutputFolder, vttFilename);
                
                // Check if VTT already exists
                if (fs.existsSync(vttPath)) {
                    console.log(`⏭️  VTT already exists for ${languageMapping[languageCode].name}: ${vttFilename}`);
                    generatedFiles.push({ languageCode, vttPath, filename: vttFilename });
                    continue;
                }
                
                // Generate VTT content
                const vttContent = generateVttContent(transcriptions[languageCode], audioAnalysis, videoInfo, languageCode);
                
                // Save VTT file
                fs.writeFileSync(vttPath, vttContent, 'utf8');
                console.log(`✅ VTT generated for ${languageMapping[languageCode].name}: ${vttFilename}`);
                
                if (videoInfo.hasVideoId) {
                    console.log(`💡 Ready for caption upload to video ID: ${videoInfo.videoId} (${languageCode})`);
                }
                
                generatedFiles.push({ languageCode, vttPath, filename: vttFilename });
            }
        }
        
        // Step 5: Cleanup temporary audio file
        if (fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
            console.log(`🗑️  Cleaned up temporary audio file`);
        }
        
        return generatedFiles;
        
    } catch (error) {
        console.error(`❌ Error generating multi-language VTT for ${videoInfo.title}:`, error.message);
        
        // Cleanup on error
        if (fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
        }
        
        throw error;
    }
}

/**
 * Generates multi-language VTT files for all videos in the downloads folder
 */
async function generateMultiLanguageVttForAllVideos() {
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
    console.log(`🌐 Generating captions in: ${config.captionLanguages.map(lang => languageMapping[lang].name).join(', ')}`);
    console.log(`📂 VTT files will be saved to: ${config.vttOutputFolder}`);
    
    let successCount = 0;
    let failureCount = 0;
    let totalFilesGenerated = 0;
    
    for (let i = 0; i < videoFiles.length; i++) {
        const videoFile = videoFiles[i];
        try {
            console.log(`\n📹 Processing ${i + 1}/${videoFiles.length}: ${path.basename(videoFile)}`);
            const generatedFiles = await generateMultiLanguageVttForVideo(videoFile);
            
            if (generatedFiles.length > 0) {
                successCount++;
                totalFilesGenerated += generatedFiles.length;
            } else {
                failureCount++;
            }
        } catch (error) {
            console.error(`❌ Failed to process ${path.basename(videoFile)}:`, error.message);
            failureCount++;
        }
        
        // Add delay between processing to avoid overwhelming the system
        if (i < videoFiles.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    
    console.log(`\n📊 Multi-Language VTT Generation Summary:`);
    console.log(`✅ Successful videos: ${successCount}`);
    console.log(`❌ Failed videos: ${failureCount}`);
    console.log(`📄 Total VTT files generated: ${totalFilesGenerated}`);
    console.log(`🌐 Languages: ${config.captionLanguages.map(lang => languageMapping[lang].name).join(', ')}`);
    console.log(`📁 VTT files location: ${config.vttOutputFolder}`);
    console.log(`\n💡 Files with [videoId] prefix are ready for multi-language caption upload!`);
}

/**
 * Main function for multi-language VTT generation
 */
async function main() {
    try {
        console.log('🌐 Starting Multi-Language VTT generation process...');
        console.log(`📂 Video source: ${config.outputFolder}`);
        console.log(`📂 VTT destination: ${config.vttOutputFolder}`);
        console.log(`🤖 Whisper model: ${config.whisperModel}`);
        console.log(`🔇 Silence threshold: ${config.silenceThreshold}`);
        console.log(`🎵 Music detection: ${config.musicDetectionEnabled ? 'Enabled' : 'Disabled'}`);
        console.log(`🌐 Target languages: ${config.captionLanguages.map(lang => languageMapping[lang].name).join(', ')}`);
        console.log(`🔄 Translation method: ${config.translationMethod}`);
        
        // Check available transcription methods
        const whisperInstalled = await checkWhisperInstalled();
        console.log(`🎤 Local Whisper: ${whisperInstalled ? 'Available' : 'Not installed'}`);
        console.log(`🔑 OpenAI API: ${openai ? 'Available' : 'Not configured'}`);
        console.log(`🌐 OpenRouter API: ${config.openrouterApiKey ? 'Available' : 'Not configured'}`);
        console.log(`🤖 OpenRouter Model: ${config.openrouterModel}`);
        
        if (!whisperInstalled) {
            console.log(`\n❌ Local Whisper is required for multi-language caption generation.`);
            console.log(`   Please install it with: pip install openai-whisper`);
            return;
        }
        
        if (config.translationMethod === 'translate' && !config.openrouterApiKey) {
            console.log(`\n⚠️  Translation method set to 'translate' but OpenRouter API not configured.`);
            console.log(`   Falling back to Whisper multi-language transcription.`);
            config.translationMethod = 'whisper';
        }
        
        await generateMultiLanguageVttForAllVideos();
        
        console.log('\n🎉 Multi-Language VTT generation process completed!');
        
    } catch (error) {
        console.error('❌ Error in multi-language VTT generation process:', error.message);
        process.exit(1);
    }
}

// Execute if this file is run directly
if (require.main === module) {
    main();
}

module.exports = { 
    generateMultiLanguageVttForVideo, 
    generateMultiLanguageVttForAllVideos, 
    main,
    config,
    languageMapping
}; 