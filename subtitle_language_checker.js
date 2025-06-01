require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuration from environment variables
const config = {
    subtitlesFolder: process.env.SUBTITLES_FOLDER || './subtitles',
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    openRouterModel: process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku',
    openRouterApiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    openRouterDelay: process.env.OPENROUTER_DELAY || 3000,
    maxRetries: 3,
    reportFile: './subtitle_language_check_report.json'
};

// Language code mappings for detection
const languageMappings = {
    'english': 'en',
    'spanish': 'es', 
    'french': 'fr',
    'german': 'de',
    'italian': 'it',
    'portuguese': 'pt',
    'russian': 'ru',
    'chinese': 'zh',
    'japanese': 'ja',
    'korean': 'ko',
    'arabic': 'ar',
    'hindi': 'hi',
    'dutch': 'nl',
    'swedish': 'sv',
    'norwegian': 'no',
    'danish': 'da',
    'finnish': 'fi',
    'polish': 'pl',
    'czech': 'cs',
    'hungarian': 'hu',
    'turkish': 'tr',
    'greek': 'el',
    'hebrew': 'he',
    'thai': 'th',
    'vietnamese': 'vi',
    'indonesian': 'id',
    'malay': 'ms',
    'filipino': 'tl',
    'tamil': 'ta',
    'telugu': 'te',
    'bengali': 'bn',
    'urdu': 'ur',
    'persian': 'fa',
    'ukrainian': 'uk',
    'romanian': 'ro',
    'bulgarian': 'bg',
    'croatian': 'hr',
    'serbian': 'sr',
    'slovenian': 'sl',
    'slovak': 'sk',
    'lithuanian': 'lt',
    'latvian': 'lv',
    'estonian': 'et'
};

/**
 * Parses VTT filename to extract language suffix
 */
function parseVttFilename(filename) {
    // Remove .vtt extension
    const nameWithoutVtt = filename.replace(/\.vtt$/, '');
    
    // Extract video ID from brackets if present
    const videoIdMatch = nameWithoutVtt.match(/^\[([^\]]+)\]/);
    
    if (videoIdMatch) {
        // Format: [videoId]_Title_language.vtt
        const videoId = videoIdMatch[1];
        const remainingPart = nameWithoutVtt.substring(videoIdMatch[0].length + 1);
        const parts = remainingPart.split('_');
        const language = parts[parts.length - 1];
        const title = parts.slice(0, -1).join('_');
        
        return {
            hasVideoId: true,
            videoId,
            language: language.length === 2 ? language : undefined,
            title,
            filename,
            expectedLanguage: language.length === 2 ? language : null
        };
    } else {
        // Handle files without video ID format (like Emotional_Mastery-1.mp4.vtt)
        const parts = nameWithoutVtt.split('.');
        
        // Check if last part before .vtt is a 2-character language code
        if (parts.length > 1 && parts[parts.length - 1].length === 2) {
            const language = parts[parts.length - 1];
            return {
                hasVideoId: false,
                filename,
                language,
                title: parts.slice(0, -1).join('.'),
                expectedLanguage: language
            };
        }
        
        // Check if there's an underscore followed by 2 characters at the end
        const underscoreMatch = nameWithoutVtt.match(/^(.+)_([a-z]{2})$/);
        if (underscoreMatch) {
            return {
                hasVideoId: false,
                filename,
                language: underscoreMatch[2],
                title: underscoreMatch[1],
                expectedLanguage: underscoreMatch[2]
            };
        }
        
        return {
            hasVideoId: false,
            filename,
            title: nameWithoutVtt,
            expectedLanguage: null
        };
    }
}

/**
 * Reads VTT file content and extracts text for language detection
 */
function extractTextFromVttContent(content) {
    const lines = content.split('\n');
    const textLines = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Skip WEBVTT header, timestamps, empty lines, and NOTE lines
        if (line && 
            !line.startsWith('WEBVTT') && 
            !line.includes('-->') && 
            !line.startsWith('NOTE') &&
            !line.match(/^\d+$/) &&
            !line.startsWith('[') &&
            !line.includes('X-TIMESTAMP-MAP') &&
            !line.includes('OPENAI_API_KEY') &&
            !line.includes('transcription')) {
            textLines.push(line);
        }
    }
    
    const extractedText = textLines.slice(0, 10).join(' '); // Use first 10 subtitle lines for detection
    return extractedText.trim();
}

