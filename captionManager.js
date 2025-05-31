require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { getAccessToken, makeAuthenticatedRequest } = require('./auth.js');

// Configuration from environment variables
const config = {
    vttOutputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles',
    defaultLanguage: process.env.CAPTION_LANGUAGE || 'en',
    apiBaseUrl: 'https://ws.api.video'
};

/**
 * Gets all captions for a specific video
 */
async function getVideoCaptions(videoId) {
    try {
        console.log(`📋 Getting captions for video ${videoId}...`);
        
        const response = await makeAuthenticatedRequest({
            method: 'GET',
            url: `${config.apiBaseUrl}/videos/${videoId}/captions`
        });
        
        if (response.status === 200) {
            console.log(`✅ Retrieved ${response.data.data.length} captions for video ${videoId}`);
            return { success: true, captions: response.data.data };
        } else {
            console.error(`❌ Failed to get captions for video ${videoId}: ${response.status}`);
            return { success: false, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        console.error(`❌ Error getting captions for video ${videoId}:`, error.response?.data || error.message);
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
            console.log(`✅ Successfully deleted ${language} caption for video ${videoId}`);
            return { success: true };
        } else {
            console.error(`❌ Failed to delete ${language} caption for video ${videoId}: ${response.status}`);
            return { success: false, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        // 404 is expected if caption doesn't exist
        if (error.response?.status === 404) {
            console.log(`ℹ️  No ${language} caption found for video ${videoId} (already deleted or never existed)`);
            return { success: true };
        }
        
        console.error(`❌ Error deleting ${language} caption for video ${videoId}:`, error.response?.data || error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Uploads a VTT caption file to API.video
 */
async function uploadCaption(videoId, vttFilePath, language = 'en') {
    const filename = path.basename(vttFilePath);
    
    try {
        console.log(`📤 Uploading ${language} caption for video ${videoId}...`);
        console.log(`    File: ${filename}`);
        
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
 * Manages captions for a single video: get, delete, and re-upload
 */
async function manageVideoCaption(videoId, vttFilePath, language = 'en') {
    console.log(`\n🎬 Managing ${language} caption for video ${videoId}`);
    console.log(`📁 VTT file: ${vttFilePath}`);
    
    try {
        // Step 1: Get existing captions
        const captionsResult = await getVideoCaptions(videoId);
        if (!captionsResult.success) {
            return { success: false, step: 'get_captions', error: captionsResult.error };
        }
        
        // Check if the target language caption exists
        const existingCaption = captionsResult.captions.find(caption => caption.srclang === language);
        
        // Step 2: Delete existing caption if it exists
        if (existingCaption) {
            console.log(`🔍 Found existing ${language} caption, deleting...`);
            const deleteResult = await deleteCaption(videoId, language);
            if (!deleteResult.success) {
                return { success: false, step: 'delete_caption', error: deleteResult.error };
            }
        } else {
            console.log(`ℹ️  No existing ${language} caption found`);
        }
        
        // Step 3: Upload new VTT file
        const uploadResult = await uploadCaption(videoId, vttFilePath, language);
        if (!uploadResult.success) {
            return { success: false, step: 'upload_caption', error: uploadResult.error };
        }
        
        console.log(`🎉 Successfully managed ${language} caption for video ${videoId}!`);
        return { success: true, videoId, language };
        
    } catch (error) {
        console.error(`❌ Error managing caption for video ${videoId}:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Parses video ID from VTT filename
 * Expected format: [videoId]_Exe_4.mp4.vtt or [videoId]_Title_en.vtt
 */
function parseVideoIdFromVttFilename(filename) {
    // Remove .vtt extension
    const nameWithoutVtt = filename.replace(/\.vtt$/, '');
    
    // Look for pattern [videoId] at the beginning
    const match = nameWithoutVtt.match(/^\[([^\]]+)\]/);
    
    if (match) {
        return {
            hasVideoId: true,
            videoId: match[1],
            originalFilename: filename
        };
    }
    
    return {
        hasVideoId: false,
        originalFilename: filename
    };
}

/**
 * Processes all VTT files in the configured folder
 */
async function processAllVttFiles(language = null) {
    try {
        // Ensure we have valid authentication (this will handle token refresh automatically)
        console.log('🔑 Ensuring valid authentication...');
        await getAccessToken();
        
        // Find all VTT files
        if (!fs.existsSync(config.vttOutputFolder)) {
            console.error(`❌ VTT output folder not found: ${config.vttOutputFolder}`);
            return;
        }
        
        const vttFiles = fs.readdirSync(config.vttOutputFolder)
            .filter(file => file.toLowerCase().endsWith('.vtt'))
            .map(file => ({
                filename: file,
                fullPath: path.join(config.vttOutputFolder, file)
            }));
        
        if (vttFiles.length === 0) {
            console.log(`📭 No VTT files found in ${config.vttOutputFolder}`);
            return;
        }
        
        // Parse video IDs from filenames
        const filesWithVideoId = [];
        const filesWithoutVideoId = [];
        
        vttFiles.forEach(({ filename, fullPath }) => {
            const parseResult = parseVideoIdFromVttFilename(filename);
            
            if (parseResult.hasVideoId) {
                filesWithVideoId.push({
                    filename,
                    fullPath,
                    videoId: parseResult.videoId
                });
            } else {
                filesWithoutVideoId.push({ filename, fullPath });
            }
        });
        
        console.log(`\n📊 Caption Management Overview:`);
        console.log(`🎬 Total VTT files: ${vttFiles.length}`);
        console.log(`🆔 Files with video IDs: ${filesWithVideoId.length}`);
        console.log(`⚠️  Files without video IDs: ${filesWithoutVideoId.length}`);
        console.log(`🌍 Target language: ${language || config.defaultLanguage}`);
        
        if (filesWithoutVideoId.length > 0) {
            console.log(`\n⚠️  The following files cannot be processed (missing video IDs):`);
            filesWithoutVideoId.forEach(file => {
                console.log(`   - ${file.filename}`);
            });
            console.log(`💡 Expected format: [videoId]_Title.vtt`);
        }
        
        if (filesWithVideoId.length === 0) {
            console.log(`❌ No files with video IDs found. Cannot process captions.`);
            return;
        }
        
        console.log(`\n🚀 Starting caption management for ${filesWithVideoId.length} files...`);
        
        let successCount = 0;
        let failureCount = 0;
        const results = [];
        const targetLanguage = language || config.defaultLanguage;
        
        for (let i = 0; i < filesWithVideoId.length; i++) {
            const { filename, fullPath, videoId } = filesWithVideoId[i];
            
            console.log(`\n📹 Processing ${i + 1}/${filesWithVideoId.length}: ${filename}`);
            
            const result = await manageVideoCaption(videoId, fullPath, targetLanguage);
            results.push({ ...result, filename, videoId });
            
            if (result.success) {
                successCount++;
            } else {
                failureCount++;
            }
            
            // Add delay between operations to be respectful to the API
            if (i < filesWithVideoId.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        // Summary
        console.log(`\n📊 Caption Management Summary:`);
        console.log(`✅ Successful operations: ${successCount}`);
        console.log(`❌ Failed operations: ${failureCount}`);
        
        if (failureCount > 0) {
            console.log(`\n❌ Failed operations:`);
            results.filter(r => !r.success).forEach(result => {
                console.log(`   - ${result.filename} (${result.videoId}): ${result.error} (Step: ${result.step || 'unknown'})`);
            });
        }
        
        if (successCount > 0) {
            console.log(`\n🎉 Successfully managed captions for ${successCount} videos!`);
            console.log(`💡 All captions have been updated on API.video`);
        }
        
    } catch (error) {
        console.error('❌ Error in caption management process:', error.message);
        process.exit(1);
    }
}

/**
 * Processes a single VTT file by video ID
 */
async function processSingleVideo(videoId, vttFilePath, language = null) {
    try {
        // Ensure we have valid authentication (this will handle token refresh automatically)
        console.log('🔑 Ensuring valid authentication...');
        await getAccessToken();
        
        const targetLanguage = language || config.defaultLanguage;
        
        // Process the video
        const result = await manageVideoCaption(videoId, vttFilePath, targetLanguage);
        
        if (result.success) {
            console.log(`🎉 Caption management completed successfully for video ${videoId}!`);
            return true;
        } else {
            console.error(`❌ Caption management failed for video ${videoId}: ${result.error} (Step: ${result.step || 'unknown'})`);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Error processing single video:', error.message);
        return false;
    }
}

// Execute if this file is run directly
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        // Process all VTT files
        console.log('🚀 Processing all VTT files in the subtitles folder...');
        await processAllVttFiles();
    } else if (args.length >= 2) {
        // Process specific video
        const videoId = args[0];
        const vttFilePath = args[1];
        const language = args[2] || config.defaultLanguage;
        
        console.log(`🚀 Processing single video: ${videoId}`);
        console.log(`📁 VTT file: ${vttFilePath}`);
        console.log(`🌍 Language: ${language}`);
        
        await processSingleVideo(videoId, vttFilePath, language);
    } else {
        console.log(`
📖 Usage:
   
   Process all VTT files:
   node captionManager.js
   
   Process specific video:
   node captionManager.js <videoId> <vttFilePath> [language]
   
   Examples:
   node captionManager.js
   node captionManager.js vi2Y2FFzw8IVMZ8hXyKTBmcJ ./subtitles/[vi2Y2FFzw8IVMZ8hXyKTBmcJ]_Exe_4.mp4.vtt en
        `);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = {
    getVideoCaptions,
    deleteCaption,
    uploadCaption,
    manageVideoCaption,
    processAllVttFiles,
    processSingleVideo,
    parseVideoIdFromVttFilename
}; 