require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { getAccessToken, makeAuthenticatedRequest } = require('./auth.js');

// Configuration from environment variables
const config = {
    apiBaseUrl: 'https://ws.api.video',
    delayBetweenRequests: process.env.DELAY_BETWEEN_REQUESTS || 1000,
    maxRetries: 3,
    reportFile: process.env.CAPTION_REPORT_FILE || './caption_validation_report.json',
    outputFile: process.env.FIXER_OUTPUT_FILE || './caption_fixer_report.json'
};

/**
 * Gets captions for a specific video and language
 */
async function getVideoCaption(videoId, language) {
    try {
        const response = await makeAuthenticatedRequest({
            method: 'GET',
            url: `${config.apiBaseUrl}/videos/${videoId}/captions/${language}`
        });
        
        if (response.status === 200) {
            return { success: true, caption: response.data };
        } else {
            return { success: false, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        // 404 is expected if caption doesn't exist
        if (error.response?.status === 404) {
            return { success: false, error: 'Caption not found' };
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
 * Downloads VTT content from a URL and uploads it to a different language slot
 */
async function moveCaption(videoId, fromLanguage, toLanguage, captionSrc) {
    try {
        console.log(`🔄 Moving caption from ${fromLanguage} to ${toLanguage} for video ${videoId}...`);
        
        // Step 1: Download the VTT content
        const axios = require('axios');
        let vttContent;
        
        try {
            const vttResponse = await axios.get(captionSrc, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Caption-Language-Fixer/1.0'
                }
            });
            
            if (vttResponse.status !== 200) {
                return { success: false, error: `Failed to download VTT: HTTP ${vttResponse.status}` };
            }
            
            vttContent = vttResponse.data;
            
        } catch (downloadError) {
            if (downloadError.response?.status === 404) {
                console.log(`⚠️  VTT file not found at source URL. Caption may have been deleted.`);
                console.log(`🗑️  Deleting the invalid ${fromLanguage} caption entry...`);
                
                // Just delete the broken caption since we can't move it
                const deleteResult = await deleteCaption(videoId, fromLanguage);
                return { 
                    success: deleteResult.success, 
                    error: deleteResult.success ? null : `Failed to delete broken caption: ${deleteResult.error}`,
                    action: 'deleted_broken_caption'
                };
            }
            return { success: false, error: `Failed to download VTT: ${downloadError.message}` };
        }
        
        // Step 2: Check if target language slot already exists
        const existingCaption = await getVideoCaption(videoId, toLanguage);
        if (existingCaption.success) {
            console.log(`⚠️  Target language ${toLanguage} already has a caption.`);
            console.log(`🤔 Would you like to overwrite it? Deleting existing ${toLanguage} caption first...`);
            
            // Delete existing target caption to make room for the correct one
            const deleteExistingResult = await deleteCaption(videoId, toLanguage);
            if (!deleteExistingResult.success) {
                return { success: false, error: `Could not delete existing ${toLanguage} caption: ${deleteExistingResult.error}` };
            }
        }
        
        // Step 3: Upload to new language slot
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('file', Buffer.from(vttContent), {
            filename: `${videoId}_${toLanguage}.vtt`,
            contentType: 'text/vtt'
        });
        
        const uploadResponse = await makeAuthenticatedRequest({
            method: 'POST',
            url: `${config.apiBaseUrl}/videos/${videoId}/captions/${toLanguage}`,
            data: formData,
            headers: {
                ...formData.getHeaders()
            }
        });
        
        if (uploadResponse.status !== 200 && uploadResponse.status !== 201) {
            return { success: false, error: `Failed to upload to ${toLanguage}: HTTP ${uploadResponse.status}` };
        }
        
        // Step 4: Delete the old caption
        const deleteResult = await deleteCaption(videoId, fromLanguage);
        if (!deleteResult.success) {
            console.log(`⚠️  Warning: Could not delete original ${fromLanguage} caption: ${deleteResult.error}`);
        }
        
        console.log(`✅ Successfully moved caption from ${fromLanguage} to ${toLanguage}`);
        return { success: true };
        
    } catch (error) {
        console.error(`❌ Error moving caption:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Gets user input for fixing options
 */
function getUserChoice() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        rl.question('Choose action (d/m/s/q): ', (answer) => {
            rl.close();
            resolve(answer.toLowerCase().trim());
        });
    });
}

/**
 * Shows fix options for a mismatch
 */
function showFixOptions(mismatch) {
    console.log(`\n🔧 Fix Options for: ${mismatch.videoTitle} (${mismatch.videoId})`);
    console.log(`📍 Language slot: ${mismatch.language} (declared as ${mismatch.declaredLanguage})`);
    console.log(`🤖 Detected language: ${mismatch.detectedLanguage} (${mismatch.detectedLangCode})`);
    console.log(`📖 Sample text: "${mismatch.firstWords}"`);
    console.log(``);
    console.log(`Options:`);
    console.log(`  [d] Delete the incorrectly labeled ${mismatch.language} caption`);
    console.log(`  [m] Move caption to correct language slot (${mismatch.detectedLangCode})`);
    console.log(`  [s] Skip this mismatch (keep as is)`);
    console.log(`  [q] Quit fixer`);
    console.log(``);
}

/**
 * Processes a single mismatch interactively
 */
async function processMismatch(mismatch, isInteractive = true) {
    if (isInteractive) {
        showFixOptions(mismatch);
        const choice = await getUserChoice();
        
        switch (choice) {
            case 'd':
                return await deleteCaption(mismatch.videoId, mismatch.language);
                
            case 'm':
                return await moveCaption(
                    mismatch.videoId, 
                    mismatch.language, 
                    mismatch.detectedLangCode, 
                    mismatch.captionSrc
                );
                
            case 's':
                console.log('⏭️  Skipping this mismatch');
                return { success: true, action: 'skipped' };
                
            case 'q':
                console.log('👋 Exiting fixer');
                return { success: false, action: 'quit' };
                
            default:
                console.log('❌ Invalid choice. Skipping...');
                return { success: false, action: 'invalid_choice' };
        }
    } else {
        // Non-interactive mode - just delete incorrect captions
        console.log(`🔄 Auto-deleting incorrect ${mismatch.language} caption for ${mismatch.videoTitle}`);
        return await deleteCaption(mismatch.videoId, mismatch.language);
    }
}

/**
 * Processes mismatches in batch mode
 */
async function processMismatchesBatch(mismatches, action = 'delete') {
    console.log(`\n🔄 Processing ${mismatches.length} mismatches in batch mode...`);
    console.log(`Action: ${action}`);
    
    const results = [];
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < mismatches.length; i++) {
        const mismatch = mismatches[i];
        console.log(`\n[${i + 1}/${mismatches.length}] ${mismatch.videoTitle} (${mismatch.language})`);
        
        try {
            let result;
            
            if (action === 'delete') {
                result = await deleteCaption(mismatch.videoId, mismatch.language);
            } else if (action === 'move') {
                result = await moveCaption(
                    mismatch.videoId, 
                    mismatch.language, 
                    mismatch.detectedLangCode, 
                    mismatch.captionSrc
                );
            } else {
                result = { success: false, error: 'Unknown action' };
            }
            
            results.push({
                mismatch,
                action,
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
            if (i < mismatches.length - 1 && config.delayBetweenRequests > 0) {
                await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
            }
            
        } catch (error) {
            console.error(`❌ Error processing mismatch:`, error.message);
            errorCount++;
            
            results.push({
                mismatch,
                action,
                result: { success: false, error: error.message },
                processedAt: new Date().toISOString()
            });
        }
    }
    
    console.log(`\n📊 Batch Processing Summary:`);
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📝 Total processed: ${results.length}`);
    
    return results;
}

/**
 * Main function to fix caption language mismatches
 */
async function fixCaptionLanguages(options = {}) {
    try {
        console.log('🔧 Starting Caption Language Fixer...');
        
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
        
        // Filter mismatches and exclude null detected languages
        const allMismatches = reportData.results.filter(result => result.status === 'mismatch');
        const mismatches = allMismatches.filter(result => 
            result.detectedLangCode && 
            result.detectedLangCode !== 'null' && 
            result.detectedLangCode.trim() !== ''
        );
        
        const nullLanguageMismatches = allMismatches.filter(result => 
            !result.detectedLangCode || 
            result.detectedLangCode === 'null' || 
            result.detectedLangCode.trim() === ''
        );
        
        if (nullLanguageMismatches.length > 0) {
            console.log(`\n⚠️  Found ${nullLanguageMismatches.length} mismatches with undetectable languages (will be skipped in move operations)`);
            console.log('💡 Consider using --batch-delete for these captions instead');
        }
        
        if (mismatches.length === 0) {
            console.log('🎉 No language mismatches found! All captions are correctly labeled.');
            return;
        }
        
        console.log(`\n📊 Found ${mismatches.length} language mismatches to fix`);
        
        // Show summary
        const mismatchesByLanguage = {};
        mismatches.forEach(m => {
            const key = `${m.language} → ${m.detectedLangCode}`;
            mismatchesByLanguage[key] = (mismatchesByLanguage[key] || 0) + 1;
        });
        
        console.log(`\n🔍 Mismatch Summary:`);
        Object.entries(mismatchesByLanguage).forEach(([pattern, count]) => {
            console.log(`  ${pattern}: ${count} captions`);
        });
        
        // Determine processing mode
        const isInteractive = options.interactive !== false && process.stdin.isTTY;
        const batchAction = options.batchAction || null;
        
        if (batchAction && ['delete', 'move'].includes(batchAction)) {
            // Batch processing mode
            console.log(`\n⚠️  WARNING: About to ${batchAction} ${mismatches.length} mismatched captions!`);
            console.log('This action cannot be undone.');
            
            if (isInteractive) {
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                
                const confirmation = await new Promise((resolve) => {
                    rl.question('Continue? (yes/no): ', (answer) => {
                        rl.close();
                        resolve(answer.toLowerCase().trim());
                    });
                });
                
                if (confirmation !== 'yes' && confirmation !== 'y') {
                    console.log('👋 Operation cancelled');
                    return;
                }
            }
            
            const results = await processMismatchesBatch(mismatches, batchAction);
            
            // Save results
            const report = {
                summary: {
                    processedAt: new Date().toISOString(),
                    action: batchAction,
                    totalMismatches: mismatches.length,
                    processed: results.length,
                    successful: results.filter(r => r.result.success).length,
                    errors: results.filter(r => !r.result.success).length
                },
                results
            };
            
            fs.writeFileSync(config.outputFile, JSON.stringify(report, null, 2));
            console.log(`💾 Fixer report saved to: ${config.outputFile}`);
            
        } else if (isInteractive) {
            // Interactive mode
            console.log(`\n🖱️  Interactive mode: You'll be prompted for each mismatch`);
            console.log('Press Ctrl+C to exit at any time\n');
            
            const results = [];
            
            for (let i = 0; i < mismatches.length; i++) {
                const mismatch = mismatches[i];
                console.log(`\n📍 Mismatch ${i + 1}/${mismatches.length}`);
                
                const result = await processMismatch(mismatch, true);
                
                results.push({
                    mismatch,
                    result,
                    processedAt: new Date().toISOString()
                });
                
                if (result.action === 'quit') {
                    break;
                }
                
                // Add delay between interactive fixes
                if (config.delayBetweenRequests > 0) {
                    await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
                }
            }
            
            // Also handle null language mismatches if any
            if (nullLanguageMismatches.length > 0 && options.handleNullLanguages) {
                console.log(`\n🗑️  Processing ${nullLanguageMismatches.length} undetectable language captions...`);
                
                for (const mismatch of nullLanguageMismatches) {
                    console.log(`🗑️  Deleting undetectable caption: ${mismatch.videoTitle} (${mismatch.language})`);
                    const deleteResult = await deleteCaption(mismatch.videoId, mismatch.language);
                    
                    results.push({
                        mismatch,
                        result: deleteResult,
                        processedAt: new Date().toISOString()
                    });
                    
                    if (config.delayBetweenRequests > 0) {
                        await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
                    }
                }
            }
            
            // Save results
            const report = {
                summary: {
                    processedAt: new Date().toISOString(),
                    mode: 'interactive',
                    totalMismatches: mismatches.length + (options.handleNullLanguages ? nullLanguageMismatches.length : 0),
                    processed: results.length,
                    successful: results.filter(r => r.result.success).length,
                    skipped: results.filter(r => r.result.action === 'skipped').length,
                    errors: results.filter(r => !r.result.success && r.result.action !== 'skipped').length
                },
                results
            };
            
            fs.writeFileSync(config.outputFile, JSON.stringify(report, null, 2));
            console.log(`💾 Fixer report saved to: ${config.outputFile}`);
            
        } else {
            // Display only mode
            console.log(`\n📋 Preview Mode: Showing mismatches (use --batch-delete or --batch-move to fix)`);
            
            mismatches.forEach((mismatch, index) => {
                console.log(`\n${index + 1}. ${mismatch.videoTitle}`);
                console.log(`   📍 ${mismatch.language} slot contains ${mismatch.detectedLanguage} content`);
                console.log(`   📖 "${mismatch.firstWords}"`);
                console.log(`   🔗 ${mismatch.captionSrc}`);
            });
            
            console.log(`\n💡 To fix these mismatches:`);
            console.log(`   node captionLanguageFixer.js --batch-delete  (remove incorrect captions)`);
            console.log(`   node captionLanguageFixer.js --batch-move    (move to correct language slots)`);
            console.log(`   node captionLanguageFixer.js --interactive   (process one by one)`);
        }
        
        console.log(`\n🎉 Caption language fixer complete!`);
        
    } catch (error) {
        console.error('❌ Error in caption fixer process:', error.message);
        process.exit(1);
    }
}

// Execute if this file is run directly
if (require.main === module) {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const options = {};
    
    if (args.includes('--batch-delete')) {
        options.batchAction = 'delete';
        options.interactive = false;
    } else if (args.includes('--batch-move')) {
        options.batchAction = 'move';
        options.interactive = false;
    } else if (args.includes('--interactive')) {
        options.interactive = true;
    } else if (args.includes('--preview')) {
        options.interactive = false;
    }
    
    // Additional options
    if (args.includes('--handle-null-languages')) {
        options.handleNullLanguages = true;
    }
    
    if (args.includes('--overwrite-existing')) {
        options.overwriteExisting = true;
    }
    
    fixCaptionLanguages(options).catch(error => {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = {
    fixCaptionLanguages,
    processMismatch,
    processMismatchesBatch,
    deleteCaption,
    moveCaption,
    getVideoCaption
}; 