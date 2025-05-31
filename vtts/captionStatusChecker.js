require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getAccessToken } = require('../auth.js');
const { parseVideoIdFromVttFilename } = require('./captionManager.js');

// Configuration from environment variables
const config = {
    vttOutputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles',
    apiBaseUrl: 'https://ws.api.video'
};

// Expected languages for complete caption sets
const EXPECTED_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'ar', name: 'العربية' },
    { code: 'fr', name: 'Français' },
    { code: 'es', name: 'Español' },
    { code: 'it', name: 'Italiano' }
];

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
 * Analyzes caption completeness for a video
 */
function analyzeCaptionCompleteness(captions) {
    const availableLanguages = captions.map(caption => ({
        code: caption.srclang,
        name: caption.languageName,
        src: caption.src,
        default: caption.default
    }));
    
    const availableCodes = availableLanguages.map(lang => lang.code);
    const missingLanguages = EXPECTED_LANGUAGES.filter(
        expectedLang => !availableCodes.includes(expectedLang.code)
    );
    
    return {
        total: captions.length,
        available: availableLanguages,
        missing: missingLanguages,
        isComplete: missingLanguages.length === 0,
        completionPercentage: Math.round((availableLanguages.length / EXPECTED_LANGUAGES.length) * 100)
    };
}

/**
 * Checks caption status for a single video
 */
