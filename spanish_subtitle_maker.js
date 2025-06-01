require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getAccessToken, makeAuthenticatedRequest } = require('./auth.js');

// Configuration
const config = {
    vttOutputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles',
    apiBaseUrl: 'https://ws.api.video',
    delayBetweenRequests: 100, // 0.1 second delay between requests
    spanishLanguageCode: 'es'
};

/**
 * Deletes an existing Spanish caption for a video
 */
async function deleteSpanishCaption(videoId) {
    try {
        console.log(`🗑️  Deleting existing Spanish caption for video ${videoId}...`);
        
        const response = await makeAuthenticatedRequest({
            method: 'DELETE',
            url: `${config.apiBaseUrl}/videos/${videoId}/captions/${config.spanishLanguageCode}`
        });
        
        if (response.status === 204) {
            console.log(`✅ Successfully deleted Spanish caption for video ${videoId}`);
            return { success: true };
        } else {
            console.error(`❌ Failed to delete Spanish caption: HTTP ${response.status}`);
            return { success: false, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        // 404 is expected if caption doesn't exist
        if (error.response?.status === 404) {
            console.log(`ℹ️  No existing Spanish caption found for video ${videoId} (will create new one)`);
            return { success: true };
        }
        
        console.error(`❌ Error deleting Spanish caption:`, error.response?.data || error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Uploads a Spanish VTT caption file to API.video
 */
async function uploadSpanishCaption(videoId, vttFilePath) {
    const filename = path.basename(vttFilePath);
    
    try {
        console.log(`📤 Uploading Spanish caption for video ${videoId}...`);
        console.log(`    File: ${filename}`);
        console.log(`    Language: Spanish (es)`);
        
        // Read the VTT file
        const vttContent = fs.readFileSync(vttFilePath);
        
        // Create form data
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('file', vttContent, {
            filename: filename,
            contentType: 'text/vtt'
        });
        
        // Upload caption to API.video using authenticated request
        const response = await makeAuthenticatedRequest({
            method: 'POST',
            url: `${config.apiBaseUrl}/videos/${videoId}/captions/${config.spanishLanguageCode}`,
            data: formData,
            headers: {
                ...formData.getHeaders()
            }
        });
        
        if (response.status === 200 || response.status === 201) {
            console.log(`✅ Spanish caption uploaded successfully for video ${videoId}`);
            return { success: true, videoId, filename };
        } else {
            console.error(`❌ Failed to upload Spanish caption for video ${videoId}: ${response.status}`);
            return { success: false, videoId, filename, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        console.error(`❌ Error uploading Spanish caption for video ${videoId}:`, error.response?.data || error.message);
        return { success: false, videoId, filename, error: error.message };
    }
}

/**
 * Extracts video ID from filename using various patterns
 */
function extractVideoId(filename) {
    // Pattern 1: [videoId]_title_es.vtt
    const pattern1 = filename.match(/^\[([^\]]+)\]_.+_es\.vtt$/);
    if (pattern1) {
        return pattern1[1];
    }
    
    // Pattern 2: videoId_title_es.vtt (without brackets)
    const pattern2 = filename.match(/^([a-zA-Z0-9]{10,})_.+_es\.vtt$/);
    if (pattern2) {
        return pattern2[1];
    }
    
    // Pattern 3: title_videoId_es.vtt
    const pattern3 = filename.match(/^.+_([a-zA-Z0-9]{10,})_es\.vtt$/);
    if (pattern3) {
        return pattern3[1];
    }
    
    return null;
}

/**
 * Finds all Spanish subtitle files (containing '_es')
 */
function findSpanishSubtitleFiles() {
    if (!fs.existsSync(config.vttOutputFolder)) {
        console.error(`❌ Subtitle folder not found: ${config.vttOutputFolder}`);
        return [];
    }
    
    const allFiles = fs.readdirSync(config.vttOutputFolder);
    const spanishFiles = [];
    
    for (const filename of allFiles) {
        // Check if file contains '_es' and is a VTT file
        if (filename.includes('_es') && filename.toLowerCase().endsWith('.vtt')) {
            const filePath = path.join(config.vttOutputFolder, filename);
            const videoId = extractVideoId(filename);
            
            spanishFiles.push({
                filename,
                filePath,
                videoId,
                hasVideoId: !!videoId
            });
        }
    }
    
    return spanishFiles;
}

/**
 * Processes a single Spanish subtitle file
 */
async function processSpanishSubtitle(file) {
    const { filename, filePath, videoId } = file;
    
    console.log(`\n🎬 Processing: ${filename}`);
    
    if (!videoId) {
        console.log(`❌ Could not extract video ID from filename: ${filename}`);
        return { 
            success: false, 
            filename, 
            error: 'Could not extract video ID from filename' 
        };
    }
    
    console.log(`📋 Video ID: ${videoId}`);
    
    try {
        // Step 1: Delete existing Spanish caption
        const deleteResult = await deleteSpanishCaption(videoId);
        if (!deleteResult.success) {
            console.log(`⚠️  Warning: Could not delete existing Spanish caption: ${deleteResult.error}`);
            console.log(`🔄 Continuing with upload anyway...`);
        }
        
        // Small delay between delete and upload
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Step 2: Upload new Spanish caption
        const uploadResult = await uploadSpanishCaption(videoId, filePath);
        
        return {
            success: uploadResult.success,
            filename,
            videoId,
            error: uploadResult.error,
            action: 'replaced'
        };
        
    } catch (error) {
        console.error(`❌ Error processing ${filename}:`, error.message);
        return {
            success: false,
            filename,
            videoId,
            error: error.message
        };
    }
}

/**
 * Main function to process all Spanish subtitle files
 */
async function processAllSpanishSubtitles() {
    try {
        console.log('🇪🇸 Spanish Subtitle Maker - Starting Process...');
        console.log('🎯 Finding all subtitle files with "_es" in their name...');
        
        // Ensure we have valid authentication (handled automatically by makeAuthenticatedRequest)
        console.log('🔑 Ensuring valid authentication...');
        
        // Find all Spanish subtitle files
        const spanishFiles = findSpanishSubtitleFiles();
        
        console.log(`\n📊 Spanish Subtitle Files Overview:`);
        console.log(`📁 Subtitle folder: ${config.vttOutputFolder}`);
        console.log(`🔍 Files with "_es": ${spanishFiles.length}`);
        
        if (spanishFiles.length === 0) {
            console.log(`📭 No Spanish subtitle files found.`);
            console.log(`💡 Make sure your Spanish subtitle files contain "_es" in their filename.`);
            return;
        }
        
        // Separate files with and without video IDs
        const filesWithVideoId = spanishFiles.filter(file => file.hasVideoId);
        const filesWithoutVideoId = spanishFiles.filter(file => !file.hasVideoId);
        
        console.log(`🆔 Files with video IDs: ${filesWithVideoId.length}`);
        console.log(`⚠️  Files without video IDs: ${filesWithoutVideoId.length}`);
        
        if (filesWithoutVideoId.length > 0) {
            console.log(`\n⚠️  The following files cannot be processed (missing video IDs):`);
            filesWithoutVideoId.forEach(file => {
                console.log(`   - ${file.filename}`);
            });
            console.log(`💡 Ensure video IDs are included in filenames`);
        }
        
        if (filesWithVideoId.length === 0) {
            console.log(`❌ No processable Spanish subtitle files found.`);
            return;
        }
        
        console.log(`\n🚀 Processing ${filesWithVideoId.length} Spanish subtitle files...`);
        
        let successCount = 0;
        let failureCount = 0;
        const results = [];
        
        for (let i = 0; i < filesWithVideoId.length; i++) {
            const file = filesWithVideoId[i];
            
            console.log(`\n📈 Progress: ${i + 1}/${filesWithVideoId.length}`);
            
            const result = await processSpanishSubtitle(file);
            results.push(result);
            
            if (result.success) {
                successCount++;
            } else {
                failureCount++;
            }
            
            // Add delay between uploads to be respectful to the API
            if (i < filesWithVideoId.length - 1) {
                console.log(`⏳ Waiting ${config.delayBetweenRequests}ms before next file...`);
                await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
            }
        }
        
        // Summary
        console.log(`\n📊 Spanish Subtitle Processing Summary:`);
        console.log(`✅ Successful uploads: ${successCount}`);
        console.log(`❌ Failed uploads: ${failureCount}`);
        
        if (failureCount > 0) {
            console.log(`\n❌ Failed uploads:`);
            results.filter(r => !r.success).forEach(result => {
                console.log(`   - ${result.filename} (${result.videoId || 'unknown'}): ${result.error}`);
            });
        }
        
        if (successCount > 0) {
            console.log(`\n🎉 Successfully processed ${successCount} Spanish subtitle files!`);
            console.log(`🇪🇸 Spanish captions are now available on your API.video videos`);
        }
        
        return {
            total: filesWithVideoId.length,
            successful: successCount,
            failed: failureCount,
            results
        };
        
    } catch (error) {
        console.error('❌ Error in Spanish subtitle processing:', error.message);
        process.exit(1);
    }
}

/**
 * Processes Spanish subtitle for a specific video ID
 */
async function processSpanishSubtitleForVideo(videoId, vttFilePath) {
    try {
        console.log(`🇪🇸 Processing Spanish subtitle for specific video: ${videoId}`);
        
        // Ensure we have valid authentication (handled automatically by makeAuthenticatedRequest)
        console.log('🔑 Ensuring valid authentication...');
        
        // Check if VTT file exists
        if (!fs.existsSync(vttFilePath)) {
            console.error(`❌ VTT file not found: ${vttFilePath}`);
            return false;
        }
        
        // Delete existing Spanish caption
        const deleteResult = await deleteSpanishCaption(videoId);
        if (!deleteResult.success) {
            console.log(`⚠️  Warning: Could not delete existing Spanish caption: ${deleteResult.error}`);
            console.log(`🔄 Continuing with upload anyway...`);
        }
        
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Upload new Spanish caption
        const uploadResult = await uploadSpanishCaption(videoId, vttFilePath);
        
        if (uploadResult.success) {
            console.log(`🎉 Spanish subtitle processing completed successfully!`);
            return true;
        } else {
            console.error(`❌ Spanish subtitle processing failed: ${uploadResult.error}`);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Error processing Spanish subtitle:', error.message);
        return false;
    }
}

// Execute the function if this file is run directly
if (require.main === module) {
    const command = process.argv[2];
    const videoId = process.argv[3];
    const filePath = process.argv[4];
    
    if (command === 'single' && videoId && filePath) {
        processSpanishSubtitleForVideo(videoId, filePath)
            .then(success => {
                if (success) {
                    console.log('\nSpanish subtitle processing completed successfully!');
                    process.exit(0);
                } else {
                    console.log('\nSpanish subtitle processing failed!');
                    process.exit(1);
                }
            })
            .catch(error => {
                console.error('\nError:', error.message);
                process.exit(1);
            });
    } else {
        processAllSpanishSubtitles()
            .then(result => {
                if (result && result.successful > 0) {
                    console.log('\nSpanish subtitle processing completed!');
                    process.exit(0);
                } else {
                    console.log('\nNo Spanish subtitles were processed successfully.');
                    process.exit(1);
                }
            })
            .catch(error => {
                console.error('\nError:', error.message);
                process.exit(1);
            });
    }
}

module.exports = {
    processAllSpanishSubtitles,
    processSpanishSubtitleForVideo,
    findSpanishSubtitleFiles,
    deleteSpanishCaption,
    uploadSpanishCaption,
    extractVideoId
}; 