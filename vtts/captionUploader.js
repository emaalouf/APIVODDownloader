require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getAccessToken } = require('../auth.js');
const { parseVideoFilename } = require('./vttGenerator.js');

// Configuration from environment variables
const config = {
    vttOutputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles',
    defaultLanguage: process.env.CAPTION_LANGUAGE || 'en'
};

/**
 * Uploads a VTT caption file to API.video
 */
async function uploadCaption(videoId, vttFilePath, accessToken, language = 'en') {
    const filename = path.basename(vttFilePath);
    
    try {
        console.log(`📤 Uploading caption for video ${videoId}...`);
        console.log(`    File: ${filename}`);
        console.log(`    Language: ${language}`);
        
        // Read the VTT file
        const vttContent = fs.readFileSync(vttFilePath);
        
        // Create form data
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('file', vttContent, {
            filename: filename,
            contentType: 'text/vtt'
        });
        
        // Upload caption to API.video
        const response = await axios.post(
            `https://ws.api.video/videos/${videoId}/captions/${language}`,
            formData,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    ...formData.getHeaders()
                }
            }
        );
        
        if (response.status === 200 || response.status === 201) {
            console.log(`✅ Caption uploaded successfully for video ${videoId}`);
            return { success: true, videoId, filename };
        } else {
            console.error(`❌ Failed to upload caption for video ${videoId}: ${response.status}`);
            return { success: false, videoId, filename, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        console.error(`❌ Error uploading caption for video ${videoId}:`, error.response?.data || error.message);
        return { success: false, videoId, filename, error: error.message };
    }
}

/**
 * Uploads all VTT files with video IDs to API.video
 */
async function uploadAllCaptions() {
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
        
        // Filter files that have video IDs
        const filesWithVideoId = [];
        const filesWithoutVideoId = [];
        
        vttFiles.forEach(filePath => {
            const filename = path.basename(filePath);
            const videoInfo = parseVideoFilename(filename.replace('.vtt', '.mp4'));
            
            if (videoInfo.hasVideoId) {
                filesWithVideoId.push({ filePath, videoId: videoInfo.videoId, filename });
            } else {
                filesWithoutVideoId.push({ filePath, filename });
            }
        });
        
        console.log(`\n📊 Caption Upload Overview:`);
        console.log(`🎬 Total VTT files: ${vttFiles.length}`);
        console.log(`🆔 Files with video IDs: ${filesWithVideoId.length}`);
        console.log(`⚠️  Files without video IDs: ${filesWithoutVideoId.length}`);
        
        if (filesWithoutVideoId.length > 0) {
            console.log(`\n⚠️  The following files cannot be uploaded (missing video IDs):`);
            filesWithoutVideoId.forEach(file => {
                console.log(`   - ${file.filename}`);
            });
            console.log(`💡 Re-download videos to get files with video IDs`);
        }
        
        if (filesWithVideoId.length === 0) {
            console.log(`❌ No files with video IDs found. Cannot upload captions.`);
            return;
        }
        
        console.log(`\n🚀 Starting caption upload for ${filesWithVideoId.length} files...`);
        
        let successCount = 0;
        let failureCount = 0;
        const results = [];
        
        for (let i = 0; i < filesWithVideoId.length; i++) {
            const { filePath, videoId, filename } = filesWithVideoId[i];
            
            console.log(`\n📤 Uploading ${i + 1}/${filesWithVideoId.length}: ${filename}`);
            
            const result = await uploadCaption(videoId, filePath, accessToken, config.defaultLanguage);
            results.push(result);
            
            if (result.success) {
                successCount++;
            } else {
                failureCount++;
            }
            
            // Add delay between uploads to be respectful to the API
            if (i < filesWithVideoId.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        // Summary
        console.log(`\n📊 Caption Upload Summary:`);
        console.log(`✅ Successful uploads: ${successCount}`);
        console.log(`❌ Failed uploads: ${failureCount}`);
        
        if (failureCount > 0) {
            console.log(`\n❌ Failed uploads:`);
            results.filter(r => !r.success).forEach(result => {
                console.log(`   - ${result.filename} (${result.videoId}): ${result.error}`);
            });
        }
        
        if (successCount > 0) {
            console.log(`\n✅ Successfully uploaded captions for ${successCount} videos!`);
            console.log(`💡 Captions are now available on your API.video videos`);
        }
        
    } catch (error) {
        console.error('❌ Error in caption upload process:', error.message);
        process.exit(1);
    }
}

/**
 * Uploads caption for a specific video ID
 */
async function uploadCaptionForVideo(videoId, vttFilePath, language = 'en') {
    try {
        // Get access token
        console.log('🔑 Getting access token...');
        const tokenData = await getAccessToken();
        const accessToken = tokenData.access_token;
        
        // Check if VTT file exists
        if (!fs.existsSync(vttFilePath)) {
            console.error(`❌ VTT file not found: ${vttFilePath}`);
            return false;
        }
        
        // Upload caption
        const result = await uploadCaption(videoId, vttFilePath, accessToken, language);
        
        if (result.success) {
            console.log(`🎉 Caption upload completed successfully!`);
            return true;
        } else {
            console.error(`❌ Caption upload failed: ${result.error}`);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Error uploading caption:', error.message);
        return false;
    }
}

/**
 * Main function for caption uploading
 */
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length >= 2) {
        // Upload specific file: node captionUploader.js <videoId> <vttFilePath> [language]
        const videoId = args[0];
        const vttFilePath = args[1];
        const language = args[2] || config.defaultLanguage;
        
        console.log(`🎬 Uploading caption for specific video...`);
        console.log(`Video ID: ${videoId}`);
        console.log(`VTT File: ${vttFilePath}`);
        console.log(`Language: ${language}`);
        
        await uploadCaptionForVideo(videoId, vttFilePath, language);
    } else {
        // Upload all VTT files with video IDs
        console.log('🎬 Starting bulk caption upload process...');
        console.log(`📂 VTT source: ${config.vttOutputFolder}`);
        console.log(`🌐 Default language: ${config.defaultLanguage}`);
        
        await uploadAllCaptions();
    }
}

// Execute if this file is run directly
if (require.main === module) {
    main();
}

module.exports = { 
    uploadCaption, 
    uploadAllCaptions, 
    uploadCaptionForVideo,
    config
}; 