/**
 * Detects language using OpenRouter AI
 */
async function detectLanguageWithAI(text, retryCount = 0) {
    try {
        if (!config.openRouterApiKey) {
            throw new Error('OPENROUTER_API_KEY not found in environment variables');
        }
        
        if (!text || text.trim().length === 0) {
            return { error: 'No meaningful text found for language detection' };
        }
        
        // Add delay before AI request to avoid rate limits
        if (retryCount > 0) {
            const delay = config.openRouterDelay * Math.pow(2, retryCount);
            console.log(`⏳ Rate limit hit, waiting ${delay}ms before retry ${retryCount}...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        const response = await axios.post(config.openRouterApiUrl, {
            model: config.openRouterModel,
            messages: [
                {
                    role: "system",
                    content: "You are a language detection expert. Analyze the given text and respond with ONLY the language name in English (e.g., 'english', 'spanish', 'french', etc.). Do not provide any explanations or additional text. If the text appears to be an error message or placeholder, respond with 'error'."
                },
                {
                    role: "user",
                    content: `Detect the language of this text: "${text}"`
                }
            ],
            temperature: 0.1,
            max_tokens: 10
        }, {
            headers: {
                'Authorization': `Bearer ${config.openRouterApiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/emaalouf/APIVODDownloader',
                'X-Title': 'Subtitle Language Checker'
            }
        });
        
        const detectedLanguage = response.data.choices[0].message.content.trim().toLowerCase();
        console.log(`🤖 AI detected language: "${detectedLanguage}" for text: "${text.substring(0, 50)}..."`);
        
        if (detectedLanguage === 'error') {
            return { error: 'AI detected error or placeholder text' };
        }
        
        return { detectedLanguage, detectedLanguageCode: languageMappings[detectedLanguage] || null };
        
    } catch (error) {
        if (error.response?.status === 429 && retryCount < config.maxRetries) {
            console.log(`🔄 Rate limit hit, retrying... (${retryCount + 1}/${config.maxRetries})`);
            return await detectLanguageWithAI(text, retryCount + 1);
        }
        
        console.error(`❌ Error detecting language:`, error.response?.data || error.message);
        return { error: `API Error: ${error.response?.data?.error?.message || error.message}` };
    }
}

/**
 * Checks a single subtitle file
 */
async function checkSubtitleFile(filePath) {
    const filename = path.basename(filePath);
    console.log(`\n🔍 Checking file: ${filename}`);
    
    const parseResult = parseVttFilename(filename);
    
    if (!parseResult.expectedLanguage) {
        return {
            filename,
            status: 'NO_LANGUAGE_SUFFIX',
            message: 'No language suffix detected in filename',
            ...parseResult
        };
    }
    
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const extractedText = extractTextFromVttContent(content);
        
        if (!extractedText) {
            return {
                filename,
                status: 'NO_TEXT_CONTENT',
                message: 'No meaningful text content found in file',
                expectedLanguage: parseResult.expectedLanguage,
                ...parseResult
            };
        }
        
        console.log(`📝 Extracted text: "${extractedText.substring(0, 100)}..."`);
        
        // Add delay between requests to respect rate limits
        await new Promise(resolve => setTimeout(resolve, config.openRouterDelay));
        
        const detectionResult = await detectLanguageWithAI(extractedText);
        
        if (detectionResult.error) {
            return {
                filename,
                status: 'DETECTION_ERROR',
                message: detectionResult.error,
                expectedLanguage: parseResult.expectedLanguage,
                extractedText: extractedText.substring(0, 200),
                ...parseResult
            };
        }
        
        const languageMatch = detectionResult.detectedLanguageCode === parseResult.expectedLanguage;
        
        return {
            filename,
            status: languageMatch ? 'MATCH' : 'MISMATCH',
            message: languageMatch ? 
                'Language suffix matches detected content language' : 
                'Language suffix does NOT match detected content language',
            expectedLanguage: parseResult.expectedLanguage,
            detectedLanguage: detectionResult.detectedLanguage,
            detectedLanguageCode: detectionResult.detectedLanguageCode,
            extractedText: extractedText.substring(0, 200),
            match: languageMatch,
            ...parseResult
        };
        
    } catch (error) {
        return {
            filename,
            status: 'FILE_ERROR',
            message: `Error reading file: ${error.message}`,
            expectedLanguage: parseResult.expectedLanguage,
            ...parseResult
        };
    }
}

