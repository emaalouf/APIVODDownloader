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
    delayBetweenRequests: process.env.DELAY_BETWEEN_REQUESTS || 1000,
    openRouterDelay: process.env.OPENROUTER_DELAY || 3000,
    maxRetries: 3
};

// Allowed languages - only these should remain
const ALLOWED_LANGUAGES = ['ar', 'en', 'fr', 'es', 'it'];

/**
 * Gets all videos from API.video
 */
async function getAllVideos() {
    try {
        console.log('📹 Fetching all videos from API.video...');
        let allVideos = [];
        let currentPage = 1;
        let hasMore = true;
        
        while (hasMore) {
            const response = await makeAuthenticatedRequest({
                method: 'GET',
                url: `${config.apiBaseUrl}/videos?currentPage=${currentPage}&pageSize=100`
            });
            
            if (response.status === 200) {
                const videos = response.data.data;
                allVideos = allVideos.concat(videos);
                
                hasMore = response.data.pagination.currentPage < response.data.pagination.pagesTotal;
                currentPage++;
                
                console.log(`📊 Loaded ${allVideos.length} videos so far...`);
                
                // Add small delay to avoid rate limiting
                if (hasMore) {
                    await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
                }
            } else {
                console.error(`❌ Failed to fetch videos: HTTP ${response.status}`);
                break;
            }
        }
        
        console.log(`✅ Loaded ${allVideos.length} total videos`);
        return allVideos;
        
    } catch (error) {
        console.error('❌ Error fetching videos:', error.message);
        return [];
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
 * Cleans up captions for a specific video
 */
async function cleanupVideoCaptions(videoId, videoTitle) {
    console.log(`\n🎬 Processing video: ${videoTitle} (${videoId})`);
    
    try {
        // Get current captions
        const captionsResult = await getVideoCaptions(videoId);
        
        if (!captionsResult.success) {
            console.log(`❌ Failed to get captions: ${captionsResult.error}`);
            return {
                success: false,
                videoId,
                videoTitle,
                error: captionsResult.error
            };
        }
        
        const captions = captionsResult.captions;
        console.log(`📊 Found ${captions.length} captions for this video`);
        
        if (captions.length === 0) {
            console.log(`📭 No captions to clean up`);
            return {
                success: true,
                videoId,
                videoTitle,
                action: 'no_captions_found',
                captionsProcessed: 0,
                captionsDeleted: 0
            };
        }
        
        // List current captions
        for (const caption of captions) {
            console.log(`   📝 ${caption.srclang}: ${caption.src}`);
        }
        
        // Delete non-allowed language captions
        let deletedCount = 0;
        const deleteResults = [];
        
        for (const caption of captions) {
            if (!ALLOWED_LANGUAGES.includes(caption.srclang)) {
                console.log(`🚫 Language '${caption.srclang}' not in allowed list: ${ALLOWED_LANGUAGES.join(', ')}`);
                
                const deleteResult = await deleteCaption(videoId, caption.srclang);
                deleteResults.push({
                    language: caption.srclang,
                    success: deleteResult.success,
                    error: deleteResult.error
                });
                
                if (deleteResult.success) {
                    deletedCount++;
                }
                
                // Add delay between deletions
                await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
            } else {
                console.log(`✅ Language '${caption.srclang}' is allowed, keeping it`);
            }
        }
        
        return {
            success: true,
            videoId,
            videoTitle,
            action: 'processed',
            captionsProcessed: captions.length,
            captionsDeleted: deletedCount,
            deleteResults
        };
        
    } catch (error) {
        console.error(`❌ Error processing video ${videoId}:`, error.message);
        return {
            success: false,
            videoId,
            videoTitle,
            error: error.message
        };
    }
}

/**
 * Processes a specific video ID for caption cleanup
 */
async function cleanupSpecificVideo(videoId) {
    try {
        console.log(`🎯 Processing specific video: ${videoId}`);
        
        // Ensure we have valid authentication
        console.log('🔑 Ensuring valid authentication...');
        await getAccessToken();
        
        const result = await cleanupVideoCaptions(videoId, 'Manual Cleanup');
        
        console.log('\n📊 Cleanup Summary:');
        if (result.success) {
            console.log(`✅ Video processed successfully`);
            console.log(`📝 Captions found: ${result.captionsProcessed || 0}`);
            console.log(`🗑️  Captions deleted: ${result.captionsDeleted || 0}`);
        } else {
            console.log(`❌ Failed to process video: ${result.error}`);
        }
        
        return result;
        
    } catch (error) {
        console.error('❌ Error in specific video cleanup:', error.message);
        return {
            success: false,
            videoId,
            error: error.message
        };
    }
}

/**
 * Main function to clean up all video captions
 */
async function cleanupAllVideoCaptions() {
    try {
        console.log('🚀 Starting Caption Cleanup Process...');
        console.log(`🎯 Target: Remove captions not in allowed languages: ${ALLOWED_LANGUAGES.join(', ')}`);
        
        // Ensure we have valid authentication
        console.log('🔑 Ensuring valid authentication...');
        await getAccessToken();
        
        // Get all videos
        const allVideos = await getAllVideos();
        
        if (allVideos.length === 0) {
            console.log('❌ No videos found to process');
            return;
        }
        
        console.log(`\n📊 Processing ${allVideos.length} videos...`);
        console.log(`⏱️  Delay between requests: ${config.delayBetweenRequests}ms`);
        
        const results = [];
        let processedCount = 0;
        let totalCaptionsDeleted = 0;
        
        for (let i = 0; i < allVideos.length; i++) {
            const video = allVideos[i];
            console.log(`\n📈 Progress: ${i + 1}/${allVideos.length}`);
            
            const result = await cleanupVideoCaptions(video.videoId, video.title);
            results.push(result);
            
            if (result.success) {
                processedCount++;
                totalCaptionsDeleted += result.captionsDeleted || 0;
            }
            
            // Add delay between videos to avoid rate limiting
            if (i < allVideos.length - 1) {
                console.log(`⏳ Waiting ${config.delayBetweenRequests}ms before next video...`);
                await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
            }
        }
        
        // Generate summary report
        const reportData = {
            timestamp: new Date().toISOString(),
            summary: {
                totalVideos: allVideos.length,
                processedCount,
                totalCaptionsDeleted,
                allowedLanguages: ALLOWED_LANGUAGES
            },
            results
        };
        
        // Save report
        const reportFile = './caption_cleanup_report.json';
        fs.writeFileSync(reportFile, JSON.stringify(reportData, null, 2));
        
        console.log('\n📊 Cleanup Summary:');
        console.log(`🎬 Videos processed: ${processedCount}/${allVideos.length}`);
        console.log(`🗑️  Total captions deleted: ${totalCaptionsDeleted}`);
        console.log(`💾 Report saved to: ${reportFile}`);
        
        console.log('\n🎉 Caption cleanup completed!');
        
    } catch (error) {
        console.error('❌ Error in caption cleanup process:', error.message);
        process.exit(1);
    }
}

/**
 * Interactive mode for targeted cleanup
 */
async function interactiveCleanup() {
    try {
        console.log('🎯 Interactive Caption Cleanup Mode');
        console.log('This will help you clean up captions for specific videos.');
        
        // Check if we have a video ID from the subtitle files
        const vttFiles = fs.readdirSync(config.vttOutputFolder)
            .filter(file => file.toLowerCase().endsWith('.vtt'));
        
        const videoIds = new Set();
        for (const file of vttFiles) {
            const match = file.match(/^\[([^\]]+)\]/);
            if (match) {
                videoIds.add(match[1]);
            }
        }
        
        if (videoIds.size > 0) {
            console.log(`\n📋 Found video IDs in subtitle files:`);
            for (const videoId of videoIds) {
                console.log(`   🎬 ${videoId}`);
            }
            
            console.log(`\n🔄 Processing these videos for caption cleanup...`);
            
            for (const videoId of videoIds) {
                await cleanupSpecificVideo(videoId);
                
                if (videoIds.size > 1) {
                    console.log(`⏳ Waiting ${config.delayBetweenRequests}ms before next video...`);
                    await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
                }
            }
        } else {
            console.log('📭 No video IDs found in subtitle files');
            console.log('💡 You can run: node caption_cleanup_tool.js --video=YOUR_VIDEO_ID');
        }
        
    } catch (error) {
        console.error('❌ Error in interactive cleanup:', error.message);
    }
}

// Export functions for use in other modules
module.exports = {
    cleanupAllVideoCaptions,
    cleanupSpecificVideo,
    cleanupVideoCaptions,
    getVideoCaptions,
    deleteCaption,
    getAllVideos,
    interactiveCleanup
};

// Command line interface
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length > 0) {
        const command = args[0];
        
        if (command.startsWith('--video=')) {
            const videoId = command.replace('--video=', '');
            cleanupSpecificVideo(videoId);
        } else if (command === '--all') {
            cleanupAllVideoCaptions();
        } else if (command === '--interactive' || command === '-i') {
            interactiveCleanup();
        } else {
            console.log('📖 Usage:');
            console.log('  node caption_cleanup_tool.js --interactive    # Process videos from subtitle files');
            console.log('  node caption_cleanup_tool.js --video=VIDEO_ID # Clean specific video');
            console.log('  node caption_cleanup_tool.js --all            # Clean all videos (use with caution)');
        }
    } else {
        // Default to interactive mode
        interactiveCleanup();
    }
} 