require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const readline = require('readline');
const { getAccessToken } = require('../auth.js');
const { parseVideoIdFromVttFilename } = require('./captionManager.js');

// Configuration from environment variables
const config = {
    vttOutputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles',
    apiBaseUrl: 'https://ws.api.video'
};

// Allowed languages - any other languages will be deleted
const ALLOWED_LANGUAGES = ['ar', 'en', 'fr', 'es', 'it'];

/**
 * Gets all captions for a specific video
 */
async function getVideoCaptions(videoId, accessToken) {
    try {
        const response = await axios.get(
            `${config.apiBaseUrl}/videos/${videoId}/captions`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        );
        
        if (response.status === 200) {
            return { success: true, captions: response.data.data };
        } else {
            return { success: false, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Deletes a specific caption for a video
 */
async function deleteCaption(videoId, language, accessToken) {
    try {
        console.log(`🗑️  Deleting ${language} caption for video ${videoId}...`);
        
        const response = await axios.delete(
            `${config.apiBaseUrl}/videos/${videoId}/captions/${language}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        );
        
        if (response.status === 204) {
            console.log(`   ✅ Successfully deleted ${language} caption`);
            return { success: true };
        } else {
            console.log(`   ❌ Failed to delete ${language} caption: HTTP ${response.status}`);
            return { success: false, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        // 404 is expected if caption doesn't exist
        if (error.response?.status === 404) {
            console.log(`   ℹ️  Caption ${language} not found (already deleted)`);
            return { success: true };
        }
        
        console.log(`   ❌ Error deleting ${language} caption: ${error.response?.data || error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * Gets unique video IDs from VTT files
 */
function getVideoIdsFromVttFiles() {
    if (!fs.existsSync(config.vttOutputFolder)) {
        console.error(`❌ VTT output folder not found: ${config.vttOutputFolder}`);
        return [];
    }
    
    const vttFiles = fs.readdirSync(config.vttOutputFolder)
        .filter(file => file.toLowerCase().endsWith('.vtt'));
    
    const videoIds = new Set();
    
    vttFiles.forEach(filename => {
        const parseResult = parseVideoIdFromVttFilename(filename);
        if (parseResult.hasVideoId) {
            videoIds.add(parseResult.videoId);
        }
    });
    
    return Array.from(videoIds);
}

/**
 * Creates a readline interface for user input
 */
function createReadlineInterface() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

/**
 * Asks user for confirmation
 */
function askConfirmation(message) {
    return new Promise((resolve) => {
        const rl = createReadlineInterface();
        rl.question(`${message} (y/N): `, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
    });
}

/**
 * Scans all videos for unwanted caption languages
 */
async function scanForUnwantedCaptions() {
    try {
        // Get access token
        console.log('🔑 Getting access token...');
        const tokenData = await getAccessToken();
        const accessToken = tokenData.access_token;
        
        // Get video IDs from VTT files
        const videoIds = getVideoIdsFromVttFiles();
        
        if (videoIds.length === 0) {
            console.log(`📭 No videos found with VTT files in ${config.vttOutputFolder}`);
            console.log(`💡 Make sure you have VTT files with format: [videoId]_Title.vtt`);
            return;
        }
        
        console.log(`\n📊 Caption Cleanup Scan:`);
        console.log(`🎬 Videos to check: ${videoIds.length}`);
        console.log(`🌍 Allowed languages: ${ALLOWED_LANGUAGES.join(', ')}`);
        console.log(`🗑️  Will delete any other languages found`);
        console.log(`\n${'='.repeat(80)}`);
        
        const unwantedCaptions = [];
        let totalCaptions = 0;
        let videosWithUnwanted = 0;
        
        // Scan all videos for unwanted captions
        for (let i = 0; i < videoIds.length; i++) {
            const videoId = videoIds[i];
            
            console.log(`\n🔍 ${i + 1}/${videoIds.length}: Scanning video ${videoId}`);
            
            const captionsResult = await getVideoCaptions(videoId, accessToken);
            
            if (!captionsResult.success) {
                console.log(`   ❌ Failed to get captions: ${captionsResult.error}`);
                continue;
            }
            
            const captions = captionsResult.captions;
            totalCaptions += captions.length;
            
            console.log(`   📋 Found ${captions.length} captions`);
            
            // Check for unwanted languages
            const unwantedForThisVideo = captions.filter(caption => 
                !ALLOWED_LANGUAGES.includes(caption.srclang)
            );
            
            if (unwantedForThisVideo.length > 0) {
                videosWithUnwanted++;
                console.log(`   ⚠️  Found ${unwantedForThisVideo.length} unwanted caption(s):`);
                
                unwantedForThisVideo.forEach(caption => {
                    console.log(`      🗑️  ${caption.srclang} - ${caption.languageName}`);
                    unwantedCaptions.push({
                        videoId,
                        language: caption.srclang,
                        languageName: caption.languageName,
                        src: caption.src
                    });
                });
            } else {
                console.log(`   ✅ No unwanted captions found`);
            }
            
            // Add delay between API calls
            if (i < videoIds.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📊 SCAN RESULTS`);
        console.log(`${'='.repeat(80)}`);
        
        console.log(`\n🎯 Scan Statistics:`);
        console.log(`   📹 Videos scanned: ${videoIds.length}`);
        console.log(`   📋 Total captions found: ${totalCaptions}`);
        console.log(`   ⚠️  Videos with unwanted captions: ${videosWithUnwanted}`);
        console.log(`   🗑️  Total unwanted captions: ${unwantedCaptions.length}`);
        
        if (unwantedCaptions.length === 0) {
            console.log(`\n🎉 Great! No unwanted captions found!`);
            console.log(`✅ All videos only have allowed languages: ${ALLOWED_LANGUAGES.join(', ')}`);
            return;
        }
        
        // Group by language for summary
        const languageGroups = {};
        unwantedCaptions.forEach(caption => {
            if (!languageGroups[caption.language]) {
                languageGroups[caption.language] = [];
            }
            languageGroups[caption.language].push(caption);
        });
        
        console.log(`\n🗑️  UNWANTED CAPTIONS TO DELETE:`);
        Object.entries(languageGroups).forEach(([language, captions]) => {
            const languageName = captions[0].languageName;
            console.log(`   📍 ${language} (${languageName}): ${captions.length} caption(s)`);
            captions.forEach(caption => {
                console.log(`      • Video: ${caption.videoId}`);
            });
        });
        
        console.log(`\n⚠️  WARNING: This will permanently delete ${unwantedCaptions.length} caption(s)!`);
        console.log(`🔒 Only these languages will remain: ${ALLOWED_LANGUAGES.join(', ')}`);
        
        // Ask for confirmation
        const confirmed = await askConfirmation('\n❓ Do you want to proceed with deletion?');
        
        if (!confirmed) {
            console.log(`\n❌ Deletion cancelled by user.`);
            console.log(`💡 No captions were deleted.`);
            return;
        }
        
        // Proceed with deletion
        console.log(`\n🚀 Starting deletion of ${unwantedCaptions.length} unwanted captions...`);
        console.log(`⏱️  This will take approximately ${Math.ceil(unwantedCaptions.length * 2)} seconds (2s delay per deletion)`);
        console.log(`\n${'='.repeat(80)}`);
        
        let successCount = 0;
        let failureCount = 0;
        const results = [];
        
        for (let i = 0; i < unwantedCaptions.length; i++) {
            const caption = unwantedCaptions[i];
            
            console.log(`\n🗑️  ${i + 1}/${unwantedCaptions.length}: Video ${caption.videoId}`);
            console.log(`    Language: ${caption.language} (${caption.languageName})`);
            
            const result = await deleteCaption(caption.videoId, caption.language, accessToken);
            results.push({ ...result, ...caption });
            
            if (result.success) {
                successCount++;
            } else {
                failureCount++;
            }
            
            // Add delay between deletions to respect API limits
            if (i < unwantedCaptions.length - 1) {
                console.log(`    ⏳ Waiting 2 seconds before next deletion...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📊 DELETION SUMMARY`);
        console.log(`${'='.repeat(80)}`);
        
        console.log(`\n🎯 Deletion Statistics:`);
        console.log(`   🗑️  Total deletions attempted: ${unwantedCaptions.length}`);
        console.log(`   ✅ Successful deletions: ${successCount}`);
        console.log(`   ❌ Failed deletions: ${failureCount}`);
        console.log(`   📈 Success rate: ${Math.round((successCount / unwantedCaptions.length) * 100)}%`);
        
        if (failureCount > 0) {
            console.log(`\n❌ FAILED DELETIONS (${failureCount}):`);
            results.filter(r => !r.success).forEach(result => {
                console.log(`   🎬 ${result.videoId} - ${result.language} (${result.languageName}): ${result.error}`);
            });
        }
        
        if (successCount > 0) {
            console.log(`\n✅ SUCCESSFULLY DELETED (${successCount}):`);
            results.filter(r => r.success).forEach(result => {
                console.log(`   🎬 ${result.videoId} - ${result.language} (${result.languageName})`);
            });
        }
        
        if (successCount === unwantedCaptions.length) {
            console.log(`\n🎉 SUCCESS! All unwanted captions have been deleted!`);
            console.log(`✅ Your videos now only have allowed languages: ${ALLOWED_LANGUAGES.join(', ')}`);
            console.log(`💡 Run captionStatusChecker.js to verify the cleanup was successful`);
        } else if (successCount > 0) {
            console.log(`\n⚠️  Partial success. Some captions were deleted but ${failureCount} failed.`);
            console.log(`💡 You may want to run this script again to retry failed deletions`);
        } else {
            console.log(`\n❌ No captions were successfully deleted.`);
            console.log(`💡 Check the errors above and try again`);
        }
        
    } catch (error) {
        console.error('❌ Error in caption cleanup process:', error.message);
        process.exit(1);
    }
}

/**
 * Checks for unwanted captions on a specific video
 */
async function cleanupSingleVideo(videoId) {
    try {
        // Get access token
        console.log('🔑 Getting access token...');
        const tokenData = await getAccessToken();
        const accessToken = tokenData.access_token;
        
        console.log(`\n🎬 Checking video: ${videoId}`);
        console.log(`🌍 Allowed languages: ${ALLOWED_LANGUAGES.join(', ')}`);
        console.log(`${'='.repeat(80)}`);
        
        const captionsResult = await getVideoCaptions(videoId, accessToken);
        
        if (!captionsResult.success) {
            console.error(`❌ Failed to get captions: ${captionsResult.error}`);
            return false;
        }
        
        const captions = captionsResult.captions;
        console.log(`📋 Found ${captions.length} captions for video ${videoId}`);
        
        // Check for unwanted languages
        const unwantedCaptions = captions.filter(caption => 
            !ALLOWED_LANGUAGES.includes(caption.srclang)
        );
        
        if (unwantedCaptions.length === 0) {
            console.log(`✅ No unwanted captions found!`);
            console.log(`🎉 Video only has allowed languages`);
            return true;
        }
        
        console.log(`\n⚠️  Found ${unwantedCaptions.length} unwanted caption(s):`);
        unwantedCaptions.forEach(caption => {
            console.log(`   🗑️  ${caption.srclang} - ${caption.languageName}`);
        });
        
        console.log(`\n⚠️  WARNING: This will permanently delete ${unwantedCaptions.length} caption(s)!`);
        
        // Ask for confirmation
        const confirmed = await askConfirmation('\n❓ Do you want to proceed with deletion?');
        
        if (!confirmed) {
            console.log(`\n❌ Deletion cancelled by user.`);
            return false;
        }
        
        // Proceed with deletion
        console.log(`\n🚀 Starting deletion...`);
        
        let successCount = 0;
        let failureCount = 0;
        
        for (let i = 0; i < unwantedCaptions.length; i++) {
            const caption = unwantedCaptions[i];
            
            console.log(`\n🗑️  ${i + 1}/${unwantedCaptions.length}: Deleting ${caption.srclang} (${caption.languageName})`);
            
            const result = await deleteCaption(videoId, caption.srclang, accessToken);
            
            if (result.success) {
                successCount++;
            } else {
                failureCount++;
            }
            
            // Add delay between deletions
            if (i < unwantedCaptions.length - 1) {
                console.log(`    ⏳ Waiting 2 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📊 RESULTS`);
        console.log(`${'='.repeat(80)}`);
        
        console.log(`\n🎯 Statistics:`);
        console.log(`   🗑️  Deletions attempted: ${unwantedCaptions.length}`);
        console.log(`   ✅ Successful: ${successCount}`);
        console.log(`   ❌ Failed: ${failureCount}`);
        
        if (successCount === unwantedCaptions.length) {
            console.log(`\n🎉 SUCCESS! All unwanted captions deleted!`);
            console.log(`✅ Video ${videoId} now only has allowed languages`);
            return true;
        } else {
            console.log(`\n⚠️  Some deletions failed. You may want to try again.`);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Error cleaning up single video:', error.message);
        return false;
    }
}

// Execute if this file is run directly
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        // Scan and cleanup all videos
        console.log('🚀 Scanning all videos for unwanted caption languages...');
        console.log(`🌍 Allowed languages: ${ALLOWED_LANGUAGES.join(', ')}`);
        console.log(`🗑️  Any other languages will be deleted after confirmation`);
        await scanForUnwantedCaptions();
    } else if (args.length === 1) {
        // Cleanup specific video
        const videoId = args[0];
        console.log(`🚀 Checking video: ${videoId}`);
        await cleanupSingleVideo(videoId);
    } else {
        console.log(`
📖 Usage:
   
   Scan and cleanup all videos:
   node captionCleanup.js
   
   Cleanup specific video:
   node captionCleanup.js <videoId>
   
   Examples:
   node captionCleanup.js
   node captionCleanup.js vi2Y2FFzw8IVMZ8hXyKTBmcJ
   
🌍 Allowed languages: ${ALLOWED_LANGUAGES.join(', ')}
🗑️  Any other languages will be deleted after confirmation
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
    scanForUnwantedCaptions,
    cleanupSingleVideo,
    getVideoIdsFromVttFiles,
    ALLOWED_LANGUAGES
}; 