const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getAccessToken, makeAuthenticatedRequest } = require('./auth.js');

// Configuration from environment variables
const config = {
    vttOutputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles',
    apiBaseUrl: 'https://ws.api.video',
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    openRouterModel: process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku',
    openRouterApiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    delayBetweenFiles: process.env.DELAY_BETWEEN_FILES || 2000,
    openRouterDelay: process.env.OPENROUTER_DELAY || 3000,
    maxRetries: 3
};

// Allowed languages - only these should remain
const ALLOWED_LANGUAGES = ['ar', 'en', 'fr', 'es', 'it'];

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
 * Parses VTT filename to extract video ID and language
 * Format: [videoId]_Title_language.vtt
 */
function parseVttFilename(filename) {
    // Remove .vtt extension
    const nameWithoutVtt = filename.replace(/\.vtt$/, '');
    
    // Extract video ID from brackets
    const videoIdMatch = nameWithoutVtt.match(/^\[([^\]]+)\]/);
    if (!videoIdMatch) {
        // Handle files without video ID format (like Emotional_Mastery-1.mp4.vtt)
        const parts = nameWithoutVtt.split('.');
        if (parts.length > 1 && parts[parts.length - 1].length === 2) {
            // Assume last part is language if it's 2 characters
            const language = parts[parts.length - 1];
            return { hasVideoId: false, filename, language, title: parts.slice(0, -1).join('.') };
        }
        return { hasVideoId: false, filename, title: nameWithoutVtt };
    }
    
    const videoId = videoIdMatch[1];
    
    // Extract language from the end (after last underscore)
    const remainingPart = nameWithoutVtt.substring(videoIdMatch[0].length + 1); // +1 for the underscore
    const parts = remainingPart.split('_');
    const language = parts[parts.length - 1];
    
    // Get title (everything except last part if it's a language)
    const title = ALLOWED_LANGUAGES.includes(language) ? 
        parts.slice(0, -1).join('_') : 
        remainingPart;
    
    return {
        hasVideoId: true,
        videoId,
        language: ALLOWED_LANGUAGES.includes(language) ? language : undefined,
        title,
        filename
    };
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
            !line.includes('X-TIMESTAMP-MAP')) {
            textLines.push(line);
        }
    }
    
    return textLines.slice(0, 5).join(' '); // Use first 5 subtitle lines for detection
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
            throw new Error('No text provided for language detection');
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
                'X-Title': 'Subtitle Validator'
            }
        });
        
        const detectedLanguage = response.data.choices[0].message.content.trim().toLowerCase();
        console.log(`🤖 AI detected language: "${detectedLanguage}" for text: "${text.substring(0, 50)}..."`);
        return detectedLanguage;
        
    } catch (error) {
        if (error.response?.status === 429 && retryCount < config.maxRetries) {
            console.log(`🔄 Rate limit hit, retrying... (${retryCount + 1}/${config.maxRetries})`);
            return await detectLanguageWithAI(text, retryCount + 1);
        }
        
        console.error(`❌ Error detecting language:`, error.response?.data || error.message);
        return null;
    }
}

/**
 * Gets all captions for a specific video
 */
