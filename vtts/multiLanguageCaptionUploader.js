require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getAccessToken } = require('../auth.js');
const { parseVideoFilename, languageMapping } = require('./multiLanguageVttGenerator.js');

// Configuration from environment variables
const config = {
    vttOutputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles',
    captionLanguages: (process.env.CAPTION_LANGUAGES || 'ar,en,fr,es,it').split(',')
};

/**
 * Checks if captions already exist for a specific video and language
 */
async function checkExistingCaptions(videoId, languageCode, accessToken) {
    try {
        const response = await axios.get(
            `https://ws.api.video/videos/${videoId}/captions/${languageCode}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        // If we get a successful response, captions exist
        return response.status === 200;
        
    } catch (error) {
        // If we get a 404, captions don't exist
        if (error.response?.status === 404) {
            return false;
        }
        
        // For other errors, assume captions don't exist and log the error
        console.log(`⚠️  Could not check existing captions for ${languageCode}: ${error.response?.status || error.message}`);
        return false;
    }
}

/**
 * Uploads or updates a VTT caption file to API.video for a specific language
 */
async function uploadCaptionForLanguage(videoId, vttFilePath, languageCode, accessToken) {
    const filename = path.basename(vttFilePath);
    const languageInfo = languageMapping[languageCode];
    
    try {
        // Check if captions already exist
        console.log(`🔍 Checking existing captions for ${languageInfo.name}...`);
        const captionsExist = await checkExistingCaptions(videoId, languageCode, accessToken);
        
        const method = captionsExist ? 'PATCH' : 'POST';
        const action = captionsExist ? 'Updating' : 'Uploading';
        
        console.log(`📤 ${action} ${languageInfo.name} caption for video ${videoId}...`);
        console.log(`    File: ${filename}`);
        console.log(`    Language: ${languageInfo.name} (${languageCode})`);
        console.log(`    Method: ${method} ${captionsExist ? '(updating existing)' : '(creating new)'}`);
        
        // Read the VTT file
        const vttContent = fs.readFileSync(vttFilePath);
        
        // Create form data
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('file', vttContent, {
            filename: filename,
            contentType: 'text/vtt'
        });
        
        // Upload or update caption to API.video
        const response = await axios({
            method: method,
            url: `https://ws.api.video/videos/${videoId}/captions/${languageInfo.apiVideoCode}`,
            data: formData,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                ...formData.getHeaders()
            }
        });
        
        if (response.status === 200 || response.status === 201) {
            const successAction = captionsExist ? 'updated' : 'uploaded';
            console.log(`✅ ${languageInfo.name} caption ${successAction} successfully for video ${videoId}`);
            return { 
                success: true, 
                videoId, 
                filename, 
                languageCode, 
                languageName: languageInfo.name,
                action: successAction,
                method: method
            };
        } else {
            console.error(`❌ Failed to ${action.toLowerCase()} ${languageInfo.name} caption for video ${videoId}: ${response.status}`);
            return { 
                success: false, 
                videoId, 
                filename, 
                languageCode, 
                languageName: languageInfo.name, 
                error: `HTTP ${response.status}`,
                method: method
            };
        }
        
    } catch (error) {
        console.error(`❌ Error uploading ${languageInfo.name} caption for video ${videoId}:`, error.response?.data || error.message);
        return { 
            success: false, 
            videoId, 
            filename, 
            languageCode, 
            languageName: languageInfo.name, 
            error: error.message 
        };
    }
}

/**
 * Finds all VTT files for a specific video ID across all languages
 */
function findVttFilesForVideo(videoId) {
    if (!fs.existsSync(config.vttOutputFolder)) {
        return [];
    }
    
    const allVttFiles = fs.readdirSync(config.vttOutputFolder)
        .filter(file => file.toLowerCase().endsWith('.vtt'))
        .map(file => path.join(config.vttOutputFolder, file));
    
    const videoVttFiles = [];
    
    for (const filePath of allVttFiles) {
        const filename = path.basename(filePath);
        
        // Check if filename contains the video ID and extract language
        const videoIdMatch = filename.match(/^\[([^\]]+)\]_(.+)_([a-z]{2})\.vtt$/);
        if (videoIdMatch && videoIdMatch[1] === videoId) {
            const [, extractedVideoId, title, languageCode] = videoIdMatch;
            
            if (config.captionLanguages.includes(languageCode) && languageMapping[languageCode]) {
                videoVttFiles.push({
                    filePath,
                    filename,
                    videoId: extractedVideoId,
                    title,
                    languageCode,
                    languageName: languageMapping[languageCode].name
                });
            }
        }
    }
    
    return videoVttFiles;
}

/**
 * Uploads all VTT files with video IDs to API.video for all configured languages
 */
