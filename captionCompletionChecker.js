require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getAccessToken, makeAuthenticatedRequest } = require('./auth.js');

// Configuration
const config = {
    apiBaseUrl: 'https://ws.api.video',
    delayBetweenRequests: process.env.DELAY_BETWEEN_REQUESTS || 1000,
    subtitlesFolder: process.env.SUBTITLES_FOLDER || './subtitles',
    outputFile: process.env.COMPLETION_OUTPUT_FILE || './caption_completion_report.json',
    requiredLanguages: ['en', 'fr', 'ar', 'es', 'it'], // All 5 required languages
    maxVideosToCheck: process.env.MAX_VIDEOS_TO_CHECK || null, // null = all videos
};

/**
 * Fetches all videos from API.video with pagination
 */
async function getAllVideos() {
    const allVideos = [];
    let currentPage = 1;
    let hasMore = true;
    
    try {
        console.log('📹 Fetching all videos from API.video...');
        
        while (hasMore) {
            console.log(`📄 Fetching page ${currentPage}...`);
            
            const response = await makeAuthenticatedRequest({
                method: 'GET',
                url: `${config.apiBaseUrl}/videos`,
                params: {
                    currentPage: currentPage,
                    pageSize: 100
                }
            });
            
            if (response.status === 200) {
                const videos = response.data.data;
                allVideos.push(...videos);
                
                console.log(`✅ Page ${currentPage}: Found ${videos.length} videos (Total: ${allVideos.length})`);
                
                const pagination = response.data.pagination;
                hasMore = pagination && pagination.currentPage < pagination.pagesTotal;
                currentPage++;
                
                if (hasMore) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } else {
                console.error(`❌ Failed to fetch videos page ${currentPage}: ${response.status}`);
                break;
            }
        }
        
        console.log(`🎬 Total videos fetched: ${allVideos.length}`);
        return allVideos;
        
    } catch (error) {
        console.error('❌ Error fetching videos:', error.response?.data || error.message);
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
        console.error(`❌ Error fetching captions for video ${videoId}:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Finds VTT files for a specific video and language
 */
function findVttFile(videoId, language) {
    if (!fs.existsSync(config.subtitlesFolder)) {
        return null;
    }
    
    const allFiles = fs.readdirSync(config.subtitlesFolder);
    
    // Look for files matching [videoId]_*_language.vtt pattern
    const pattern = new RegExp(`^\\[${videoId}\\].*_${language}\\.vtt$`);
    const matchingFile = allFiles.find(file => pattern.test(file));
    
    return matchingFile ? path.join(config.subtitlesFolder, matchingFile) : null;
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
            return { success: true, videoId, filename, language };
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
 * Checks completion status for a single video
 */
async function checkVideoCompletion(video) {
    const videoId = video.videoId;
    const videoTitle = video.title;
    
    console.log(`\n🎬 Checking: ${videoTitle} (${videoId})`);
    
    // Get existing captions
    const captionsResult = await getVideoCaptions(videoId);
    
    if (!captionsResult.success) {
        console.log(`❌ Could not fetch captions: ${captionsResult.error}`);
        return {
            videoId,
            videoTitle,
            status: 'error',
            error: captionsResult.error,
            existingLanguages: [],
            missingLanguages: config.requiredLanguages,
            hasVttFiles: {},
            completionRate: 0
        };
    }
    
    // Analyze existing captions
    const existingLanguages = captionsResult.captions.map(caption => caption.srclang);
    const missingLanguages = config.requiredLanguages.filter(lang => !existingLanguages.includes(lang));
    
    console.log(`✅ Existing: ${existingLanguages.join(', ') || 'none'}`);
    if (missingLanguages.length > 0) {
        console.log(`❌ Missing: ${missingLanguages.join(', ')}`);
    }
    
    // Check for VTT files for missing languages
    const hasVttFiles = {};
    for (const language of missingLanguages) {
        const vttFile = findVttFile(videoId, language);
        hasVttFiles[language] = {
            exists: !!vttFile,
            path: vttFile
        };
        
        if (vttFile) {
            console.log(`📄 Found VTT for ${language}: ${path.basename(vttFile)}`);
        } else {
            console.log(`⚠️  No VTT file found for ${language}`);
        }
    }
    
    const completionRate = (existingLanguages.length / config.requiredLanguages.length) * 100;
    const status = missingLanguages.length === 0 ? 'complete' : 'incomplete';
    
    console.log(`📊 Completion: ${completionRate.toFixed(1)}% (${existingLanguages.length}/${config.requiredLanguages.length})`);
    
    return {
        videoId,
        videoTitle,
        status,
        existingLanguages,
        missingLanguages,
        hasVttFiles,
        completionRate,
        canComplete: missingLanguages.every(lang => hasVttFiles[lang]?.exists)
    };
}

/**
 * Uploads missing captions for incomplete videos
 */
async function uploadMissingCaptions(incompleteVideos) {
    console.log(`\n🚀 Starting upload of missing captions...`);
    
    const results = [];
    let totalUploads = 0;
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < incompleteVideos.length; i++) {
        const video = incompleteVideos[i];
        
        if (!video.canComplete) {
            console.log(`\n⏭️  [${i + 1}/${incompleteVideos.length}] Skipping ${video.videoTitle} - missing VTT files`);
            continue;
        }
        
        console.log(`\n📹 [${i + 1}/${incompleteVideos.length}] Completing ${video.videoTitle}`);
        
        for (const language of video.missingLanguages) {
            const vttPath = video.hasVttFiles[language].path;
            
            if (!vttPath) continue;
            
            try {
                totalUploads++;
                const result = await uploadCaption(video.videoId, vttPath, language);
                
                results.push({
                    videoId: video.videoId,
                    videoTitle: video.videoTitle,
                    language,
                    result,
                    processedAt: new Date().toISOString()
                });
                
                if (result.success) {
                    successCount++;
                } else {
                    errorCount++;
                }
                
                if (config.delayBetweenRequests > 0) {
                    await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
                }
                
            } catch (error) {
                console.error(`❌ Upload error:`, error.message);
                errorCount++;
                
                results.push({
                    videoId: video.videoId,
                    videoTitle: video.videoTitle,
                    language,
                    result: { success: false, error: error.message },
                    processedAt: new Date().toISOString()
                });
            }
        }
    }
    
    console.log(`\n📊 Upload Summary:`);
    console.log(`📹 Videos processed: ${incompleteVideos.length}`);
    console.log(`📄 Total uploads attempted: ${totalUploads}`);
    console.log(`✅ Successful uploads: ${successCount}`);
    console.log(`❌ Failed uploads: ${errorCount}`);
    
    return results;
}

/**
 * Main function to check and complete caption coverage
 */
async function checkCaptionCompletion(options = {}) {
    try {
        console.log('📊 Starting Caption Completion Check...');
        
        // Ensure we have valid authentication
        console.log('🔑 Ensuring valid authentication...');
        await getAccessToken();
        
        console.log(`\n⚙️  Configuration:`);
        console.log(`🌍 Required languages: ${config.requiredLanguages.join(', ')}`);
        console.log(`📂 Subtitles folder: ${config.subtitlesFolder}`);
        console.log(`📊 Max videos to check: ${config.maxVideosToCheck || 'All'}`);
        
        // Fetch all videos
        const allVideos = await getAllVideos();
        
        if (allVideos.length === 0) {
            console.log('❌ No videos found');
            return;
        }
        
        // Limit videos if specified
        const videosToCheck = config.maxVideosToCheck 
            ? allVideos.slice(0, parseInt(config.maxVideosToCheck))
            : allVideos;
        
        console.log(`\n📊 Processing ${videosToCheck.length} videos...`);
        
        const allResults = [];
        let completeVideos = 0;
        let incompleteVideos = 0;
        let errorVideos = 0;
        
        // Check each video
        for (let i = 0; i < videosToCheck.length; i++) {
            const video = videosToCheck[i];
            
            console.log(`\n🔄 [${i + 1}/${videosToCheck.length}]`);
            
            const result = await checkVideoCompletion(video);
            allResults.push(result);
            
            if (result.status === 'complete') {
                completeVideos++;
            } else if (result.status === 'incomplete') {
                incompleteVideos++;
            } else {
                errorVideos++;
            }
            
            // Add delay between checks
            if (i < videosToCheck.length - 1 && config.delayBetweenRequests > 0) {
                await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
            }
        }
        
        // Calculate statistics
        const incomplete = allResults.filter(r => r.status === 'incomplete');
        const canBeCompleted = incomplete.filter(r => r.canComplete);
        const totalMissingCaptions = incomplete.reduce((sum, video) => sum + video.missingLanguages.length, 0);
        const averageCompletion = allResults.reduce((sum, r) => sum + r.completionRate, 0) / allResults.length;
        
        console.log(`\n📊 Caption Completion Summary:`);
        console.log(`🎬 Total videos checked: ${videosToCheck.length}`);
        console.log(`✅ Complete videos (5/5 languages): ${completeVideos}`);
        console.log(`⚠️  Incomplete videos: ${incompleteVideos}`);
        console.log(`❌ Error videos: ${errorVideos}`);
        console.log(`📈 Average completion rate: ${averageCompletion.toFixed(1)}%`);
        console.log(`🔢 Total missing captions: ${totalMissingCaptions}`);
        console.log(`🔧 Can be auto-completed: ${canBeCompleted.length} videos`);
        
        // Show incomplete videos
        if (incomplete.length > 0) {
            console.log(`\n⚠️  Incomplete Videos:`);
            incomplete.forEach((video, index) => {
                console.log(`${index + 1}. ${video.videoTitle} (${video.videoId})`);
                console.log(`   📊 ${video.completionRate.toFixed(1)}% complete (${video.existingLanguages.length}/${config.requiredLanguages.length})`);
                console.log(`   ❌ Missing: ${video.missingLanguages.join(', ')}`);
                console.log(`   📄 Has VTT files: ${video.missingLanguages.filter(lang => video.hasVttFiles[lang]?.exists).join(', ') || 'none'}`);
                console.log('');
            });
        }
        
        // Option to complete missing captions
        if (canBeCompleted.length > 0 && options.uploadMissing !== false) {
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            console.log(`\n🔧 Found ${canBeCompleted.length} videos that can be auto-completed`);
            const confirmation = await new Promise((resolve) => {
                rl.question('Upload missing captions? (yes/no): ', (answer) => {
                    rl.close();
                    resolve(answer.toLowerCase().trim());
                });
            });
            
            if (confirmation === 'yes' || confirmation === 'y') {
                const uploadResults = await uploadMissingCaptions(canBeCompleted);
                
                // Update results
                allResults.forEach(video => {
                    if (canBeCompleted.some(cv => cv.videoId === video.videoId)) {
                        video.uploadResults = uploadResults.filter(ur => ur.videoId === video.videoId);
                    }
                });
            }
        }
        
        // Save detailed report
        const report = {
            summary: {
                processedAt: new Date().toISOString(),
                videosChecked: videosToCheck.length,
                completeVideos,
                incompleteVideos,
                errorVideos,
                averageCompletionRate: averageCompletion,
                totalMissingCaptions,
                canBeCompleted: canBeCompleted.length,
                requiredLanguages: config.requiredLanguages
            },
            results: allResults
        };
        
        fs.writeFileSync(config.outputFile, JSON.stringify(report, null, 2));
        console.log(`💾 Completion report saved to: ${config.outputFile}`);
        
        console.log(`\n🎉 Caption completion check complete!`);
        
        if (incompleteVideos > 0) {
            console.log(`\n💡 Next steps:`);
            console.log(`   1. Review the report: ${config.outputFile}`);
            console.log(`   2. Generate missing VTT files if needed`);
            console.log(`   3. Re-run this tool to complete coverage`);
        }
        
    } catch (error) {
        console.error('❌ Error in caption completion check:', error.message);
        process.exit(1);
    }
}

// Execute if this file is run directly
if (require.main === module) {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const options = {};
    
    if (args.includes('--no-upload')) {
        options.uploadMissing = false;
    }
    
    checkCaptionCompletion(options).catch(error => {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = {
    checkCaptionCompletion,
    checkVideoCompletion,
    getAllVideos,
    getVideoCaptions,
    findVttFile,
    uploadMissingCaptions
}; 