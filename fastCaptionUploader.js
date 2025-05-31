require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getAccessToken, makeAuthenticatedRequest } = require('./auth.js');

// Configuration
const config = {
    apiBaseUrl: 'https://ws.api.video',
    delayBetweenRequests: process.env.DELAY_BETWEEN_REQUESTS || 1000,
    completionReportFile: process.env.COMPLETION_REPORT_FILE || './caption_completion_report.json',
    outputFile: process.env.FAST_UPLOAD_OUTPUT_FILE || './fast_caption_upload_report.json',
};

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
 * Main function to upload missing captions from completion report
 */
async function uploadMissingCaptionsFromReport() {
    try {
        console.log('🚀 Fast Caption Upload from Completion Report...');
        
        // Ensure we have valid authentication
        console.log('🔑 Ensuring valid authentication...');
        await getAccessToken();
        
        // Load completion report
        if (!fs.existsSync(config.completionReportFile)) {
            console.error(`❌ Completion report not found: ${config.completionReportFile}`);
            console.log('💡 Please run captionCompletionChecker.js first to generate the report');
            return;
        }
        
        console.log(`📖 Loading completion report: ${config.completionReportFile}`);
        const completionData = JSON.parse(fs.readFileSync(config.completionReportFile, 'utf8'));
        
        // Extract incomplete videos that can be completed
        const incompleteVideos = completionData.results.filter(
            video => video.status === 'incomplete' && video.canComplete
        );
        
        if (incompleteVideos.length === 0) {
            console.log('🎉 All videos are already complete! No uploads needed.');
            return;
        }
        
        // Calculate upload plan
        let totalUploadsNeeded = 0;
        incompleteVideos.forEach(video => {
            totalUploadsNeeded += video.missingLanguages.length;
        });
        
        console.log(`\n📊 Upload Plan:`);
        console.log(`📹 Incomplete videos: ${incompleteVideos.length}`);
        console.log(`📄 Total captions to upload: ${totalUploadsNeeded}`);
        console.log(`🌍 Languages: en, fr, ar, es, it`);
        
        // Show some examples
        console.log(`\n📋 Examples of what will be uploaded:`);
        incompleteVideos.slice(0, 5).forEach((video, index) => {
            console.log(`${index + 1}. ${video.videoTitle} (${video.videoId})`);
            console.log(`   📊 Current: ${video.completionRate.toFixed(1)}% (${video.existingLanguages.length}/${video.missingLanguages.length + video.existingLanguages.length})`);
            console.log(`   📄 Will upload: ${video.missingLanguages.join(', ')}`);
        });
        
        if (incompleteVideos.length > 5) {
            console.log(`   ... and ${incompleteVideos.length - 5} more videos`);
        }
        
        // Confirmation
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        console.log(`\n❓ Ready to upload ${totalUploadsNeeded} missing captions?`);
        const confirmation = await new Promise((resolve) => {
            rl.question('Start upload? (yes/no): ', (answer) => {
                rl.close();
                resolve(answer.toLowerCase().trim());
            });
        });
        
        if (confirmation !== 'yes' && confirmation !== 'y') {
            console.log('👋 Upload cancelled');
            return;
        }
        
        // Start uploading
        console.log(`\n🚀 Starting upload of ${totalUploadsNeeded} captions...`);
        
        const results = [];
        let successCount = 0;
        let errorCount = 0;
        let completedVideos = 0;
        
        for (let i = 0; i < incompleteVideos.length; i++) {
            const video = incompleteVideos[i];
            
            console.log(`\n📹 [${i + 1}/${incompleteVideos.length}] ${video.videoTitle}`);
            console.log(`   📊 Uploading ${video.missingLanguages.length} missing captions...`);
            
            let videoSuccessCount = 0;
            
            for (const language of video.missingLanguages) {
                const vttPath = video.hasVttFiles[language]?.path;
                
                if (!vttPath) {
                    console.log(`   ⚠️  No VTT file found for ${language}`);
                    continue;
                }
                
                try {
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
                        videoSuccessCount++;
                        console.log(`   ✅ ${language} uploaded successfully`);
                    } else {
                        errorCount++;
                        console.log(`   ❌ ${language} failed: ${result.error}`);
                    }
                    
                    // Add delay between uploads
                    if (config.delayBetweenRequests > 0) {
                        await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
                    }
                    
                } catch (error) {
                    console.error(`   ❌ ${language} error:`, error.message);
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
            
            if (videoSuccessCount === video.missingLanguages.length) {
                completedVideos++;
                console.log(`   🎉 Video now 100% complete!`);
            } else {
                console.log(`   ⚠️  Video partially completed (${videoSuccessCount}/${video.missingLanguages.length} uploads succeeded)`);
            }
        }
        
        console.log(`\n📊 Upload Summary:`);
        console.log(`📹 Videos processed: ${incompleteVideos.length}`);
        console.log(`🎯 Videos now 100% complete: ${completedVideos}`);
        console.log(`📄 Total upload attempts: ${results.length}`);
        console.log(`✅ Successful uploads: ${successCount}`);
        console.log(`❌ Failed uploads: ${errorCount}`);
        console.log(`📈 Success rate: ${((successCount / results.length) * 100).toFixed(1)}%`);
        
        // Calculate new completion statistics
        const originalComplete = completionData.summary.completeVideos;
        const newCompleteVideos = originalComplete + completedVideos;
        const newIncompleteVideos = completionData.summary.incompleteVideos - completedVideos;
        const newCompletionRate = (newCompleteVideos / completionData.summary.videosChecked) * 100;
        
        console.log(`\n🎊 New Library Statistics:`);
        console.log(`📹 Total videos: ${completionData.summary.videosChecked}`);
        console.log(`✅ Complete videos: ${newCompleteVideos} (was ${originalComplete})`);
        console.log(`⚠️  Incomplete videos: ${newIncompleteVideos}`);
        console.log(`📈 Overall completion rate: ${newCompletionRate.toFixed(1)}%`);
        
        // Save results
        const report = {
            summary: {
                processedAt: new Date().toISOString(),
                action: 'fast_upload_missing_captions',
                videosProcessed: incompleteVideos.length,
                videosCompleted: completedVideos,
                totalUploads: results.length,
                successful: successCount,
                errors: errorCount,
                successRate: (successCount / results.length) * 100,
                originalStats: completionData.summary,
                newStats: {
                    completeVideos: newCompleteVideos,
                    incompleteVideos: newIncompleteVideos,
                    completionRate: newCompletionRate
                }
            },
            results
        };
        
        fs.writeFileSync(config.outputFile, JSON.stringify(report, null, 2));
        console.log(`💾 Upload report saved to: ${config.outputFile}`);
        
        console.log(`\n🎉 Fast caption upload complete!`);
        
        if (successCount > 0) {
            console.log(`\n💡 Next steps:`);
            console.log(`   1. Run 'node captionLanguageValidator.js' to verify uploads`);
            console.log(`   2. Run 'node captionCompletionChecker.js' to get updated statistics`);
        }
        
        if (errorCount > 0) {
            console.log(`\n⚠️  Some uploads failed. Check the report for details: ${config.outputFile}`);
        }
        
    } catch (error) {
        console.error('❌ Error in fast caption upload:', error.message);
        process.exit(1);
    }
}

// Execute if this file is run directly
if (require.main === module) {
    uploadMissingCaptionsFromReport().catch(error => {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = {
    uploadMissingCaptionsFromReport,
    uploadCaption
}; 