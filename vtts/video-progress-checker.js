#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const config = {
    outputFolder: process.env.OUTPUT_FOLDER || './downloads',
    vttOutputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles',
    captionLanguages: (process.env.CAPTION_LANGUAGES || 'ar,en,fr,es,it').split(',')
};

/**
 * Extracts video information from filename
 */
function parseVideoFilename(filename) {
    // Check for new format: [videoId]_title.mp4
    const videoIdMatch = filename.match(/^\[([^\]]+)\]_(.+)\.mp4$/);
    if (videoIdMatch) {
        return { 
            videoId: videoIdMatch[1], 
            title: videoIdMatch[2], 
            hasVideoId: true,
            filename: filename
        };
    } else {
        // Old format: title.mp4
        const titlePart = filename.replace(/\.mp4$/, '');
        return { 
            videoId: null, 
            title: titlePart, 
            hasVideoId: false,
            filename: filename
        };
    }
}

/**
 * Finds VTT files for a video
 */
function findVttFilesForVideo(videoInfo, vttFiles) {
    const foundVtts = [];
    
    for (const vttFile of vttFiles) {
        if (videoInfo.hasVideoId) {
            // Look for pattern: [videoId]_title_lang.vtt
            const pattern = new RegExp(`^\\[${videoInfo.videoId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]_.*_([a-z]{2})\\.vtt$`);
            const match = vttFile.match(pattern);
            if (match) {
                foundVtts.push({
                    filename: vttFile,
                    language: match[1],
                    format: 'multi-language'
                });
            }
        } else {
            // Look for pattern: title_lang.vtt or title.vtt
            const titleEscaped = videoInfo.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            
            // Multi-language format: title_lang.vtt
            const multiLangPattern = new RegExp(`^${titleEscaped}_([a-z]{2})\\.vtt$`);
            const multiLangMatch = vttFile.match(multiLangPattern);
            if (multiLangMatch) {
                foundVtts.push({
                    filename: vttFile,
                    language: multiLangMatch[1],
                    format: 'multi-language'
                });
            }
            
            // Original format: title.vtt
            const originalPattern = new RegExp(`^${titleEscaped}\\.vtt$`);
            if (vttFile.match(originalPattern)) {
                foundVtts.push({
                    filename: vttFile,
                    language: 'original',
                    format: 'original'
                });
            }
        }
    }
    
    return foundVtts;
}

/**
 * Main function to check video processing progress
 */
