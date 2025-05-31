require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getAccessToken, makeAuthenticatedRequest } = require('../auth.js');

// Configuration from environment variables
const config = {
    apiBaseUrl: 'https://ws.api.video',
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    openRouterApiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    targetLanguages: ['en', 'fr', 'ar', 'es', 'it'],
    delayBetweenVideos: process.env.DELAY_BETWEEN_VIDEOS || 1000,
    delayBetweenCaptions: process.env.DELAY_BETWEEN_CAPTIONS || 500,
    openRouterDelay: process.env.OPENROUTER_DELAY || 3000,
    maxRetries: 3,
    maxVideosToCheck: process.env.MAX_VIDEOS_TO_CHECK || null, // null = all videos
    outputFile: process.env.OUTPUT_FILE || './caption_validation_report.json'
};

// Language code mappings (same as languageValidatedCaptionUploader.js)
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
 * Fetches all videos from API.video with pagination
 */
async function getAllVideos() {
    const allVideos = [];
    let currentPage = 1;
    let hasMore = true;
    
    try {
        console.log('📹 Fetching all videos from API.video...');
        
        while (hasMore) {
            console.log(`📄 Fetching page ${currentPage}...`);
            
            const response = await makeAuthenticatedRequest({
                method: 'GET',
                url: `${config.apiBaseUrl}/videos`,
                params: {
                    currentPage: currentPage,
                    pageSize: 100 // Maximum page size
                }
            });
            
            if (response.status === 200) {
                const videos = response.data.data;
                allVideos.push(...videos);
                
                console.log(`✅ Page ${currentPage}: Found ${videos.length} videos (Total: ${allVideos.length})`);
                
                // Check if there are more pages
                const pagination = response.data.pagination;
                hasMore = pagination && pagination.currentPage < pagination.pagesTotal;
                currentPage++;
                
                // Add delay between page requests
                if (hasMore) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } else {
                console.error(`❌ Failed to fetch videos page ${currentPage}: ${response.status}`);
                break;
            }
        }
        
        console.log(`🎬 Total videos fetched: ${allVideos.length}`);
        return allVideos;
        
    } catch (error) {
        console.error('❌ Error fetching videos:', error.response?.data || error.message);
        return [];
    }
}

/**
 * Gets captions for a specific video and language
 */
