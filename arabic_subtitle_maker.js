require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getAccessToken, makeAuthenticatedRequest } = require('./auth.js');

// Configuration
const config = {
    vttOutputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles',
    apiBaseUrl: 'https://ws.api.video',
    delayBetweenRequests: 300, // 0.3 second delay between requests
    arabicLanguageCode: 'ar'
};

/**
 * Deletes an existing Arabic caption for a video
 */
async function deleteArabicCaption(videoId) {
    try {
        console.log(`🗑️  Deleting existing Arabic caption for video ${videoId}...`);
        
        const response = await makeAuthenticatedRequest({
            method: 'DELETE',
            url: `${config.apiBaseUrl}/videos/${videoId}/captions/${config.arabicLanguageCode}`
        });
        
        if (response.status === 204) {
            console.log(`✅ Successfully deleted Arabic caption for video ${videoId}`);
            return { success: true };
        } else {
            console.error(`❌ Failed to delete Arabic caption: HTTP ${response.status}`);
            return { success: false, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        // 404 is expected if caption doesn't exist
        if (error.response?.status === 404) {
            console.log(`ℹ️  No existing Arabic caption found for video ${videoId} (will create new one)`);
            return { success: true };
        }
        
        console.error(`❌ Error deleting Arabic caption:`, error.response?.data || error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Uploads an Arabic VTT caption file to API.video
 */
async function uploadArabicCaption(videoId, vttFilePath) {
    const filename = path.basename(vttFilePath);
    
    try {
        console.log(`📤 Uploading Arabic caption for video ${videoId}...`);
        console.log(`    File: ${filename}`);
        console.log(`    Language: Arabic (ar)`);
        
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
            url: `${config.apiBaseUrl}/videos/${videoId}/captions/${config.arabicLanguageCode}`,
            data: formData,
            headers: {
                ...formData.getHeaders()
            }
        });
        
        if (response.status === 200 || response.status === 201) {
            console.log(`✅ Arabic caption uploaded successfully for video ${videoId}`);
            return { success: true, videoId, filename };
        } else {
            console.error(`❌ Failed to upload Arabic caption for video ${videoId}: ${response.status}`);
            return { success: false, videoId, filename, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        console.error(`❌ Error uploading Arabic caption for video ${videoId}:`, error.response?.data || error.message);
        return { success: false, videoId, filename, error: error.message };
    }
}

/**
 * Extracts video ID from filename using various patterns
 */
function extractVideoId(filename) {
    // Pattern 1: [videoId]_title_ar.vtt
    const pattern1 = filename.match(/^\[([^\]]+)\]_.+_ar\.vtt$/);
    if (pattern1) {
        return pattern1[1];
    }
    
    // Pattern 2: videoId_title_ar.vtt (without brackets)
    const pattern2 = filename.match(/^([a-zA-Z0-9]{10,})_.+_ar\.vtt$/);
    if (pattern2) {
        return pattern2[1];
    }
    
    // Pattern 3: title_videoId_ar.vtt
    const pattern3 = filename.match(/^.+_([a-zA-Z0-9]{10,})_ar\.vtt$/);
    if (pattern3) {
        return pattern3[1];
    }
    
    return null;
}

/**
 * Finds all Arabic subtitle files (containing '_ar')
 */
function findArabicSubtitleFiles() {
    if (!fs.existsSync(config.vttOutputFolder)) {
        console.error(`❌ Subtitle folder not found: ${config.vttOutputFolder}`);
        return [];
    }
    
    const allFiles = fs.readdirSync(config.vttOutputFolder);
    const arabicFiles = [];
    
    for (const filename of allFiles) {
        // Check if file contains '_ar' and is a VTT file
        if (filename.includes('_ar') && filename.toLowerCase().endsWith('.vtt')) {
            const filePath = path.join(config.vttOutputFolder, filename);
            const videoId = extractVideoId(filename);
            
            arabicFiles.push({
                filename,
                filePath,
                videoId,
                hasVideoId: !!videoId
            });
        }
    }
    
    return arabicFiles;
}

/**
 * Processes a single Arabic subtitle file
 */
async function processArabicSubtitle(file) {
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
        // Step 1: Delete existing Arabic caption
        const deleteResult = await deleteArabicCaption(videoId);
        if (!deleteResult.success) {
            console.log(`⚠️  Warning: Could not delete existing Arabic caption: ${deleteResult.error}`);
            console.log(`🔄 Continuing with upload anyway...`);
        }
        
        // Small delay between delete and upload
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Step 2: Upload new Arabic caption
        const uploadResult = await uploadArabicCaption(videoId, filePath);
        
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
 * Main function to process all Arabic subtitle files
 */
async function processAllArabicSubtitles() {
    try {
        console.log('🌍 Arabic Subtitle Maker - Starting Process...');
        console.log('🎯 Finding all subtitle files with "_ar" in their name...');
        
        // Ensure we have valid authentication (handled automatically by makeAuthenticatedRequest)
        console.log('🔑 Ensuring valid authentication...');
        
        // Find all Arabic subtitle files
        const arabicFiles = findArabicSubtitleFiles();
        
        console.log(`\n📊 Arabic Subtitle Files Overview:`);
        console.log(`📁 Subtitle folder: ${config.vttOutputFolder}`);
        console.log(`🔍 Files with "_ar": ${arabicFiles.length}`);
        
        if (arabicFiles.length === 0) {
            console.log(`📭 No Arabic subtitle files found.`);
            console.log(`💡 Make sure your Arabic subtitle files contain "_ar" in their filename.`);
            return;
        }
        
        // Separate files with and without video IDs
        const filesWithVideoId = arabicFiles.filter(file => file.hasVideoId);
        const filesWithoutVideoId = arabicFiles.filter(file => !file.hasVideoId);
        
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
            console.log(`❌ No processable Arabic subtitle files found.`);
            return;
        }
        
        console.log(`\n🚀 Processing ${filesWithVideoId.length} Arabic subtitle files...`);
        
        let successCount = 0;
        let failureCount = 0;
        const results = [];
        
        for (let i = 0; i < filesWithVideoId.length; i++) {
            const file = filesWithVideoId[i];
            
            console.log(`\n📈 Progress: ${i + 1}/${filesWithVideoId.length}`);
            
            const result = await processArabicSubtitle(file);
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
        console.log(`\n📊 Arabic Subtitle Processing Summary:`);
        console.log(`✅ Successful uploads: ${successCount}`);
        console.log(`❌ Failed uploads: ${failureCount}`);
        
        if (failureCount > 0) {
            console.log(`\n❌ Failed uploads:`);
            results.filter(r => !r.success).forEach(result => {
                console.log(`   - ${result.filename} (${result.videoId || 'unknown'}): ${result.error}`);
            });
        }
        
        if (successCount > 0) {
            console.log(`\n🎉 Successfully processed ${successCount} Arabic subtitle files!`);
            console.log(`🌍 Arabic captions are now available on your API.video videos`);
        }
        
        return {
            total: filesWithVideoId.length,
            successful: successCount,
            failed: failureCount,
            results
        };
        
    } catch (error) {
        console.error('❌ Error in Arabic subtitle processing:', error.message);
        process.exit(1);
    }
}

/**
 * Processes Arabic subtitle for a specific video ID
 */
async function processArabicSubtitleForVideo(videoId, vttFilePath) {
    try {
        console.log(`🌍 Processing Arabic subtitle for specific video: ${videoId}`);
        
        // Ensure we have valid authentication (handled automatically by makeAuthenticatedRequest)
        console.log('🔑 Ensuring valid authentication...');
        
        // Check if VTT file exists
        if (!fs.existsSync(vttFilePath)) {
            console.error(`❌ VTT file not found: ${vttFilePath}`);
            return false;
        }
        
        // Delete existing Arabic caption
        const deleteResult = await deleteArabicCaption(videoId);
        if (!deleteResult.success) {
            console.log(`⚠️  Warning: Could not delete existing Arabic caption: ${deleteResult.error}`);
            console.log(`🔄 Continuing with upload anyway...`);
        }
        
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Upload new Arabic caption
        const uploadResult = await uploadArabicCaption(videoId, vttFilePath);
        
        if (uploadResult.success) {
            console.log(`🎉 Arabic subtitle processing completed successfully!`);
            return true;
        } else {
            console.error(`❌ Arabic subtitle processing failed: ${uploadResult.error}`);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Error processing Arabic subtitle:', error.message);
        return false;
    }
}

// Execute the function if this file is run directly
if (require.main === module) {
    const command = process.argv[2];
    const videoId = process.argv[3];
    const filePath = process.argv[4];
    
    if (command === 'single' && videoId && filePath) {
        processArabicSubtitleForVideo(videoId, filePath)
            .then(success => {
                if (success) {
                    console.log('\nArabic subtitle processing completed successfully!');
                    process.exit(0);
                } else {
                    console.log('\nArabic subtitle processing failed!');
                    process.exit(1);
                }
            })
            .catch(error => {
                console.error('\nError:', error.message);
                process.exit(1);
            });
    } else {
        processAllArabicSubtitles()
            .then(result => {
                if (result && result.successful > 0) {
                    console.log('\nArabic subtitle processing completed!');
                    process.exit(0);
                } else {
                    console.log('\nNo Arabic subtitles were processed successfully.');
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
    processAllArabicSubtitles,
    processArabicSubtitleForVideo,
    findArabicSubtitleFiles,
    deleteArabicCaption,
    uploadArabicCaption,
    extractVideoId
}; 