function checkVideoProgress() {
    console.log('📊 Checking Video Processing Progress...');
    console.log(`📂 Videos source: ${config.outputFolder}`);
    console.log(`📂 VTT destination: ${config.vttOutputFolder}`);
    console.log(`🌐 Target languages: ${config.captionLanguages.join(', ')}`);
    console.log('─'.repeat(50));
    
    // Check if directories exist
    if (!fs.existsSync(config.outputFolder)) {
        console.error(`❌ Videos directory not found: ${config.outputFolder}`);
        return;
    }
    
    if (!fs.existsSync(config.vttOutputFolder)) {
        console.error(`❌ VTT directory not found: ${config.vttOutputFolder}`);
        return;
    }
    
    // Get all MP4 files
    const videoFiles = fs.readdirSync(config.outputFolder)
        .filter(file => file.toLowerCase().endsWith('.mp4'))
        .sort();
    
    // Get all VTT files
    const vttFiles = fs.readdirSync(config.vttOutputFolder)
        .filter(file => file.toLowerCase().endsWith('.vtt'))
        .sort();
    
    console.log(`🎬 Total videos found: ${videoFiles.length}`);
    console.log(`📄 Total VTT files found: ${vttFiles.length}`);
    console.log('─'.repeat(50));
    
    if (videoFiles.length === 0) {
        console.log('📭 No video files found!');
        return;
    }
    
    const processedVideos = [];
    const partiallyProcessedVideos = [];
    const unprocessedVideos = [];
    
    // Analyze each video
    videoFiles.forEach(videoFile => {
        const videoInfo = parseVideoFilename(videoFile);
        const foundVtts = findVttFilesForVideo(videoInfo, vttFiles);
        
        const analysis = {
            videoInfo,
            vttFiles: foundVtts,
            status: 'unprocessed'
        };
        
        if (foundVtts.length === 0) {
            analysis.status = 'unprocessed';
            unprocessedVideos.push(analysis);
        } else if (videoInfo.hasVideoId) {
            // For videos with IDs, expect multi-language VTTs
            const expectedLanguages = config.captionLanguages.length;
            const foundLanguages = foundVtts.length;
            
            if (foundLanguages >= expectedLanguages) {
                analysis.status = 'fully-processed';
                processedVideos.push(analysis);
            } else {
                analysis.status = 'partially-processed';
                partiallyProcessedVideos.push(analysis);
            }
        } else {
            // For videos without IDs, any VTT counts as processed
            analysis.status = 'processed';
            processedVideos.push(analysis);
        }
    });
    
    // Display results
    console.log(`📈 Processing Summary:`);
    console.log(`✅ Fully processed: ${processedVideos.length}`);
    console.log(`🔄 Partially processed: ${partiallyProcessedVideos.length}`);
    console.log(`❌ Unprocessed: ${unprocessedVideos.length}`);
    console.log(`📊 Progress: ${((processedVideos.length / videoFiles.length) * 100).toFixed(1)}%`);
    console.log('─'.repeat(50));
    
    // Show detailed breakdown
    if (processedVideos.length > 0) {
        console.log(`\n✅ Fully Processed Videos (${processedVideos.length}):`);
        processedVideos.forEach(video => {
            const languages = video.vttFiles.map(vtt => vtt.language).join(', ');
            console.log(`   📹 ${video.videoInfo.filename}`);
            console.log(`      🌐 Languages: ${languages} (${video.vttFiles.length} files)`);
        });
    }
    
    if (partiallyProcessedVideos.length > 0) {
        console.log(`\n🔄 Partially Processed Videos (${partiallyProcessedVideos.length}):`);
        partiallyProcessedVideos.forEach(video => {
            const languages = video.vttFiles.map(vtt => vtt.language).join(', ');
            const missing = config.captionLanguages.filter(lang => 
                !video.vttFiles.some(vtt => vtt.language === lang)
            );
            console.log(`   📹 ${video.videoInfo.filename}`);
            console.log(`      ✅ Has: ${languages} (${video.vttFiles.length} files)`);
            console.log(`      ❌ Missing: ${missing.join(', ')}`);
        });
    }
    
    if (unprocessedVideos.length > 0) {
        console.log(`\n❌ Unprocessed Videos (${unprocessedVideos.length}):`);
        unprocessedVideos.forEach(video => {
            console.log(`   📹 ${video.videoInfo.filename}`);
        });
    }
    
    // Show next steps
    console.log('\n💡 Next Steps:');
    if (unprocessedVideos.length > 0) {
        console.log(`   🔄 Run VTT generation for ${unprocessedVideos.length} remaining videos`);
        console.log(`   📝 Command: node parallelVttGenerator.js`);
    }
    if (partiallyProcessedVideos.length > 0) {
        console.log(`   🔄 Complete processing for ${partiallyProcessedVideos.length} partially processed videos`);
    }
    if (processedVideos.length === videoFiles.length) {
        console.log(`   🎉 All videos are fully processed!`);
        const withVideoIds = processedVideos.filter(v => v.videoInfo.hasVideoId).length;
        if (withVideoIds > 0) {
            console.log(`   📤 ${withVideoIds} videos are ready for caption upload`);
        }
    }
    
    // Storage statistics
    console.log('\n💾 Storage Information:');
    try {
        const videosDirSize = fs.readdirSync(config.outputFolder)
            .reduce((total, file) => {
                const filePath = path.join(config.outputFolder, file);
                if (fs.statSync(filePath).isFile()) {
                    return total + fs.statSync(filePath).size;
                }
                return total;
            }, 0);
        
        const vttDirSize = fs.readdirSync(config.vttOutputFolder)
            .reduce((total, file) => {
                const filePath = path.join(config.vttOutputFolder, file);
                if (fs.statSync(filePath).isFile()) {
                    return total + fs.statSync(filePath).size;
                }
                return total;
            }, 0);
        
        console.log(`   📁 Videos directory: ${(videosDirSize / (1024 * 1024)).toFixed(1)} MB`);
        console.log(`   📁 VTT directory: ${(vttDirSize / (1024 * 1024)).toFixed(1)} MB`);
    } catch (error) {
        console.log(`   ⚠️  Could not calculate directory sizes`);
    }
}

if (require.main === module) {
    checkVideoProgress();
}

module.exports = { checkVideoProgress, parseVideoFilename, findVttFilesForVideo }; 