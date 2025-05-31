require('dotenv').config();
const fs = require('fs');
const { getAccessToken, makeAuthenticatedRequest } = require('./auth.js');

// Configuration
const config = {
    apiBaseUrl: 'https://ws.api.video',
    delayBetweenRequests: process.env.DELAY_BETWEEN_REQUESTS || 1000,
    reportFile: process.env.CAPTION_REPORT_FILE || './caption_validation_report.json',
    outputFile: process.env.CLEANUP_OUTPUT_FILE || './null_caption_cleanup_report.json'
};

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
 * Main function to clean up null/undetectable language captions
 */
async function cleanupNullLanguageCaptions() {
    try {
        console.log('🧹 Starting Null Language Caption Cleanup...');
        
        // Ensure we have valid authentication
        console.log('🔑 Ensuring valid authentication...');
        await getAccessToken();
        
        // Load validation report
        if (!fs.existsSync(config.reportFile)) {
            console.error(`❌ Validation report not found: ${config.reportFile}`);
            console.log('💡 Please run the caption language validator first');
            return;
        }
        
        console.log(`📖 Loading validation report: ${config.reportFile}`);
        const reportData = JSON.parse(fs.readFileSync(config.reportFile, 'utf8'));
        
        // Filter null language mismatches
        const nullLanguageMismatches = reportData.results.filter(result => 
            result.status === 'mismatch' && (
                !result.detectedLangCode || 
                result.detectedLangCode === 'null' || 
                result.detectedLangCode.trim() === ''
            )
        );
        
        if (nullLanguageMismatches.length === 0) {
            console.log('🎉 No null language captions found! All mismatches have detectable languages.');
            return;
        }
        
        console.log(`\n📊 Found ${nullLanguageMismatches.length} captions with undetectable languages`);
        
        // Show summary by language slot
        const byLanguageSlot = {};
        nullLanguageMismatches.forEach(m => {
            byLanguageSlot[m.language] = (byLanguageSlot[m.language] || 0) + 1;
        });
        
        console.log(`\n🔍 Null Language Summary by Slot:`);
        Object.entries(byLanguageSlot).forEach(([slot, count]) => {
            console.log(`  ${slot}: ${count} captions`);
        });
        
        // Show some examples
        console.log(`\n📋 Examples of undetectable captions:`);
        nullLanguageMismatches.slice(0, 5).forEach((mismatch, index) => {
            console.log(`${index + 1}. ${mismatch.videoTitle}`);
            console.log(`   📍 ${mismatch.language} slot: "${mismatch.firstWords}"`);
            console.log(`   🔗 ${mismatch.captionSrc}`);
        });
        
        if (nullLanguageMismatches.length > 5) {
            console.log(`   ... and ${nullLanguageMismatches.length - 5} more`);
        }
        
        console.log(`\n⚠️  WARNING: About to delete ${nullLanguageMismatches.length} captions with undetectable languages!`);
        console.log('These captions contain text that could not be reliably identified as any specific language.');
        console.log('This action cannot be undone.');
        
        // Confirmation prompt
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        const confirmation = await new Promise((resolve) => {
            rl.question('Continue with deletion? (yes/no): ', (answer) => {
                rl.close();
                resolve(answer.toLowerCase().trim());
            });
        });
        
        if (confirmation !== 'yes' && confirmation !== 'y') {
            console.log('👋 Operation cancelled');
            return;
        }
        
        // Process deletions
        console.log(`\n🔄 Deleting ${nullLanguageMismatches.length} null language captions...`);
        
        const results = [];
        let successCount = 0;
        let errorCount = 0;
        
        for (let i = 0; i < nullLanguageMismatches.length; i++) {
            const mismatch = nullLanguageMismatches[i];
            console.log(`\n[${i + 1}/${nullLanguageMismatches.length}] ${mismatch.videoTitle} (${mismatch.language})`);
            
            try {
                const result = await deleteCaption(mismatch.videoId, mismatch.language);
                
                results.push({
                    mismatch,
                    action: 'delete',
                    result,
                    processedAt: new Date().toISOString()
                });
                
                if (result.success) {
                    successCount++;
                } else {
                    errorCount++;
                    console.log(`❌ Failed: ${result.error}`);
                }
                
                // Add delay between requests
                if (i < nullLanguageMismatches.length - 1 && config.delayBetweenRequests > 0) {
                    await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
                }
                
            } catch (error) {
                console.error(`❌ Error processing deletion:`, error.message);
                errorCount++;
                
                results.push({
                    mismatch,
                    action: 'delete',
                    result: { success: false, error: error.message },
                    processedAt: new Date().toISOString()
                });
            }
        }
        
        console.log(`\n📊 Null Language Cleanup Summary:`);
        console.log(`✅ Successful deletions: ${successCount}`);
        console.log(`❌ Errors: ${errorCount}`);
        console.log(`📝 Total processed: ${results.length}`);
        
        // Save results
        const report = {
            summary: {
                processedAt: new Date().toISOString(),
                action: 'delete_null_languages',
                totalNullCaptions: nullLanguageMismatches.length,
                processed: results.length,
                successful: successCount,
                errors: errorCount
            },
            results
        };
        
        fs.writeFileSync(config.outputFile, JSON.stringify(report, null, 2));
        console.log(`💾 Cleanup report saved to: ${config.outputFile}`);
        
        console.log(`\n🎉 Null language caption cleanup complete!`);
        
    } catch (error) {
        console.error('❌ Error in null language cleanup process:', error.message);
        process.exit(1);
    }
}

// Execute if this file is run directly
if (require.main === module) {
    cleanupNullLanguageCaptions().catch(error => {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = {
    cleanupNullLanguageCaptions,
    deleteCaption
}; 