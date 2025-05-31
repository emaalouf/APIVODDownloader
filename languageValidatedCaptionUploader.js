require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { getAccessToken, makeAuthenticatedRequest } = require('./auth.js');

// Configuration from environment variables
const config = {
    vttOutputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles',
    apiBaseUrl: 'https://ws.api.video',
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    openRouterApiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    delayBetweenFiles: process.env.DELAY_BETWEEN_FILES || 1000,
    maxRetries: 3
};

// Language code mappings
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
 * Extracts the first 5 words from VTT content
 */
function extractFirstWords(vttContent, wordCount = 5) {
    try {
        // Remove VTT header and timing information
        const lines = vttContent.split('\n');
        let textContent = '';
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            // Skip headers, timing lines, and empty lines
            if (trimmedLine && 
                !trimmedLine.startsWith('WEBVTT') &&
                !trimmedLine.includes('-->') &&
                !trimmedLine.match(/^\d+$/) &&
                !trimmedLine.startsWith('NOTE')) {
                
                textContent += ' ' + trimmedLine;
                
                // Stop if we have enough words
                const words = textContent.trim().split(/\s+/).filter(word => word.length > 0);
                if (words.length >= wordCount) {
                    return words.slice(0, wordCount).join(' ');
                }
            }
        }
        
        // Return whatever we found
        const words = textContent.trim().split(/\s+/).filter(word => word.length > 0);
        return words.slice(0, Math.min(wordCount, words.length)).join(' ');
        
    } catch (error) {
        console.error('Error extracting words from VTT:', error.message);
        return '';
    }
}

/**
 * Detects language using OpenRouter AI
 */
async function detectLanguageWithAI(text) {
    try {
        if (!config.openRouterApiKey) {
            throw new Error('OPENROUTER_API_KEY not found in environment variables');
        }
        
        if (!text || text.trim().length === 0) {
            throw new Error('No text provided for language detection');
        }
        
        const response = await axios.post(config.openRouterApiUrl, {
            model: "meta-llama/llama-3.1-8b-instruct:free",
            messages: [
                {
                    role: "system",
                    content: "You are a language detection expert. Analyze the given text and respond with ONLY the language name in English (e.g., 'english', 'spanish', 'french', etc.). Do not provide any explanations or additional text."
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
                'X-Title': 'Caption Language Validator'
            }
        });
        
        const detectedLanguage = response.data.choices[0].message.content.trim().toLowerCase();
        console.log(`🤖 AI detected language: "${detectedLanguage}" for text: "${text}"`);
        
        return detectedLanguage;
        
    } catch (error) {
        console.error(`❌ Error detecting language with AI:`, error.response?.data || error.message);
        throw error;
    }
}

/**
 * Converts language name to ISO code
 */
function getLanguageCode(languageName) {
    const normalizedName = languageName.toLowerCase().trim();
    return languageMappings[normalizedName] || null;
}

/**
 * Parses video ID and language from VTT filename
 */
function parseVttFilename(filename) {
    // Remove .vtt extension
    const nameWithoutVtt = filename.replace(/\.vtt$/, '');
    
    // Look for pattern [videoId] at the beginning
    const videoIdMatch = nameWithoutVtt.match(/^\[([^\]]+)\]/);
    
    if (!videoIdMatch) {
        return {
            hasVideoId: false,
            originalFilename: filename
        };
    }
    
    const videoId = videoIdMatch[1];
    
    // Try to detect language suffix from filename
    let filenameLang = null;
    
    // Pattern 1: filename ends with _[language] (e.g., _en, _ar, _es, _fr, _it)
    const languageSuffixMatch = nameWithoutVtt.match(/_([a-z]{2})$/);
    if (languageSuffixMatch) {
        filenameLang = languageSuffixMatch[1];
    }
    
    // Pattern 2: filename ends with .mp4_[language] (e.g., .mp4_ar, .mp4_es)
    const mp4LanguageMatch = nameWithoutVtt.match(/\.mp4_([a-z]{2})$/);
    if (mp4LanguageMatch) {
        filenameLang = mp4LanguageMatch[1];
    }
    
    return {
        hasVideoId: true,
        videoId: videoId,
        filenameLang: filenameLang, // Language from filename suffix
        originalFilename: filename
    };
}

