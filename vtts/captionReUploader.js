require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getAccessToken, makeAuthenticatedRequest } = require('../auth.js');

// Configuration
const config = {
    apiBaseUrl: 'https://ws.api.video',
    delayBetweenRequests: process.env.DELAY_BETWEEN_REQUESTS || 1000,
    fixerReportFile: process.env.FIXER_REPORT_FILE || './caption_fixer_report.json',
    subtitlesFolder: process.env.SUBTITLES_FOLDER || './subtitles',
    outputFile: process.env.REUPLOAD_OUTPUT_FILE || './caption_reupload_report.json',
    targetLanguages: ['en', 'fr', 'ar', 'es', 'it'], // Languages to re-upload
};

/**
 * Extracts video ID and language from VTT filename
 * Format: [videoId]_Title_language.vtt
 */
function parseVttFilename(filename) {
    // Remove .vtt extension
    const nameWithoutVtt = filename.replace(/\.vtt$/, '');
    
    // Extract video ID from brackets
    const videoIdMatch = nameWithoutVtt.match(/^\[([^\]]+)\]/);
    if (!videoIdMatch) {
        return { hasVideoId: false, filename };
    }
    
    const videoId = videoIdMatch[1];
    
    // Extract language from the end (after last underscore)
    const parts = nameWithoutVtt.split('_');
    const language = parts[parts.length - 1];
    
    // Validate language code
    if (!config.targetLanguages.includes(language)) {
        return { hasVideoId: true, videoId, hasValidLanguage: false, filename };
    }
    
    return {
        hasVideoId: true,
        videoId,
        hasValidLanguage: true,
        language,
        filename
    };
}

/**
 * Checks if a caption already exists for a video and language
 */
async function checkCaptionExists(videoId, language) {
    try {
        const response = await makeAuthenticatedRequest({
            method: 'GET',
            url: `${config.apiBaseUrl}/videos/${videoId}/captions/${language}`
        });
        
        return response.status === 200;
    } catch (error) {
        // 404 means caption doesn't exist
        if (error.response?.status === 404) {
            return false;
        }
        
        // Other errors - assume it exists to be safe
        console.log(`⚠️  Could not check ${language} caption existence: ${error.message}`);
        return true;
    }
}

/**
 * Uploads a VTT caption file to API.video with existing caption check
 */