async function getVideoCaption(videoId, language) {
    try {
        const response = await makeAuthenticatedRequest({
            method: 'GET',
            url: `${config.apiBaseUrl}/videos/${videoId}/captions/${language}`
        });
        
        if (response.status === 200) {
            return { success: true, caption: response.data };
        } else {
            return { success: false, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        // 404 is expected if caption doesn't exist
        if (error.response?.status === 404) {
            return { success: false, error: 'Caption not found' };
        }
        
        return { success: false, error: error.message };
    }
}

/**
 * Downloads VTT content from a URL
 */
async function downloadVttContent(vttUrl) {
    try {
        const response = await axios.get(vttUrl, {
            timeout: 10000, // 10 second timeout
            headers: {
                'User-Agent': 'Caption-Language-Validator/1.0'
            }
        });
        
        if (response.status === 200) {
            return { success: true, content: response.data };
        } else {
            return { success: false, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Extracts the first 5 words from VTT content (reused from languageValidatedCaptionUploader.js)
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
 * Detects language using OpenRouter AI (reused from languageValidatedCaptionUploader.js)
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
            model: "google/gemini-flash-1.5-8b",
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
        return detectedLanguage;
        
    } catch (error) {
        // Handle rate limiting with retries
        if (error.response?.status === 429 && retryCount < config.maxRetries) {
            console.log(`⚠️  Rate limit hit (attempt ${retryCount + 1}/${config.maxRetries})`);
            return await detectLanguageWithAI(text, retryCount + 1);
        }
        
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
 * Validates captions for a single video
 */
async function validateVideoCaption(video) {
    const videoId = video.videoId;
    const videoTitle = video.title;
    const results = [];
    
    console.log(`\n🎬 Validating captions for: ${videoTitle} (${videoId})`);
    
    for (const language of config.targetLanguages) {
        try {
            console.log(`  🔍 Checking ${language} caption...`);
            
            // Get caption metadata
            const captionResult = await getVideoCaption(videoId, language);
            
            if (!captionResult.success) {
                if (captionResult.error !== 'Caption not found') {
                    console.log(`    ⚠️  ${language}: ${captionResult.error}`);
                }
                continue;
            }
            
            const caption = captionResult.caption;
            console.log(`    📥 Found ${language} caption: ${caption.languageName}`);
            
            // Download VTT content
            const vttResult = await downloadVttContent(caption.src);
            
            if (!vttResult.success) {
                console.log(`    ❌ Failed to download VTT: ${vttResult.error}`);
                results.push({
                    videoId,
                    videoTitle,
                    language,
                    declaredLanguage: caption.languageName,
                    status: 'download_failed',
                    error: vttResult.error
                });
                continue;
            }
            
            // Extract first words
            const firstWords = extractFirstWords(vttResult.content, 5);
            
            if (!firstWords) {
                console.log(`    ⚠️  No text content found in VTT`);
                results.push({
                    videoId,
                    videoTitle,
                    language,
                    declaredLanguage: caption.languageName,
                    status: 'no_content',
                    firstWords: ''
                });
                continue;
            }
            
            console.log(`    📖 First words: "${firstWords}"`);
            
            // Detect language with AI
            const detectedLanguageName = await detectLanguageWithAI(firstWords);
            const detectedLangCode = getLanguageCode(detectedLanguageName);
            
            console.log(`    🤖 AI detected: ${detectedLanguageName} (${detectedLangCode})`);
            
            // Compare languages
            const isMatch = detectedLangCode === language;
            const status = isMatch ? 'match' : 'mismatch';
            
            if (isMatch) {
                console.log(`    ✅ Language match confirmed!`);
            } else {
                console.log(`    ⚠️  Language mismatch! Expected: ${language}, Detected: ${detectedLangCode}`);
            }
            
            results.push({
                videoId,
                videoTitle,
                language,
                declaredLanguage: caption.languageName,
                detectedLanguage: detectedLanguageName,
                detectedLangCode,
                firstWords,
                status,
                isMatch,
                captionSrc: caption.src
            });
            
            // Add delay between caption checks
            if (config.delayBetweenCaptions > 0) {
                await new Promise(resolve => setTimeout(resolve, config.delayBetweenCaptions));
            }
            
        } catch (error) {
            console.log(`    ❌ Error validating ${language} caption: ${error.message}`);
            results.push({
                videoId,
                videoTitle,
                language,
                status: 'error',
                error: error.message
            });
        }
    }
    
    return results;
}

/**
 * Main function to validate all video captions
 */
async function validateAllCaptions() {
    try {
        console.log('🚀 Starting Caption Language Validation Process...');
        
        // Ensure we have valid authentication
        console.log('🔑 Ensuring valid authentication...');
        await getAccessToken();
        
        // Check for OpenRouter API key
        if (!config.openRouterApiKey) {
            console.error('❌ OPENROUTER_API_KEY not found in environment variables');
            console.log('💡 Please add OPENROUTER_API_KEY to your .env file');
            return;
        }
        
        console.log(`\n⚙️  Configuration:`);
        console.log(`🎯 Target languages: ${config.targetLanguages.join(', ')}`);
        console.log(`⏱️  Delay between videos: ${config.delayBetweenVideos}ms`);
        console.log(`⏱️  Delay between captions: ${config.delayBetweenCaptions}ms`);
        console.log(`⏱️  OpenRouter delay: ${config.openRouterDelay}ms`);
        console.log(`📊 Max videos to check: ${config.maxVideosToCheck || 'All'}`);
        console.log(`💾 Output file: ${config.outputFile}`);
        
        // Fetch all videos
        const allVideos = await getAllVideos();
        
        if (allVideos.length === 0) {
            console.log('❌ No videos found to validate');
            return;
        }
        
        // Limit videos if specified
        const videosToCheck = config.maxVideosToCheck 
            ? allVideos.slice(0, parseInt(config.maxVideosToCheck))
            : allVideos;
        
        console.log(`\n📊 Processing ${videosToCheck.length} videos...`);
        
        const allResults = [];
        let processedCount = 0;
        let totalMatches = 0;
        let totalMismatches = 0;
        let totalErrors = 0;
        
        for (let i = 0; i < videosToCheck.length; i++) {
            const video = videosToCheck[i];
            
            console.log(`\n🔄 Processing ${i + 1}/${videosToCheck.length}: ${video.title}`);
            
            const videoResults = await validateVideoCaption(video);
            allResults.push(...videoResults);
            
            // Count results
            videoResults.forEach(result => {
                if (result.status === 'match') totalMatches++;
                else if (result.status === 'mismatch') totalMismatches++;
                else totalErrors++;
            });
            
            processedCount++;
            
            // Add delay between videos
            if (i < videosToCheck.length - 1 && config.delayBetweenVideos > 0) {
                console.log(`⏱️  Waiting ${config.delayBetweenVideos}ms...`);
                await new Promise(resolve => setTimeout(resolve, config.delayBetweenVideos));
            }
        }
        
        // Generate summary report
        console.log(`\n📊 Caption Language Validation Summary:`);
        console.log(`🎬 Videos processed: ${processedCount}`);
        console.log(`📝 Total captions checked: ${allResults.length}`);
        console.log(`✅ Language matches: ${totalMatches}`);
        console.log(`⚠️  Language mismatches: ${totalMismatches}`);
        console.log(`❌ Errors/Issues: ${totalErrors}`);
        
        // Show mismatches
        const mismatches = allResults.filter(r => r.status === 'mismatch');
        if (mismatches.length > 0) {
            console.log(`\n⚠️  Language Mismatches Found:`);
            mismatches.forEach(result => {
                console.log(`   📹 ${result.videoTitle} (${result.videoId})`);
                console.log(`   🏷️  ${result.language}: Expected ${result.language}, Detected ${result.detectedLangCode}`);
                console.log(`   📖 Text: "${result.firstWords}"`);
                console.log('');
            });
        }
        
        // Save detailed report to JSON file
        const report = {
            summary: {
                processedAt: new Date().toISOString(),
                videosProcessed: processedCount,
                totalCaptions: allResults.length,
                matches: totalMatches,
                mismatches: totalMismatches,
                errors: totalErrors
            },
            results: allResults
        };
        
        fs.writeFileSync(config.outputFile, JSON.stringify(report, null, 2));
        console.log(`💾 Detailed report saved to: ${config.outputFile}`);
        
        console.log(`\n🎉 Caption validation complete!`);
        
    } catch (error) {
        console.error('❌ Error in caption validation process:', error.message);
        process.exit(1);
    }
}

// Execute if this file is run directly
if (require.main === module) {
    validateAllCaptions().catch(error => {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = {
    validateAllCaptions,
    validateVideoCaption,
    getAllVideos,
    getVideoCaption,
    downloadVttContent,
    detectLanguageWithAI,
    extractFirstWords
}; 