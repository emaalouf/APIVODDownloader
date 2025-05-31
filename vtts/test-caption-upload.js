#!/usr/bin/env node

require('dotenv').config();
const { getVttFilesByVideoId, parseVttFilename, config } = require('./smart-caption-uploader.js');

/**
 * Test script to analyze VTT files and show what would be uploaded
 */
function testCaptionUpload() {
    console.log('🔍 Testing Smart Caption Upload - Analysis Mode');
    console.log(`📂 Scanning VTT files in: ${config.vttOutputFolder}`);
    console.log(`🎯 Target languages: ${config.captionLanguages.join(', ')}`);
    console.log('─'.repeat(60));
    
    // Get all VTT files grouped by video ID
    const videoGroups = getVttFilesByVideoId();
    const videoIds = Object.keys(videoGroups);
    
    if (videoIds.length === 0) {
        console.log('📭 No videos with VTT files found');
        return;
    }
    
    console.log(`\n🎬 Found ${videoIds.length} videos with VTT files`);
    
    let totalVttFiles = 0;
    const languageStats = {};
    const videoStats = [];
    
    // Analyze each video
    videoIds.forEach((videoId, index) => {
        const videoData = videoGroups[videoId];
        const { title, vttFiles } = videoData;
        
        console.log(`\n📹 ${index + 1}. Video ID: ${videoId}`);
        console.log(`   📝 Title: ${title}`);
        console.log(`   📄 VTT Files: ${vttFiles.length}`);
        
        const videoLanguages = [];
        
        vttFiles.forEach(vttFile => {
            const { language, filename, isMultiLanguage } = vttFile;
            totalVttFiles++;
            
            if (isMultiLanguage) {
                if (!languageStats[language]) {
                    languageStats[language] = 0;
                }
                languageStats[language]++;
                videoLanguages.push(language);
            } else {
                videoLanguages.push('original');
            }
            
            console.log(`      - ${filename} (${isMultiLanguage ? language : 'original'})`);
        });
        
        videoStats.push({
            videoId,
            title,
            languages: videoLanguages,
            fileCount: vttFiles.length
        });
    });
    
    // Summary statistics
    console.log('\n' + '='.repeat(60));
    console.log('📊 Analysis Summary:');
    console.log('='.repeat(60));
    console.log(`🎬 Total videos: ${videoIds.length}`);
    console.log(`📄 Total VTT files: ${totalVttFiles}`);
    console.log(`🌐 Language distribution:`);
    
    Object.keys(languageStats).sort().forEach(lang => {
        const count = languageStats[lang];
        const percentage = ((count / totalVttFiles) * 100).toFixed(1);
        console.log(`   ${lang}: ${count} files (${percentage}%)`);
    });
    
    // Videos with complete language sets
    const completeVideos = videoStats.filter(video => {
        const hasAllLanguages = config.captionLanguages.every(lang => 
            video.languages.includes(lang)
        );
        return hasAllLanguages;
    });
    
    console.log(`\n✅ Videos with complete language sets: ${completeVideos.length}/${videoIds.length}`);
    
    if (completeVideos.length < videoIds.length) {
        console.log(`⚠️  Videos missing some languages:`);
        videoStats.forEach(video => {
            const missingLanguages = config.captionLanguages.filter(lang => 
                !video.languages.includes(lang)
            );
            if (missingLanguages.length > 0) {
                console.log(`   📹 ${video.videoId}: Missing ${missingLanguages.join(', ')}`);
            }
        });
    }
    
    // Sample video IDs for testing
    console.log(`\n🔬 Sample Video IDs (first 5):`);
    videoIds.slice(0, 5).forEach((videoId, index) => {
        const video = videoGroups[videoId];
        console.log(`   ${index + 1}. ${videoId} (${video.vttFiles.length} files)`);
    });
    
    console.log(`\n💡 Next Steps:`);
    console.log(`   1. Test with one video: DRY_RUN=true node smart-caption-uploader.js`);
    console.log(`   2. Run full upload: node smart-caption-uploader.js`);
    console.log(`   3. Monitor progress and check API.video dashboard`);
    
    console.log(`\n⚙️  Configuration Check:`);
    console.log(`   📁 VTT Folder: ${config.vttOutputFolder}`);
    console.log(`   🔑 API Key: ${config.apiVideoApiKey ? '✅ Set' : '❌ Missing'}`);
    console.log(`   🌐 Environment: ${config.apiVideoEnvironment}`);
    console.log(`   🎯 Languages: ${config.captionLanguages.join(', ')}`);
}

if (require.main === module) {
    testCaptionUpload();
}

module.exports = { testCaptionUpload }; 