/**
 * Validates and uploads a single caption file
 */
async function validateAndUploadCaption(filePath) {
    const filename = path.basename(filePath);
    
    try {
        console.log(`\n📁 Processing: ${filename}`);
        
        // Parse filename to get video ID and expected language
        const parseResult = parseVttFilename(filename);
        
        if (!parseResult.hasVideoId) {
            console.log(`⚠️  Skipping ${filename}: No video ID found in filename`);
            return { success: false, filename, error: 'No video ID in filename' };
        }
        
        const { videoId, filenameLang } = parseResult;
        console.log(`🎬 Video ID: ${videoId}`);
        console.log(`📝 Filename language suffix: ${filenameLang || 'none'}`);
        
        // Read VTT file content
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        
        const vttContent = fs.readFileSync(filePath, 'utf8');
        
        // Extract first 5 words for language detection
        const firstWords = extractFirstWords(vttContent, 5);
        if (!firstWords) {
            console.log(`⚠️  No text content found in ${filename}`);
            return { success: false, filename, error: 'No text content found' };
        }
        
        console.log(`📖 First words: "${firstWords}"`);
        
        // Detect language using AI
        const detectedLanguageName = await detectLanguageWithAI(firstWords);
        const detectedLangCode = getLanguageCode(detectedLanguageName);
        
        if (!detectedLangCode) {
            console.log(`⚠️  Unknown language detected: "${detectedLanguageName}"`);
            return { 
                success: false, 
                filename, 
                error: `Unknown language: ${detectedLanguageName}` 
            };
        }
        
        console.log(`🔍 Detected language: ${detectedLanguageName} (${detectedLangCode})`);
        
        // Compare detected language with filename suffix
        let languageToUse = detectedLangCode;
        let languageMismatch = false;
        
        if (filenameLang && filenameLang !== detectedLangCode) {
            console.log(`⚠️  Language mismatch! Filename suggests: ${filenameLang}, AI detected: ${detectedLangCode}`);
            languageMismatch = true;
            // Use AI-detected language as it's more reliable
            console.log(`✅ Using AI-detected language: ${detectedLangCode}`);
        } else if (filenameLang) {
            console.log(`✅ Language match confirmed: ${detectedLangCode}`);
        } else {
            console.log(`ℹ️  No language suffix in filename, using AI-detected: ${detectedLangCode}`);
        }
        
        // Upload caption with detected language
        const uploadResult = await uploadCaption(videoId, filePath, languageToUse);
        
        return {
            success: uploadResult.success,
            filename,
            videoId,
            filenameLang,
            detectedLang: detectedLangCode,
            detectedLanguageName,
            languageUsed: languageToUse,
            languageMismatch,
            firstWords,
            error: uploadResult.error
        };
        
    } catch (error) {
        console.error(`❌ Error processing ${filename}:`, error.message);
        return { 
            success: false, 
            filename, 
            error: error.message 
        };
    }
}

/**
 * Uploads a VTT caption file to API.video (same as original)
 */
