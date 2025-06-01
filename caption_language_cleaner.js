require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getAccessToken, makeAuthenticatedRequest } = require('./auth.js');

// Configuration
const config = {
    apiBaseUrl: 'https://ws.api.video',
    delayBetweenRequests: 1000, // 1 second delay between requests
    allowedLanguages: ['en', 'ar', 'es', 'it', 'fr'], // Only these languages are allowed
    maxVideosPerPage: 25 // API pagination limit
};

/**
 * Gets all videos from API.video with pagination
 */
async function getAllVideos() {
    try {
        console.log('📡 Fetching all videos from API.video...');
        
        let allVideos = [];
        let currentPage = 1;
        let hasMore = true;
        
        while (hasMore) {
            console.log(`📄 Fetching page ${currentPage}...`);
            
            const response = await makeAuthenticatedRequest({
                method: 'GET',
                url: `${config.apiBaseUrl}/videos?currentPage=${currentPage}&pageSize=${config.maxVideosPerPage}`
            });
            
            if (response.data && response.data.data) {
                const videos = response.data.data.map(video => ({
                    videoId: video.videoId,
                    title: video.title || 'Untitled',
                    createdAt: video.createdAt,
                    publishedAt: video.publishedAt
                }));
                
                allVideos = allVideos.concat(videos);
                console.log(`   ✅ Found ${videos.length} videos on page ${currentPage}`);
                
                // Check if there are more pages
                const pagination = response.data.pagination;
                hasMore = pagination && pagination.currentPage < pagination.pagesTotal;
                currentPage++;
                
                // Add delay between page requests
                if (hasMore) {
                    await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
                }
            } else {
                hasMore = false;
            }
        }
        
        console.log(`📊 Total videos found: ${allVideos.length}`);
        return allVideos;
        
    } catch (error) {
        console.error('❌ Error fetching videos:', error.response?.data || error.message);
        throw error;
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
        
        if (response.data && response.data.data) {
            return {
                success: true,
                captions: response.data.data.map(caption => ({
                    language: caption.srclang,
                    src: caption.src,
                    default: caption.default || false
                }))
            };
        } else {
            return { success: true, captions: [] };
        }
        
    } catch (error) {
        if (error.response?.status === 404) {
            // Video not found or no captions
            return { success: true, captions: [] };
        }
        
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
 * Processes captions for a single video
 */
async function processVideoCaptions(video) {
    const { videoId, title } = video;
    
    console.log(`\n🎬 Processing: ${title} (${videoId})`);
    
    try {
        // Get all captions for this video
        const captionsResult = await getVideoCaptions(videoId);
        
        if (!captionsResult.success) {
            console.log(`❌ Failed to get captions: ${captionsResult.error}`);
            return {
                success: false,
                videoId,
                title,
                error: captionsResult.error
            };
        }
        
        const captions = captionsResult.captions;
        console.log(`📊 Found ${captions.length} captions for this video`);
        
        if (captions.length === 0) {
            console.log(`📭 No captions to process`);
            return {
                success: true,
                videoId,
                title,
                action: 'no_captions',
                captionsProcessed: 0,
                captionsDeleted: 0
            };
        }
        
        // List current captions
        for (const caption of captions) {
            const status = config.allowedLanguages.includes(caption.language) ? '✅ Allowed' : '🚫 Will delete';
            console.log(`   📝 ${caption.language}: ${status}`);
        }
        
        // Delete non-allowed language captions
        let deletedCount = 0;
        const deleteResults = [];
        
        for (const caption of captions) {
            if (!config.allowedLanguages.includes(caption.language)) {
                console.log(`🚫 Language '${caption.language}' not in allowed list: ${config.allowedLanguages.join(', ')}`);
                
                const deleteResult = await deleteCaption(videoId, caption.language);
                deleteResults.push({
                    language: caption.language,
                    success: deleteResult.success,
                    error: deleteResult.error
                });
                
                if (deleteResult.success) {
                    deletedCount++;
                }
                
                // Add delay between deletions
                await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
            } else {
                console.log(`✅ Language '${caption.language}' is allowed, keeping it`);
            }
        }
        
        return {
            success: true,
            videoId,
            title,
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
            title,
            error: error.message
        };
    }
}

/**
 * Main function to clean up caption languages for all videos
 */
async function cleanupAllCaptionLanguages() {
    try {
        console.log('🧹 Caption Language Cleaner - Starting Process...');
        console.log(`🎯 Allowed languages: ${config.allowedLanguages.join(', ')}`);
        console.log(`🗑️  Will delete any captions NOT in the allowed list`);
        
        // Ensure we have valid authentication
        console.log('🔑 Ensuring valid authentication...');
        
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
            
            const result = await processVideoCaptions(video);
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
        console.log(`\n📊 Caption Language Cleanup Summary:`);
        console.log(`🎬 Total videos processed: ${processedCount}/${allVideos.length}`);
        console.log(`🗑️  Total captions deleted: ${totalCaptionsDeleted}`);
        console.log(`✅ Allowed languages: ${config.allowedLanguages.join(', ')}`);
        
        // Show failed videos
        const failedResults = results.filter(r => !r.success);
        if (failedResults.length > 0) {
            console.log(`\n❌ Failed to process ${failedResults.length} videos:`);
            failedResults.forEach(result => {
                console.log(`   - ${result.title} (${result.videoId}): ${result.error}`);
            });
        }
        
        // Show videos with deletions
        const videosWithDeletions = results.filter(r => r.success && r.captionsDeleted > 0);
        if (videosWithDeletions.length > 0) {
            console.log(`\n🗑️  Videos with deleted captions (${videosWithDeletions.length}):`);
            videosWithDeletions.forEach(result => {
                console.log(`   - ${result.title}: ${result.captionsDeleted} caption(s) deleted`);
                if (result.deleteResults) {
                    result.deleteResults.forEach(del => {
                        const status = del.success ? '✅' : '❌';
                        console.log(`     ${status} ${del.language}`);
                    });
                }
            });
        }
        
        if (totalCaptionsDeleted > 0) {
            console.log(`\n🎉 Successfully cleaned up ${totalCaptionsDeleted} unwanted caption languages!`);
            console.log(`📚 All videos now only have captions in allowed languages: ${config.allowedLanguages.join(', ')}`);
        } else {
            console.log(`\n✨ No cleanup needed! All captions are already in allowed languages.`);
        }
        
        return {
            totalVideos: allVideos.length,
            processedVideos: processedCount,
            totalCaptionsDeleted,
            results
        };
        
    } catch (error) {
        console.error('❌ Error in caption language cleanup process:', error.message);
        process.exit(1);
    }
}

/**
 * Processes caption cleanup for a specific video ID
 */
async function cleanupCaptionLanguagesForVideo(videoId) {
    try {
        console.log(`🧹 Processing caption cleanup for specific video: ${videoId}`);
        console.log(`🎯 Allowed languages: ${config.allowedLanguages.join(', ')}`);
        
        // Ensure we have valid authentication
        console.log('🔑 Ensuring valid authentication...');
        
        const result = await processVideoCaptions({ videoId, title: 'Manual Cleanup' });
        
        console.log('\n📊 Cleanup Summary:');
        if (result.success) {
            console.log(`✅ Video processed successfully`);
            console.log(`📝 Captions found: ${result.captionsProcessed || 0}`);
            console.log(`🗑️  Captions deleted: ${result.captionsDeleted || 0}`);
            
            if (result.deleteResults && result.deleteResults.length > 0) {
                console.log(`\nDeleted languages:`);
                result.deleteResults.forEach(del => {
                    const status = del.success ? '✅' : '❌';
                    console.log(`   ${status} ${del.language}`);
                });
            }
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

// Execute the function if this file is run directly
if (require.main === module) {
    const command = process.argv[2];
    const videoId = process.argv[3];
    
    if (command === 'single' && videoId) {
        cleanupCaptionLanguagesForVideo(videoId)
            .then(result => {
                if (result.success) {
                    console.log('\nCaption language cleanup completed successfully!');
                    process.exit(0);
                } else {
                    console.log('\nCaption language cleanup failed!');
                    process.exit(1);
                }
            })
            .catch(error => {
                console.error('\nError:', error.message);
                process.exit(1);
            });
    } else {
        cleanupAllCaptionLanguages()
            .then(result => {
                if (result && result.processedVideos > 0) {
                    console.log('\nCaption language cleanup completed!');
                    process.exit(0);
                } else {
                    console.log('\nNo videos were processed successfully.');
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
    cleanupAllCaptionLanguages,
    cleanupCaptionLanguagesForVideo,
    getAllVideos,
    getVideoCaptions,
    deleteCaption,
    processVideoCaptions
}; 