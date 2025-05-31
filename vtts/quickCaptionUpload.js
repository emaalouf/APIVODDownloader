require('dotenv').config();
const fs = require('fs');
const { getAccessToken, makeAuthenticatedRequest } = require('../auth.js');

// Configuration
const config = {
    apiBaseUrl: 'https://ws.api.video',
    delayBetweenRequests: process.env.DELAY_BETWEEN_REQUESTS || 1000,
    fixerReportFile: process.env.FIXER_REPORT_FILE || './caption_fixer_report.json',
    subtitlesFolder: process.env.SUBTITLES_FOLDER || './subtitles',
    outputFile: process.env.QUICK_UPLOAD_OUTPUT_FILE || './quick_caption_upload_report.json',
    targetLanguages: ['en', 'fr', 'ar', 'es', 'it']
};

/**
 * Gets the languages that were actually deleted from the fixer report
 */
function getDeletedLanguageSlots(fixerData) {
    const deletedSlots = new Map(); // videoId -> Set of deleted languages
    
    fixerData.results.forEach(result => {
        if (result.result.success && result.mismatch) {
            const videoId = result.mismatch.videoId;
            const language = result.mismatch.language;
            
            if (!deletedSlots.has(videoId)) {
                deletedSlots.set(videoId, new Set());
            }
            deletedSlots.get(videoId).add(language);
        }
    });
    
    return deletedSlots;
}

/**
 * Uploads caption only for deleted language slots
 */
async function uploadOnlyDeletedSlots() {
    try {
        console.log('🎯 Quick Caption Upload - Only Deleted Slots...');
        
        // Ensure we have valid authentication
        console.log('🔑 Ensuring valid authentication...');
        await getAccessToken();
        
        // Load fixer report
        if (!fs.existsSync(config.fixerReportFile)) {
            console.error(`❌ Fixer report not found: ${config.fixerReportFile}`);
            return;
        }
        
        console.log(`📖 Loading fixer report: ${config.fixerReportFile}`);
        const fixerData = JSON.parse(fs.readFileSync(config.fixerReportFile, 'utf8'));
        
        // Get specifically deleted language slots
        const deletedSlots = getDeletedLanguageSlots(fixerData);
        
        console.log(`\n📊 Found ${deletedSlots.size} videos with deleted caption slots`);
        
        // Load re-uploader functions
        const { getVttFilesForVideo } = require('./captionReUploader.js');
        
        const uploadPlan = [];
        let totalUploads = 0;
        
        for (const [videoId, deletedLanguages] of deletedSlots) {
            const vttFiles = getVttFilesForVideo(videoId);
            
            // Filter to only the languages that were actually deleted
            const targetUploads = vttFiles.filter(file => deletedLanguages.has(file.language));
            
            if (targetUploads.length > 0) {
                uploadPlan.push({
                    videoId,
                    uploads: targetUploads
                });
                totalUploads += targetUploads.length;
                
                console.log(`📹 ${videoId}: ${targetUploads.length} uploads needed`);
                targetUploads.forEach(file => {
                    console.log(`    📄 ${file.language}: ${file.filename}`);
                });
            }
        }
        
        if (uploadPlan.length === 0) {
            console.log('❌ No uploads needed - no VTT files found for deleted slots');
            return;
        }
        
        console.log(`\n🎯 Quick Upload Plan:`);
        console.log(`📹 Videos: ${uploadPlan.length}`);
        console.log(`📄 Uploads needed: ${totalUploads}`);
        console.log(`💡 Only uploading to slots that were actually deleted by the fixer`);
        
        // Auto-proceed since we're only targeting empty slots
        console.log(`\n🚀 Starting uploads to deleted slots only...`);
        
        const { uploadCaption } = require('./captionReUploader.js');
        const results = [];
        let successCount = 0;
        let errorCount = 0;
        
        for (let i = 0; i < uploadPlan.length; i++) {
            const plan = uploadPlan[i];
            console.log(`\n📹 [${i + 1}/${uploadPlan.length}] ${plan.videoId}`);
            
            for (const upload of plan.uploads) {
                try {
                    const result = await uploadCaption(
                        upload.videoId,
                        upload.fullPath,
                        upload.language,
                        false // Don't overwrite - these should be empty slots
                    );
                    
                    results.push({
                        videoId: upload.videoId,
                        language: upload.language,
                        filename: upload.filename,
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
                        videoId: upload.videoId,
                        language: upload.language,
                        filename: upload.filename,
                        result: { success: false, error: error.message },
                        processedAt: new Date().toISOString()
                    });
                }
            }
        }
        
        console.log(`\n📊 Quick Upload Summary:`);
        console.log(`📹 Videos processed: ${uploadPlan.length}`);
        console.log(`✅ Successful uploads: ${successCount}`);
        console.log(`❌ Errors: ${errorCount}`);
        console.log(`📝 Total processed: ${results.length}`);
        
        // Save results
        const report = {
            summary: {
                processedAt: new Date().toISOString(),
                action: 'quick_upload_deleted_slots_only',
                videosProcessed: uploadPlan.length,
                totalUploads: results.length,
                successful: successCount,
                errors: errorCount,
                fixerReportUsed: config.fixerReportFile
            },
            results
        };
        
        fs.writeFileSync(config.outputFile, JSON.stringify(report, null, 2));
        console.log(`💾 Quick upload report saved to: ${config.outputFile}`);
        
        console.log(`\n🎉 Quick upload complete!`);
        
        if (successCount > 0) {
            console.log(`💡 Next step: Run 'node captionLanguageValidator.js' to verify uploads`);
        }
        
    } catch (error) {
        console.error('❌ Error in quick upload process:', error.message);
        process.exit(1);
    }
}

// Execute if this file is run directly
if (require.main === module) {
    uploadOnlyDeletedSlots().catch(error => {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = {
    uploadOnlyDeletedSlots,
    getDeletedLanguageSlots
}; 