async function uploadAllMultiLanguageCaptions() {
    try {
        // Get access token
        console.log('🔑 Getting access token...');
        const tokenData = await getAccessToken();
        const accessToken = tokenData.access_token;
        
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
        
        // Parse and group files by video ID and language
        const videoLanguageFiles = {};
        const filesWithoutVideoId = [];
        
        vttFiles.forEach(filePath => {
            const filename = path.basename(filePath);
            
            // Check for multi-language format: [videoId]_title_lang.vtt
            const multiLangMatch = filename.match(/^\[([^\]]+)\]_(.+)_([a-z]{2})\.vtt$/);
            
            if (multiLangMatch) {
                const [, videoId, title, languageCode] = multiLangMatch;
                
                if (config.captionLanguages.includes(languageCode) && languageMapping[languageCode]) {
                    if (!videoLanguageFiles[videoId]) {
                        videoLanguageFiles[videoId] = {
                            videoId,
                            title,
                            languages: {}
                        };
                    }
                    
                    videoLanguageFiles[videoId].languages[languageCode] = {
                        filePath,
                        filename,
                        languageCode,
                        languageName: languageMapping[languageCode].name
                    };
                }
            } else {
                // Check for old single-language format: [videoId]_title.vtt
                const singleLangMatch = filename.match(/^\[([^\]]+)\]_(.+)\.vtt$/);
                if (singleLangMatch) {
                    const [, videoId, title] = singleLangMatch;
                    
                    if (!videoLanguageFiles[videoId]) {
                        videoLanguageFiles[videoId] = {
                            videoId,
                            title,
                            languages: {}
                        };
                    }
                    
                    // Assume English for single-language files
                    videoLanguageFiles[videoId].languages['en'] = {
                        filePath,
                        filename,
                        languageCode: 'en',
                        languageName: 'English'
                    };
                } else {
                    filesWithoutVideoId.push({ filePath, filename });
                }
            }
        });
        
        const videoIds = Object.keys(videoLanguageFiles);
        let totalLanguageFiles = 0;
        
        videoIds.forEach(videoId => {
            totalLanguageFiles += Object.keys(videoLanguageFiles[videoId].languages).length;
        });
        
        console.log(`\n📊 Multi-Language Caption Upload Overview:`);
        console.log(`🎬 Videos with captions: ${videoIds.length}`);
        console.log(`📄 Total caption files: ${totalLanguageFiles}`);
        console.log(`🌐 Languages available: ${config.captionLanguages.map(lang => languageMapping[lang].name).join(', ')}`);
        console.log(`⚠️  Files without video IDs: ${filesWithoutVideoId.length}`);
        
        if (filesWithoutVideoId.length > 0) {
            console.log(`\n⚠️  The following files cannot be uploaded (missing video IDs):`);
            filesWithoutVideoId.forEach(file => {
                console.log(`   - ${file.filename}`);
            });
            console.log(`💡 Re-generate VTT files to get proper format with video IDs`);
        }
        
        if (videoIds.length === 0) {
            console.log(`❌ No files with video IDs found. Cannot upload captions.`);
            return;
        }
        
        console.log(`\n🚀 Starting multi-language caption upload for ${videoIds.length} videos...`);
        
        let successCount = 0;
        let failureCount = 0;
        const results = [];
        
        for (let i = 0; i < videoIds.length; i++) {
            const videoId = videoIds[i];
            const videoData = videoLanguageFiles[videoId];
            const languages = Object.keys(videoData.languages);
            
            console.log(`\n📤 Uploading ${i + 1}/${videoIds.length}: ${videoData.title}`);
            console.log(`🆔 Video ID: ${videoId}`);
            console.log(`🌐 Languages: ${languages.map(lang => languageMapping[lang].name).join(', ')}`);
            
            let videoSuccessCount = 0;
            let videoFailureCount = 0;
            
            // Upload captions for each language
            for (const languageCode of languages) {
                const langData = videoData.languages[languageCode];
                
                const result = await uploadCaptionForLanguage(
                    videoId, 
                    langData.filePath, 
                    languageCode, 
                    accessToken
                );
                
                results.push(result);
                
                if (result.success) {
                    videoSuccessCount++;
                } else {
                    videoFailureCount++;
                }
                
                // Small delay between language uploads
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            if (videoSuccessCount > 0) {
                successCount++;
            }
            if (videoFailureCount > 0) {
                failureCount++;
            }
            
            console.log(`📊 Video summary: ${videoSuccessCount} successful, ${videoFailureCount} failed`);
            
            // Add delay between videos to be respectful to the API
            if (i < videoIds.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        // Overall Summary
        console.log(`\n📊 Multi-Language Caption Upload Summary:`);
        console.log(`✅ Videos with successful uploads: ${successCount}`);
        console.log(`❌ Videos with failed uploads: ${failureCount}`);
        
        // Action-specific summary
        const createdCount = results.filter(r => r.success && r.action === 'uploaded').length;
        const updatedCount = results.filter(r => r.success && r.action === 'updated').length;
        
        console.log(`\n🔄 Caption Actions Summary:`);
        console.log(`🆕 New captions created: ${createdCount}`);
        console.log(`📝 Existing captions updated: ${updatedCount}`);
        console.log(`📊 Total successful operations: ${createdCount + updatedCount}`);
        
        // Language-specific summary
        const languageSummary = {};
        config.captionLanguages.forEach(lang => {
            const langResults = results.filter(r => r.languageCode === lang);
            languageSummary[lang] = {
                successful: langResults.filter(r => r.success).length,
                failed: langResults.filter(r => !r.success).length,
                created: langResults.filter(r => r.success && r.action === 'uploaded').length,
                updated: langResults.filter(r => r.success && r.action === 'updated').length,
                name: languageMapping[lang].name
            };
        });
        
        console.log(`\n🌐 Language-specific Summary:`);
        Object.keys(languageSummary).forEach(lang => {
            const summary = languageSummary[lang];
            if (summary.successful > 0 || summary.failed > 0) {
                console.log(`   ${summary.name}: ${summary.successful} successful (${summary.created} created, ${summary.updated} updated), ${summary.failed} failed`);
            }
        });
        
        if (failureCount > 0) {
            console.log(`\n❌ Failed uploads:`);
            results.filter(r => !r.success).forEach(result => {
                console.log(`   - ${result.filename} (${result.videoId}, ${result.languageName}): ${result.error}`);
            });
        }
        
        if (successCount > 0) {
            console.log(`\n✅ Successfully uploaded multi-language captions for ${successCount} videos!`);
            console.log(`💡 Captions are now available on your API.video videos in multiple languages`);
        }
        
    } catch (error) {
        console.error('❌ Error in multi-language caption upload process:', error.message);
        process.exit(1);
    }
}

/**
 * Uploads captions for a specific video ID in all available languages
 */
async function uploadCaptionsForVideo(videoId, language = null) {
    try {
        // Get access token
        console.log('🔑 Getting access token...');
        const tokenData = await getAccessToken();
        const accessToken = tokenData.access_token;
        
        // Find VTT files for this video
        const vttFiles = findVttFilesForVideo(videoId);
        
        if (vttFiles.length === 0) {
            console.error(`❌ No VTT files found for video ID: ${videoId}`);
            console.log(`💡 Expected filename format: [${videoId}]_title_lang.vtt`);
            return false;
        }
        
        // Filter by specific language if provided
        const filesToUpload = language ? 
            vttFiles.filter(file => file.languageCode === language) : 
            vttFiles;
        
        if (filesToUpload.length === 0) {
            console.error(`❌ No VTT files found for video ID ${videoId}${language ? ` in language ${language}` : ''}`);
            return false;
        }
        
        console.log(`🎬 Uploading captions for video: ${videoId}`);
        console.log(`🌐 Languages: ${filesToUpload.map(f => f.languageName).join(', ')}`);
        
        let successCount = 0;
        let failureCount = 0;
        
        // Upload each language
        for (const fileData of filesToUpload) {
            const result = await uploadCaptionForLanguage(
                videoId, 
                fileData.filePath, 
                fileData.languageCode, 
                accessToken
            );
            
            if (result.success) {
                successCount++;
            } else {
                failureCount++;
            }
            
            // Small delay between uploads
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        console.log(`\n📊 Upload Summary for ${videoId}:`);
        console.log(`✅ Successful: ${successCount}`);
        console.log(`❌ Failed: ${failureCount}`);
        
        return successCount > 0;
        
    } catch (error) {
        console.error('❌ Error uploading captions for video:', error.message);
        return false;
    }
}

/**
 * Main function for multi-language caption uploading
 */
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length >= 1) {
        // Upload for specific video: node multiLanguageCaptionUploader.js <videoId> [language]
        const videoId = args[0];
        const language = args[1]; // Optional specific language
        
        console.log(`🎬 Uploading captions for specific video...`);
        console.log(`Video ID: ${videoId}`);
        if (language) {
            console.log(`Language: ${languageMapping[language]?.name || language}`);
        } else {
            console.log(`Languages: All available`);
        }
        
        await uploadCaptionsForVideo(videoId, language);
    } else {
        // Upload all multi-language VTT files
        console.log('🌐 Starting bulk multi-language caption upload process...');
        console.log(`📂 VTT source: ${config.vttOutputFolder}`);
        console.log(`🌐 Target languages: ${config.captionLanguages.map(lang => languageMapping[lang].name).join(', ')}`);
        
        await uploadAllMultiLanguageCaptions();
    }
}

// Execute if this file is run directly
if (require.main === module) {
    main();
}

module.exports = { 
    uploadCaptionForLanguage,
    uploadAllMultiLanguageCaptions, 
    uploadCaptionsForVideo,
    findVttFilesForVideo,
    config,
    languageMapping
}; 