/**
 * Generates a detailed report of all subtitle files
 */
async function generateLanguageCheckReport() {
    console.log('🎯 Subtitle Language Suffix Checker');
    console.log('=====================================');
    console.log(`📁 Checking subtitles folder: ${config.subtitlesFolder}`);
    
    // Validate environment
    if (!config.openRouterApiKey) {
        console.error('❌ OPENROUTER_API_KEY not found in environment variables');
        console.log('💡 Please add OPENROUTER_API_KEY to your .env file');
        return;
    }
    
    console.log(`🤖 Using OpenRouter model: ${config.openRouterModel}`);
    console.log(`⏱️  Request delay: ${config.openRouterDelay}ms`);
    
    try {
        const files = fs.readdirSync(config.subtitlesFolder)
            .filter(file => file.endsWith('.vtt'))
            .sort();
        
        if (files.length === 0) {
            console.log('📂 No VTT files found in subtitles folder');
            return;
        }
        
        console.log(`📊 Found ${files.length} VTT file(s) to check\n`);
        
        const results = [];
        let matchCount = 0;
        let mismatchCount = 0;
        let errorCount = 0;
        let noLanguageCount = 0;
        
        for (const file of files) {
            const filePath = path.join(config.subtitlesFolder, file);
            const result = await checkSubtitleFile(filePath);
            results.push(result);
            
            // Update counters
            switch (result.status) {
                case 'MATCH':
                    matchCount++;
                    console.log(`✅ ${result.filename} - Language matches (${result.expectedLanguage})`);
                    break;
                case 'MISMATCH':
                    mismatchCount++;
                    console.log(`❌ ${result.filename} - Expected: ${result.expectedLanguage}, Detected: ${result.detectedLanguageCode || result.detectedLanguage}`);
                    break;
                case 'NO_LANGUAGE_SUFFIX':
                    noLanguageCount++;
                    console.log(`⚠️  ${result.filename} - No language suffix in filename`);
                    break;
                default:
                    errorCount++;
                    console.log(`💥 ${result.filename} - ${result.message}`);
                    break;
            }
        }
        
        // Generate summary
        const summary = {
            timestamp: new Date().toISOString(),
            totalFiles: files.length,
            matches: matchCount,
            mismatches: mismatchCount,
            errors: errorCount,
            noLanguageSuffix: noLanguageCount,
            config: {
                model: config.openRouterModel,
                delay: config.openRouterDelay
            }
        };
        
        const report = {
            summary,
            results
        };
        
        // Save report to file
        fs.writeFileSync(config.reportFile, JSON.stringify(report, null, 2));
        
        // Display final summary
        console.log('\n📋 Final Summary');
        console.log('=================');
        console.log(`📁 Total files checked: ${files.length}`);
        console.log(`✅ Language matches: ${matchCount}`);
        console.log(`❌ Language mismatches: ${mismatchCount}`);
        console.log(`⚠️  No language suffix: ${noLanguageCount}`);
        console.log(`💥 Errors: ${errorCount}`);
        console.log(`\n💾 Detailed report saved to: ${config.reportFile}`);
        
        if (mismatchCount > 0) {
            console.log('\n⚠️  Files with language mismatches:');
            results.filter(r => r.status === 'MISMATCH').forEach(r => {
                console.log(`   • ${r.filename}: Expected ${r.expectedLanguage}, detected ${r.detectedLanguageCode || r.detectedLanguage}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Error during language checking:', error.message);
    }
}

// Run the language check if this script is executed directly
if (require.main === module) {
    generateLanguageCheckReport().catch(console.error);
}

module.exports = {
    generateLanguageCheckReport,
    checkSubtitleFile,
    parseVttFilename,
    extractTextFromVttContent,
    detectLanguageWithAI
}; 