async function uploadCaption(videoId, vttFilePath, language = 'en') {
    const filename = path.basename(vttFilePath);
    
    try {
        console.log(`📤 Uploading ${language} caption for video ${videoId}...`);
        
        // Check if VTT file exists
        if (!fs.existsSync(vttFilePath)) {
            throw new Error(`VTT file not found: ${vttFilePath}`);
        }
        
        // Read the VTT file
        const vttContent = fs.readFileSync(vttFilePath);
        
        // Create form data
        const formData = new FormData();
        formData.append('file', vttContent, {
            filename: filename,
            contentType: 'text/vtt'
        });
        
        // Upload caption using authenticated request
        const response = await makeAuthenticatedRequest({
            method: 'POST',
            url: `${config.apiBaseUrl}/videos/${videoId}/captions/${language}`,
            data: formData,
            headers: {
                ...formData.getHeaders()
            }
        });
        
        if (response.status === 200 || response.status === 201) {
            console.log(`✅ Successfully uploaded ${language} caption for video ${videoId}`);
            return { success: true, videoId, filename };
        } else {
            console.error(`❌ Failed to upload ${language} caption for video ${videoId}: ${response.status}`);
            return { success: false, videoId, filename, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        console.error(`❌ Error uploading ${language} caption for video ${videoId}:`, error.response?.data || error.message);
        return { success: false, videoId, filename, error: error.message };
    }
}

/**
 * Main function to process all VTT files with language validation
 */
async function processAllVttFilesWithValidation() {
    try {
        console.log('🚀 Starting Language-Validated Caption Upload Process...');
        console.log(`📁 Scanning folder: ${config.vttOutputFolder}`);
        
        // Ensure we have valid authentication
        console.log('🔑 Ensuring valid authentication...');
        await getAccessToken();
        
        // Check for OpenRouter API key
        if (!config.openRouterApiKey) {
            console.error('❌ OPENROUTER_API_KEY not found in environment variables');
            console.log('💡 Please add OPENROUTER_API_KEY to your .env file');
            return;
        }
        
        // Find all VTT files
        if (!fs.existsSync(config.vttOutputFolder)) {
            console.error(`❌ VTT output folder not found: ${config.vttOutputFolder}`);
            return;
        }
        
        const vttFiles = fs.readdirSync(config.vttOutputFolder)
            .filter(file => file.toLowerCase().endsWith('.vtt'))
            .map(file => path.join(config.vttOutputFolder, file));
        
        if (vttFiles.length === 0) {
            console.log(`📭 No VTT files found in ${config.vttOutputFolder}`);
            return;
        }
        
        console.log(`\n📊 Found ${vttFiles.length} VTT files to process`);
        console.log(`🤖 Using OpenRouter AI for language detection`);
        console.log(`⏱️  Delay between files: ${config.delayBetweenFiles}ms`);
        
        const results = [];
        let successCount = 0;
        let failureCount = 0;
        let mismatchCount = 0;
        
        for (let i = 0; i < vttFiles.length; i++) {
            const filePath = vttFiles[i];
            
            console.log(`\n🔄 Processing ${i + 1}/${vttFiles.length}: ${path.basename(filePath)}`);
            
            const result = await validateAndUploadCaption(filePath);
            results.push(result);
            
            if (result.success) {
                successCount++;
                if (result.languageMismatch) {
                    mismatchCount++;
                }
            } else {
                failureCount++;
            }
            
            // Add delay between files to avoid rate limiting
            if (i < vttFiles.length - 1) {
                console.log(`⏱️  Waiting ${config.delayBetweenFiles}ms...`);
                await new Promise(resolve => setTimeout(resolve, config.delayBetweenFiles));
            }
        }
        
        // Generate summary report
        console.log(`\n📊 Language-Validated Caption Upload Summary:`);
        console.log(`✅ Successful uploads: ${successCount}`);
        console.log(`❌ Failed uploads: ${failureCount}`);
        console.log(`⚠️  Language mismatches detected: ${mismatchCount}`);
        
        if (mismatchCount > 0) {
            console.log(`\n⚠️  Files with language mismatches:`);
            results.filter(r => r.languageMismatch).forEach(result => {
                console.log(`   - ${result.filename}: filename(${result.filenameLang}) vs detected(${result.detectedLang})`);
            });
        }
        
        if (failureCount > 0) {
            console.log(`\n❌ Failed uploads:`);
            results.filter(r => !r.success).forEach(result => {
                console.log(`   - ${result.filename}: ${result.error}`);
            });
        }
        
        console.log(`\n🎉 Processing complete!`);
        
    } catch (error) {
        console.error('❌ Error in language validation process:', error.message);
        process.exit(1);
    }
}

// Execute if this file is run directly
if (require.main === module) {
    processAllVttFilesWithValidation().catch(error => {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = {
    validateAndUploadCaption,
    processAllVttFilesWithValidation,
    detectLanguageWithAI,
    extractFirstWords,
    parseVttFilename
};