async function getVideoCaptions(videoId) {
    try {
        const response = await makeAuthenticatedRequest({
            method: 'GET',
            url: `${config.apiBaseUrl}/videos/${videoId}/captions`
        });
        
        if (response.status === 200) {
            return { success: true, captions: response.data.data };
        } else {
            return { success: false, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        if (error.response?.status === 404) {
            return { success: true, captions: [] }; // Video exists but no captions
        }
        return { success: false, error: error.message };
    }
}

/**
 * Deletes a specific caption for a video
 */
async function deleteCaption(videoId, language) {
    try {
        console.log(`🗑️  Deleting ${language} caption for video ${videoId}...`);
        
        const response = await makeAuthenticatedRequest({
            method: 'DELETE',
            url: `${config.apiBaseUrl}/videos/${videoId}/captions/${language}`
        });
        
        if (response.status === 204) {
            console.log(`✅ Successfully deleted ${language} caption`);
            return { success: true };
        } else {
            console.error(`❌ Failed to delete ${language} caption: HTTP ${response.status}`);
            return { success: false, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        // 404 is expected if caption doesn't exist
        if (error.response?.status === 404) {
            console.log(`ℹ️  Caption ${language} not found (already deleted or never existed)`);
            return { success: true };
        }
        
        console.error(`❌ Error deleting ${language} caption:`, error.response?.data || error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Validates a single VTT file
 */
async function validateVttFile(filePath) {
    const filename = path.basename(filePath);
    console.log(`\n📋 Validating: ${filename}`);
    
    try {
        // Parse filename to extract video ID and expected language
        const parsedInfo = parseVttFilename(filename);
        console.log(`📝 Parsed info:`, parsedInfo);
        
        if (!parsedInfo.hasVideoId) {
            console.log(`⚠️  Skipping file without video ID format: ${filename}`);
            return { 
                success: false, 
                filename, 
                error: 'No video ID found in filename',
                action: 'skipped'
            };
        }
        
        // Read VTT content
        const vttContent = fs.readFileSync(filePath, 'utf8');
        const textContent = extractTextFromVttContent(vttContent);
        
        if (!textContent || textContent.trim().length === 0) {
            console.log(`⚠️  No text content found in VTT file: ${filename}`);
            return { 
                success: false, 
                filename, 
                error: 'No text content found',
                action: 'skipped'
            };
        }
        
        // Detect actual language using AI
        const detectedLanguageName = await detectLanguageWithAI(textContent);
        if (!detectedLanguageName) {
            console.log(`❌ Could not detect language for: ${filename}`);
            return { 
                success: false, 
                filename, 
                error: 'Language detection failed',
                action: 'skipped'
            };
        }
        
        const detectedLanguageCode = languageMappings[detectedLanguageName] || detectedLanguageName;
        console.log(`🔍 Detected language: ${detectedLanguageName} (${detectedLanguageCode})`);
        
        // Check if detected language is in allowed languages
        if (!ALLOWED_LANGUAGES.includes(detectedLanguageCode)) {
            console.log(`🚫 Detected language '${detectedLanguageCode}' not in allowed languages: ${ALLOWED_LANGUAGES.join(', ')}`);
            
            // Delete the local VTT file as it's not in an allowed language
            try {
                fs.unlinkSync(filePath);
                console.log(`🗑️  Deleted local VTT file (unsupported language): ${filename}`);
            } catch (unlinkError) {
                console.error(`❌ Error deleting local file: ${unlinkError.message}`);
            }
            
            return { 
                success: true, 
                filename, 
                videoId: parsedInfo.videoId,
                detectedLanguage: detectedLanguageCode,
                action: 'deleted_local_unsupported_language'
            };
        }
        
        // Compare with expected language from filename
        const expectedLanguage = parsedInfo.language;
        const isLanguageMismatch = expectedLanguage && expectedLanguage !== detectedLanguageCode;
        
        console.log(`📍 Expected language: ${expectedLanguage || 'unknown'}`);
        console.log(`🤖 Detected language: ${detectedLanguageCode}`);
        console.log(`❓ Language mismatch: ${isLanguageMismatch ? 'YES' : 'NO'}`);
        
        const result = {
            success: true,
            filename,
            videoId: parsedInfo.videoId,
            expectedLanguage,
            detectedLanguage: detectedLanguageCode,
            isLanguageMismatch,
            textSample: textContent.substring(0, 100),
            action: 'validated'
        };
        
        // If there's a mismatch, we need to check and clean up the API.video captions
        if (isLanguageMismatch || !expectedLanguage) {
            console.log(`⚠️  Language issue detected, checking API.video captions...`);
            
            // Get current captions from API.video
            const captionsResult = await getVideoCaptions(parsedInfo.videoId);
            if (captionsResult.success) {
                console.log(`📊 Found ${captionsResult.captions.length} captions on API.video`);
                
                for (const caption of captionsResult.captions) {
                    console.log(`   - ${caption.srclang}: ${caption.src}`);
                    
                    // Delete captions that are not in allowed languages
                    if (!ALLOWED_LANGUAGES.includes(caption.srclang)) {
                        console.log(`🚫 Deleting non-allowed language: ${caption.srclang}`);
                        await deleteCaption(parsedInfo.videoId, caption.srclang);
                        result.action = 'deleted_remote_unsupported_language';
                    }
                    // Delete captions that don't match the detected language for this file
                    else if (expectedLanguage && caption.srclang === expectedLanguage && isLanguageMismatch) {
                        console.log(`🚫 Deleting mismatched caption: ${caption.srclang} (detected: ${detectedLanguageCode})`);
                        await deleteCaption(parsedInfo.videoId, caption.srclang);
                        result.action = 'deleted_remote_mismatched_language';
                    }
                }
            }
            
            // Delete the local VTT file if there's a mismatch
            if (isLanguageMismatch) {
                try {
                    fs.unlinkSync(filePath);
                    console.log(`🗑️  Deleted local VTT file (language mismatch): ${filename}`);
                    result.action = 'deleted_local_mismatched';
                } catch (unlinkError) {
                    console.error(`❌ Error deleting local file: ${unlinkError.message}`);
                }
            }
        }
        
        return result;
        
    } catch (error) {
        console.error(`❌ Error validating ${filename}:`, error.message);
        return { 
            success: false, 
            filename, 
            error: error.message,
            action: 'error'
        };
    }
}

/**
 * Main function to validate all VTT files
 */
async function validateAllSubtitles() {
    try {
        console.log('🚀 Starting Subtitle Validation Process...');
        console.log(`📁 Scanning folder: ${config.vttOutputFolder}`);
        console.log(`✅ Allowed languages: ${ALLOWED_LANGUAGES.join(', ')}`);
        
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
        
        console.log(`\n📊 Found ${vttFiles.length} VTT files to validate`);
        console.log(`🤖 Using OpenRouter AI for language detection`);
        console.log(`⏱️  Delay between files: ${config.delayBetweenFiles}ms`);
        console.log(`⏱️  OpenRouter delay: ${config.openRouterDelay}ms`);
        
        const results = [];
        let successCount = 0;
        let errorCount = 0;
        let deletedCount = 0;
        
        for (let i = 0; i < vttFiles.length; i++) {
            const filePath = vttFiles[i];
            console.log(`\n📈 Progress: ${i + 1}/${vttFiles.length}`);
            
            const result = await validateVttFile(filePath);
            results.push(result);
            
            if (result.success) {
                successCount++;
                if (result.action.includes('deleted')) {
                    deletedCount++;
                }
            } else {
                errorCount++;
            }
            
            // Add delay between files to avoid rate limiting
            if (i < vttFiles.length - 1) {
                console.log(`⏳ Waiting ${config.delayBetweenFiles}ms before next file...`);
                await new Promise(resolve => setTimeout(resolve, config.delayBetweenFiles));
            }
        }
        
        // Generate summary report
        const reportData = {
            timestamp: new Date().toISOString(),
            summary: {
                totalFiles: vttFiles.length,
                successCount,
                errorCount,
                deletedCount,
                allowedLanguages: ALLOWED_LANGUAGES
            },
            results
        };
        
        // Save report
        const reportFile = './subtitle_validation_report.json';
        fs.writeFileSync(reportFile, JSON.stringify(reportData, null, 2));
        
        console.log('\n📊 Validation Summary:');
        console.log(`✅ Successfully validated: ${successCount}`);
        console.log(`❌ Errors: ${errorCount}`);
        console.log(`🗑️  Files/captions deleted: ${deletedCount}`);
        console.log(`💾 Report saved to: ${reportFile}`);
        
        console.log('\n🎉 Subtitle validation completed!');
        
    } catch (error) {
        console.error('❌ Error in subtitle validation process:', error.message);
        process.exit(1);
    }
}

// Export functions for use in other modules
module.exports = {
    validateAllSubtitles,
    validateVttFile,
    parseVttFilename,
    detectLanguageWithAI,
    getVideoCaptions,
    deleteCaption
};

// Run if called directly
if (require.main === module) {
    validateAllSubtitles();
} 