async function checkVideoStatus(videoId, accessToken) {
    console.log(`🎬 Checking video: ${videoId}`);
    
    const captionsResult = await getVideoCaptions(videoId, accessToken);
    
    if (!captionsResult.success) {
        console.log(`   ❌ Failed to get captions: ${captionsResult.error}`);
        return {
            videoId,
            success: false,
            error: captionsResult.error
        };
    }
    
    const analysis = analyzeCaptionCompleteness(captionsResult.captions);
    
    // Display results for this video
    console.log(`   📊 Languages: ${analysis.total}/${EXPECTED_LANGUAGES.length} (${analysis.completionPercentage}%)`);
    
    if (analysis.isComplete) {
        console.log(`   ✅ Complete - All languages available`);
    } else {
        console.log(`   ⚠️  Missing: ${analysis.missing.map(lang => lang.code).join(', ')}`);
    }
    
    // List available languages
    console.log(`   🌍 Available:`);
    analysis.available.forEach(lang => {
        const defaultMark = lang.default ? ' (default)' : '';
        console.log(`      • ${lang.code} - ${lang.name}${defaultMark}`);
    });
    
    if (analysis.missing.length > 0) {
        console.log(`   🚫 Missing:`);
        analysis.missing.forEach(lang => {
            console.log(`      • ${lang.code} - ${lang.name}`);
        });
    }
    
    return {
        videoId,
        success: true,
        analysis
    };
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
 * Checks caption status for all videos
 */
async function checkAllVideosStatus() {
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
        
        console.log(`\n📊 Caption Status Overview:`);
        console.log(`🎬 Videos to check: ${videoIds.length}`);
        console.log(`🌍 Expected languages: ${EXPECTED_LANGUAGES.length} (${EXPECTED_LANGUAGES.map(l => l.code).join(', ')})`);
        console.log(`\n${'='.repeat(80)}`);
        
        const results = [];
        let completeVideos = 0;
        let incompleteVideos = 0;
        let failedChecks = 0;
        
        for (let i = 0; i < videoIds.length; i++) {
            const videoId = videoIds[i];
            
            console.log(`\n📹 ${i + 1}/${videoIds.length}: ${videoId}`);
            
            const result = await checkVideoStatus(videoId, accessToken);
            results.push(result);
            
            if (result.success) {
                if (result.analysis.isComplete) {
                    completeVideos++;
                } else {
                    incompleteVideos++;
                }
            } else {
                failedChecks++;
            }
            
            // Add delay between API calls
            if (i < videoIds.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📊 FINAL SUMMARY`);
        console.log(`${'='.repeat(80)}`);
        
        console.log(`\n🎯 Overall Statistics:`);
        console.log(`   📹 Total videos checked: ${videoIds.length}`);
        console.log(`   ✅ Complete videos (all ${EXPECTED_LANGUAGES.length} languages): ${completeVideos}`);
        console.log(`   ⚠️  Incomplete videos: ${incompleteVideos}`);
        console.log(`   ❌ Failed checks: ${failedChecks}`);
        console.log(`   📈 Completion rate: ${Math.round((completeVideos / videoIds.length) * 100)}%`);
        
        // Detailed breakdown by completion status
        if (completeVideos > 0) {
            console.log(`\n✅ COMPLETE VIDEOS (${completeVideos}):`);
            results
                .filter(r => r.success && r.analysis.isComplete)
                .forEach(result => {
                    console.log(`   🎬 ${result.videoId} - All ${result.analysis.total} languages`);
                });
        }
        
        if (incompleteVideos > 0) {
            console.log(`\n⚠️  INCOMPLETE VIDEOS (${incompleteVideos}):`);
            results
                .filter(r => r.success && !r.analysis.isComplete)
                .forEach(result => {
                    const missing = result.analysis.missing.map(lang => lang.code).join(', ');
                    console.log(`   🎬 ${result.videoId} - ${result.analysis.total}/${EXPECTED_LANGUAGES.length} languages (Missing: ${missing})`);
                });
        }
        
        if (failedChecks > 0) {
            console.log(`\n❌ FAILED CHECKS (${failedChecks}):`);
            results
                .filter(r => !r.success)
                .forEach(result => {
                    console.log(`   🎬 ${result.videoId} - Error: ${result.error}`);
                });
        }
        
        // Language-specific summary
        console.log(`\n🌍 LANGUAGE AVAILABILITY SUMMARY:`);
        const languageStats = {};
        
        EXPECTED_LANGUAGES.forEach(expectedLang => {
            const availableCount = results
                .filter(r => r.success)
                .filter(r => r.analysis.available.some(avail => avail.code === expectedLang.code))
                .length;
            
            languageStats[expectedLang.code] = {
                name: expectedLang.name,
                available: availableCount,
                missing: results.filter(r => r.success).length - availableCount,
                percentage: Math.round((availableCount / results.filter(r => r.success).length) * 100)
            };
        });
        
        Object.entries(languageStats).forEach(([code, stats]) => {
            const indicator = stats.percentage === 100 ? '✅' : stats.percentage >= 80 ? '🟡' : '❌';
            console.log(`   ${indicator} ${code} (${stats.name}): ${stats.available}/${results.filter(r => r.success).length} videos (${stats.percentage}%)`);
        });
        
        if (completeVideos === videoIds.length) {
            console.log(`\n🎉 CONGRATULATIONS! All videos have complete caption sets! 🎉`);
        } else {
            console.log(`\n💡 NEXT STEPS:`);
            console.log(`   • Review incomplete videos above`);
            console.log(`   • Use captionManager.js to upload missing captions`);
            console.log(`   • Run this checker again to verify completion`);
        }
        
    } catch (error) {
        console.error('❌ Error in caption status check process:', error.message);
        process.exit(1);
    }
}

/**
 * Checks caption status for a specific video
 */
async function checkSingleVideoStatus(videoId) {
    try {
        // Get access token
        console.log('🔑 Getting access token...');
        const tokenData = await getAccessToken();
        const accessToken = tokenData.access_token;
        
        console.log(`\n🎬 Checking caption status for video: ${videoId}`);
        console.log(`🌍 Expected languages: ${EXPECTED_LANGUAGES.map(l => `${l.code} (${l.name})`).join(', ')}`);
        console.log(`${'='.repeat(80)}`);
        
        const result = await checkVideoStatus(videoId, accessToken);
        
        console.log(`\n${'='.repeat(80)}`);
        
        if (result.success) {
            if (result.analysis.isComplete) {
                console.log(`🎉 Video ${videoId} has complete caption set!`);
                console.log(`✅ All ${EXPECTED_LANGUAGES.length} languages are available`);
            } else {
                console.log(`⚠️  Video ${videoId} is missing some captions`);
                console.log(`📊 Status: ${result.analysis.total}/${EXPECTED_LANGUAGES.length} languages (${result.analysis.completionPercentage}%)`);
                console.log(`🚫 Missing: ${result.analysis.missing.map(lang => `${lang.code} (${lang.name})`).join(', ')}`);
            }
            return result.analysis.isComplete;
        } else {
            console.error(`❌ Failed to check video ${videoId}: ${result.error}`);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Error checking single video:', error.message);
        return false;
    }
}

// Execute if this file is run directly
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        // Check all videos
        console.log('🚀 Checking caption status for all videos...');
        await checkAllVideosStatus();
    } else if (args.length === 1) {
        // Check specific video
        const videoId = args[0];
        console.log(`🚀 Checking caption status for video: ${videoId}`);
        await checkSingleVideoStatus(videoId);
    } else {
        console.log(`
📖 Usage:
   
   Check all videos:
   node captionStatusChecker.js
   
   Check specific video:
   node captionStatusChecker.js <videoId>
   
   Examples:
   node captionStatusChecker.js
   node captionStatusChecker.js vi2Y2FFzw8IVMZ8hXyKTBmcJ
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
    analyzeCaptionCompleteness,
    checkVideoStatus,
    checkAllVideosStatus,
    checkSingleVideoStatus,
    getVideoIdsFromVttFiles,
    EXPECTED_LANGUAGES
}; 