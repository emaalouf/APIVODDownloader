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
 * Quick status check - just the numbers
 */
function quickStatus() {
    // Check if directories exist
    if (!fs.existsSync(config.outputFolder)) {
        console.log('❌ Videos directory not found');
        return;
    }
    
    if (!fs.existsSync(config.vttOutputFolder)) {
        console.log('❌ VTT directory not found');
        return;
    }
    
    // Count files
    const videoFiles = fs.readdirSync(config.outputFolder)
        .filter(file => file.toLowerCase().endsWith('.mp4'));
    
    const vttFiles = fs.readdirSync(config.vttOutputFolder)
        .filter(file => file.toLowerCase().endsWith('.vtt'));
    
    // Quick analysis
    let processed = 0;
    let unprocessed = 0;
    
    videoFiles.forEach(videoFile => {
        // Simple check: does any VTT file contain the video name?
        const videoTitle = videoFile.replace(/^\[[^\]]+\]_/, '').replace(/\.mp4$/, '');
        const hasVtt = vttFiles.some(vttFile => 
            vttFile.includes(videoTitle) || 
            (videoFile.startsWith('[') && vttFiles.some(v => v.includes(videoFile.match(/^\[([^\]]+)\]/)[1])))
        );
        
        if (hasVtt) {
            processed++;
        } else {
            unprocessed++;
        }
    });
    
    const total = videoFiles.length;
    const percentage = total > 0 ? ((processed / total) * 100).toFixed(1) : 0;
    
    // Output
    console.log(`📊 Video Processing Status:`);
    console.log(`   🎬 Total videos: ${total}`);
    console.log(`   ✅ Processed: ${processed}`);
    console.log(`   ❌ Remaining: ${unprocessed}`);
    console.log(`   📈 Progress: ${percentage}%`);
    console.log(`   📄 VTT files: ${vttFiles.length}`);
    
    if (unprocessed > 0) {
        console.log(`\n🔄 Run: node parallelVttGenerator.js`);
    } else {
        console.log(`\n🎉 All done!`);
    }
}

if (require.main === module) {
    quickStatus();
}

module.exports = { quickStatus }; 