require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getAccessToken, makeAuthenticatedRequest } = require('../auth.js');

// Configuration
const config = {
    apiBaseUrl: 'https://ws.api.video',
    delayBetweenRequests: process.env.DELAY_BETWEEN_REQUESTS || 1000,
    subtitlesFolder: process.env.SUBTITLES_FOLDER || './subtitles',
    outputFile: process.env.UNIVERSAL_OUTPUT_FILE || './universal_caption_upload_report.json',
    targetLanguages: ['en', 'fr', 'ar', 'es', 'it'],
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
        return { hasVideoId: false, filename };
    }
    
    const videoId = videoIdMatch[1];
    
    // Extract language from the end (after last underscore)
    const parts = nameWithoutVtt.split('_');
    const language = parts[parts.length - 1];
    
    // Validate language code
    if (!config.targetLanguages.includes(language)) {
        return { hasVideoId: true, videoId, hasValidLanguage: false, filename, language };
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
        if (error.response?.status === 404) {
            return false; // Caption doesn't exist
        }
        console.log(`⚠️  Could not check ${language} caption for ${videoId}: ${error.message}`);
        return true; // Assume it exists to be safe
    }
}

/**
 * Uploads a VTT caption file
 */
async function uploadCaption(videoId, vttFilePath, language) {
    const filename = path.basename(vttFilePath);
    
    try {
        console.log(`📤 Uploading ${language} caption for video ${videoId}...`);
        
        if (!fs.existsSync(vttFilePath)) {
            throw new Error(`VTT file not found: ${vttFilePath}`);
        }
        
        const vttContent = fs.readFileSync(vttFilePath);
        
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('file', vttContent, {
            filename: filename,
            contentType: 'text/vtt'
        });
        
        const response = await makeAuthenticatedRequest({
            method: 'POST',
            url: `${config.apiBaseUrl}/videos/${videoId}/captions/${language}`,
            data: formData,
            headers: {
                ...formData.getHeaders()
            }
        });
        
        if (response.status === 200 || response.status === 201) {
            console.log(`✅ Successfully uploaded ${language} caption`);
            return { success: true, videoId, filename, language, action: 'uploaded' };
        } else {
            console.error(`❌ Failed to upload ${language} caption: ${response.status}`);
            return { success: false, videoId, filename, language, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        console.error(`❌ Error uploading ${language} caption:`, error.response?.data || error.message);
        return { success: false, videoId, filename, language, error: error.message };
    }
}

/**
 * Scans subtitles folder and uploads all VTT files
 */
async function uploadAllVttFiles() {
    try {
        console.log('🌍 Universal Caption Uploader - Upload All VTT Files...');
        
        // Ensure we have valid authentication
        console.log('🔑 Ensuring valid authentication...');
        await getAccessToken();
        
        console.log(`📂 Scanning subtitles folder: ${config.subtitlesFolder}`);
        
        // Check subtitles folder
        if (!fs.existsSync(config.subtitlesFolder)) {
            console.error(`❌ Subtitles folder not found: ${config.subtitlesFolder}`);
            return;
        }
        
        // Get all VTT files
        const allFiles = fs.readdirSync(config.subtitlesFolder);
        const vttFiles = allFiles.filter(file => file.toLowerCase().endsWith('.vtt'));
        
        console.log(`📄 Found ${vttFiles.length} VTT files`);
        
        if (vttFiles.length === 0) {
            console.log('❌ No VTT files found to upload');
            return;
        }
        
        // Parse and validate files
        const validFiles = [];
        const invalidFiles = [];
        
        vttFiles.forEach(file => {
            const parsed = parseVttFilename(file);
            
            if (parsed.hasVideoId && parsed.hasValidLanguage) {
                validFiles.push({
                    filename: file,
                    fullPath: path.join(config.subtitlesFolder, file),
                    videoId: parsed.videoId,
                    language: parsed.language
                });
            } else {
                invalidFiles.push({
                    filename: file,
                    reason: !parsed.hasVideoId ? 'No video ID' : 'Invalid language'
                });
            }
        });
        
        console.log(`✅ Valid VTT files: ${validFiles.length}`);
        if (invalidFiles.length > 0) {
            console.log(`⚠️  Invalid VTT files: ${invalidFiles.length}`);
            console.log(`   (Files without valid [videoId] format or unsupported languages)`);
        }
        
        if (validFiles.length === 0) {
            console.log('❌ No valid VTT files found to upload');
            return;
        }
        
        // Group by video ID
        const videoGroups = {};
        validFiles.forEach(file => {
            if (!videoGroups[file.videoId]) {
                videoGroups[file.videoId] = [];
            }
            videoGroups[file.videoId].push(file);
        });
        
        const videoIds = Object.keys(videoGroups);
        
        console.log(`\n📊 Upload Plan:`);
        console.log(`🎬 Videos with VTT files: ${videoIds.length}`);
        console.log(`📄 Total VTT files to upload: ${validFiles.length}`);
        console.log(`🌍 Languages: ${config.targetLanguages.join(', ')}`);
        
        // Show some examples
        console.log(`\n📋 Examples:`);
        videoIds.slice(0, 5).forEach((videoId, index) => {
            const files = videoGroups[videoId];
            console.log(`${index + 1}. Video ${videoId}: ${files.length} captions`);
            console.log(`   📄 Languages: ${files.map(f => f.language).join(', ')}`);
        });
        
        if (videoIds.length > 5) {
            console.log(`   ... and ${videoIds.length - 5} more videos`);
        }
        
        // Confirmation
        const readline = require('readline');
        
        // Check if running in non-interactive mode (PM2 or no TTY)
        const isInteractive = process.stdin.isTTY && process.stdout.isTTY && !process.env.PM_ID && !process.env.PM2_HOME;
        
        let skipExisting = true; // Default to skip existing
        
        if (isInteractive) {
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
            
            switch (choice) {
                case '1':
                    skipExisting = true;
                    console.log('✅ Will skip existing captions');
                    break;
                case '2':
                    skipExisting = false;
                    console.log('⚠️  Will overwrite existing captions');
                    break;
                case '3':
                    console.log('👋 Operation cancelled');
                    return;
                default:
                    console.log('❌ Invalid choice. Operation cancelled');
                    return;
            }
        } else {
            // Non-interactive mode (PM2, background execution)
            console.log(`\n🤖 Non-interactive mode detected (PM2/Background)`);
            console.log(`✅ Automatically choosing: Skip existing captions (recommended)`);
            skipExisting = true;
        }
        
        // Start uploading
        console.log(`\n🚀 Starting upload of ${validFiles.length} captions...`);
        
        const results = [];
        let successCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        let videoCount = 0;
        
        for (const videoId of videoIds) {
            videoCount++;
            const files = videoGroups[videoId];
            
            console.log(`\n📹 [${videoCount}/${videoIds.length}] Processing video: ${videoId}`);
            console.log(`   📄 Uploading ${files.length} captions...`);
            
            for (const file of files) {
                try {
                    // Check if caption already exists
                    if (skipExisting) {
                        const exists = await checkCaptionExists(file.videoId, file.language);
                        if (exists) {
                            console.log(`   ⏭️  ${file.language}: Already exists, skipping`);
                            skippedCount++;
                            
                            results.push({
                                videoId: file.videoId,
                                language: file.language,
                                filename: file.filename,
                                result: { success: true, action: 'skipped_existing' },
                                processedAt: new Date().toISOString()
                            });
                            continue;
                        }
                    }
                    
                    const result = await uploadCaption(file.videoId, file.fullPath, file.language);
                    
                    results.push({
                        videoId: file.videoId,
                        language: file.language,
                        filename: file.filename,
                        result,
                        processedAt: new Date().toISOString()
                    });
                    
                    if (result.success) {
                        successCount++;
                        console.log(`   ✅ ${file.language}: Uploaded successfully`);
                    } else {
                        errorCount++;
                        console.log(`   ❌ ${file.language}: ${result.error}`);
                    }
                    
                    // Add delay between uploads
                    if (config.delayBetweenRequests > 0) {
                        await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
                    }
                    
                } catch (error) {
                    console.error(`   ❌ ${file.language}: Error - ${error.message}`);
                    errorCount++;
                    
                    results.push({
                        videoId: file.videoId,
                        language: file.language,
                        filename: file.filename,
                        result: { success: false, error: error.message },
                        processedAt: new Date().toISOString()
                    });
                }
            }
        }
        
        console.log(`\n📊 Upload Summary:`);
        console.log(`🎬 Videos processed: ${videoCount}`);
        console.log(`📄 Total files processed: ${results.length}`);
        console.log(`✅ Successful uploads: ${successCount}`);
        console.log(`⏭️  Skipped existing: ${skippedCount}`);
        console.log(`❌ Failed uploads: ${errorCount}`);
        console.log(`📈 Success rate: ${(((successCount + skippedCount) / results.length) * 100).toFixed(1)}%`);
        
        // Save results
        const report = {
            summary: {
                processedAt: new Date().toISOString(),
                action: 'universal_caption_upload',
                videosProcessed: videoCount,
                totalFiles: results.length,
                successful: successCount,
                skipped: skippedCount,
                errors: errorCount,
                successRate: ((successCount + skippedCount) / results.length) * 100,
                skipExisting
            },
            results,
            invalidFiles
        };
        
        fs.writeFileSync(config.outputFile, JSON.stringify(report, null, 2));
        console.log(`💾 Upload report saved to: ${config.outputFile}`);
        
        console.log(`\n🎉 Universal caption upload complete!`);
        
        if (successCount > 0) {
            console.log(`\n💡 Next steps:`);
            console.log(`   1. Run 'node captionCompletionChecker.js' to verify all videos have 5 languages`);
            console.log(`   2. Run 'node captionLanguageValidator.js' to validate language accuracy`);
        }
        
    } catch (error) {
        console.error('❌ Error in universal caption upload:', error.message);
        process.exit(1);
    }
}

// Execute if this file is run directly
if (require.main === module) {
    uploadAllVttFiles().catch(error => {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = {
    uploadAllVttFiles,
    uploadCaption,
    parseVttFilename,
    checkCaptionExists
}; 