async function uploadCaption(videoId, vttFilePath, language, overwriteExisting = false) {
    const filename = path.basename(vttFilePath);
    
    try {
        console.log(`📤 Uploading ${language} caption for video ${videoId}...`);
        console.log(`    File: ${filename}`);
        
        // Check if VTT file exists
        if (!fs.existsSync(vttFilePath)) {
            throw new Error(`VTT file not found: ${vttFilePath}`);
        }
        
        // Check if caption already exists
        const captionExists = await checkCaptionExists(videoId, language);
        if (captionExists && !overwriteExisting) {
            console.log(`ℹ️  ${language} caption already exists, skipping upload`);
            return { success: true, videoId, filename, language, action: 'skipped_existing' };
        }
        
        if (captionExists && overwriteExisting) {
            console.log(`🔄 ${language} caption exists, deleting before re-upload...`);
            
            // Delete existing caption first
            const deleteResponse = await makeAuthenticatedRequest({
                method: 'DELETE',
                url: `${config.apiBaseUrl}/videos/${videoId}/captions/${language}`
            });
            
            if (deleteResponse.status !== 204) {
                console.log(`⚠️  Could not delete existing ${language} caption, attempting upload anyway...`);
            } else {
                console.log(`✅ Deleted existing ${language} caption`);
            }
        }
        
        // Read the VTT file
        const vttContent = fs.readFileSync(vttFilePath);
        
        // Create form data
        const FormData = require('form-data');
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
            return { success: true, videoId, filename, language, action: 'uploaded' };
        } else {
            console.error(`❌ Failed to upload ${language} caption for video ${videoId}: ${response.status}`);
            return { success: false, videoId, filename, language, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        console.error(`❌ Error uploading ${language} caption for video ${videoId}:`, error.response?.data || error.message);
        return { success: false, videoId, filename, language, error: error.message };
    }
}

/**
 * Gets all VTT files from subtitles folder for a specific video ID
 */
function getVttFilesForVideo(videoId) {
    if (!fs.existsSync(config.subtitlesFolder)) {
        console.error(`❌ Subtitles folder not found: ${config.subtitlesFolder}`);
        return [];
    }
    
    const allFiles = fs.readdirSync(config.subtitlesFolder);
    const vttFiles = allFiles.filter(file => file.toLowerCase().endsWith('.vtt'));
    
    const videoFiles = [];
    
    vttFiles.forEach(file => {
        const parsed = parseVttFilename(file);
        if (parsed.hasVideoId && parsed.videoId === videoId && parsed.hasValidLanguage) {
            videoFiles.push({
                filename: file,
                fullPath: path.join(config.subtitlesFolder, file),
                language: parsed.language,
                videoId: parsed.videoId
            });
        }
    });
    
    return videoFiles;
}

/**
 * Main function to re-upload captions for videos that had mismatched captions deleted
 */
async function reUploadCorrectCaptions() {
    try {
        console.log('🔄 Starting Caption Re-Upload Process...');
        
        // Ensure we have valid authentication
        console.log('🔑 Ensuring valid authentication...');
        await getAccessToken();
        
        // Load fixer report
        if (!fs.existsSync(config.fixerReportFile)) {
            console.error(`❌ Fixer report not found: ${config.fixerReportFile}`);
            console.log('💡 Please run the caption language fixer first');
            return;
        }
        
        console.log(`📖 Loading fixer report: ${config.fixerReportFile}`);
        const fixerData = JSON.parse(fs.readFileSync(config.fixerReportFile, 'utf8'));
        
        // Extract unique video IDs from successfully processed deletions
        const processedVideos = new Set();
        fixerData.results.forEach(result => {
            if (result.result.success && result.mismatch) {
                processedVideos.add(result.mismatch.videoId);
            }
        });
        
        const videoIds = Array.from(processedVideos);
        
        console.log(`\n📊 Found ${videoIds.length} videos that had captions deleted`);
        console.log(`📂 Scanning subtitles folder: ${config.subtitlesFolder}`);
        
        // Check subtitles folder
        if (!fs.existsSync(config.subtitlesFolder)) {
            console.error(`❌ Subtitles folder not found: ${config.subtitlesFolder}`);
            return;
        }
        
        // Find VTT files for each video
        const videoUploadPlan = [];
        let totalVttFiles = 0;
        
        for (const videoId of videoIds) {
            const vttFiles = getVttFilesForVideo(videoId);
            if (vttFiles.length > 0) {
                videoUploadPlan.push({
                    videoId,
                    vttFiles
                });
                totalVttFiles += vttFiles.length;
                
                console.log(`📹 ${videoId}: Found ${vttFiles.length} VTT files`);
                vttFiles.forEach(file => {
                    console.log(`    📄 ${file.language}: ${file.filename}`);
                });
            } else {
                console.log(`⚠️  ${videoId}: No VTT files found in subtitles folder`);
            }
        }
        
        if (videoUploadPlan.length === 0) {
            console.log('❌ No VTT files found for any of the processed videos');
            return;
        }
        
        console.log(`\n🎯 Upload Plan:`);
        console.log(`📹 Videos with VTT files: ${videoUploadPlan.length}`);
        console.log(`📄 Total VTT files to upload: ${totalVttFiles}`);
        console.log(`🌍 Target languages: ${config.targetLanguages.join(', ')}`);
        
        // Confirmation
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        console.log(`\n⚙️  Upload Options:`);
        console.log(`  [1] Skip existing captions (recommended)`);
        console.log(`  [2] Overwrite existing captions`);
        console.log(`  [3] Cancel operation`);
        
        const choice = await new Promise((resolve) => {
            rl.question('Choose option (1/2/3): ', (answer) => {
                rl.close();
                resolve(answer.trim());
            });
        });
        
        let overwriteExisting = false;
        
        switch (choice) {
            case '1':
                overwriteExisting = false;
                console.log('✅ Will skip existing captions');
                break;
            case '2':
                overwriteExisting = true;
                console.log('⚠️  Will overwrite existing captions');
                break;
            case '3':
                console.log('👋 Operation cancelled');
                return;
            default:
                console.log('❌ Invalid choice. Operation cancelled');
                return;
        }
        
        // Process uploads
        console.log(`\n🚀 Starting caption uploads...`);
        
        const results = [];
        let successCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        let videoCount = 0;
        
        for (const videoPlan of videoUploadPlan) {
            videoCount++;
            console.log(`\n📹 [${videoCount}/${videoUploadPlan.length}] Processing video: ${videoPlan.videoId}`);
            
            for (const vttFile of videoPlan.vttFiles) {
                try {
                    const result = await uploadCaption(
                        vttFile.videoId,
                        vttFile.fullPath,
                        vttFile.language,
                        overwriteExisting
                    );
                    
                    results.push({
                        videoId: vttFile.videoId,
                        language: vttFile.language,
                        filename: vttFile.filename,
                        result,
                        processedAt: new Date().toISOString()
                    });
                    
                    if (result.success) {
                        if (result.action === 'skipped_existing') {
                            skippedCount++;
                        } else {
                            successCount++;
                        }
                    } else {
                        errorCount++;
                        console.log(`❌ Failed: ${result.error}`);
                    }
                    
                    // Add delay between uploads
                    if (config.delayBetweenRequests > 0) {
                        await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
                    }
                    
                } catch (error) {
                    console.error(`❌ Error uploading caption:`, error.message);
                    errorCount++;
                    
                    results.push({
                        videoId: vttFile.videoId,
                        language: vttFile.language,
                        filename: vttFile.filename,
                        result: { success: false, error: error.message },
                        processedAt: new Date().toISOString()
                    });
                }
            }
        }
        
        console.log(`\n📊 Caption Re-Upload Summary:`);
        console.log(`📹 Videos processed: ${videoCount}`);
        console.log(`✅ Successful uploads: ${successCount}`);
        console.log(`⏭️  Skipped existing: ${skippedCount}`);
        console.log(`❌ Errors: ${errorCount}`);
        console.log(`📝 Total processed: ${results.length}`);
        
        // Save results
        const report = {
            summary: {
                processedAt: new Date().toISOString(),
                action: 'reupload_correct_captions',
                videosProcessed: videoCount,
                totalUploads: results.length,
                successful: successCount,
                skipped: skippedCount,
                errors: errorCount,
                fixerReportUsed: config.fixerReportFile,
                subtitlesFolder: config.subtitlesFolder
            },
            results
        };
        
        fs.writeFileSync(config.outputFile, JSON.stringify(report, null, 2));
        console.log(`💾 Re-upload report saved to: ${config.outputFile}`);
        
        console.log(`\n🎉 Caption re-upload complete!`);
        
        if (errorCount > 0) {
            console.log(`\n⚠️  ${errorCount} uploads failed. Check the report for details.`);
        }
        
        if (successCount > 0) {
            console.log(`💡 Recommendation: Run the caption language validator again to verify correct uploads`);
        }
        
    } catch (error) {
        console.error('❌ Error in caption re-upload process:', error.message);
        process.exit(1);
    }
}

// Execute if this file is run directly
if (require.main === module) {
    reUploadCorrectCaptions().catch(error => {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = {
    reUploadCorrectCaptions,
    uploadCaption,
    checkCaptionExists,
    getVttFilesForVideo,
    parseVttFilename
}; 