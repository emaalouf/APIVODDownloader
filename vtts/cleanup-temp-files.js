#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const config = {
    vttOutputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles'
};

/**
 * Cleanup script to remove temporary WAV files left behind from failed/interrupted VTT generation
 */
function cleanupTempFiles() {
    console.log('🧹 Starting cleanup of temporary files...');
    console.log(`📂 Checking directory: ${config.vttOutputFolder}`);
    
    if (!fs.existsSync(config.vttOutputFolder)) {
        console.log(`❌ Directory not found: ${config.vttOutputFolder}`);
        return;
    }
    
    const files = fs.readdirSync(config.vttOutputFolder);
    const tempWavFiles = files.filter(file => file.endsWith('_temp.wav'));
    const vttFiles = files.filter(file => file.endsWith('.vtt'));
    
    console.log(`📊 Found ${tempWavFiles.length} temporary WAV files`);
    console.log(`📊 Found ${vttFiles.length} VTT files`);
    
    if (tempWavFiles.length === 0) {
        console.log('✅ No temporary files to clean up!');
        return;
    }
    
    console.log('\n🗑️  Removing temporary WAV files:');
    let cleanedCount = 0;
    
    tempWavFiles.forEach(file => {
        const filePath = path.join(config.vttOutputFolder, file);
        try {
            fs.unlinkSync(filePath);
            console.log(`   ✅ Deleted: ${file}`);
            cleanedCount++;
        } catch (error) {
            console.log(`   ❌ Failed to delete ${file}: ${error.message}`);
        }
    });
    
    console.log(`\n📊 Cleanup Summary:`);
    console.log(`🗑️  Files removed: ${cleanedCount}`);
    console.log(`📄 VTT files remaining: ${vttFiles.length}`);
    console.log('✨ Cleanup completed!');
    
    // Show some statistics
    if (vttFiles.length > 0) {
        const videoIdFiles = vttFiles.filter(file => file.startsWith('['));
        const regularFiles = vttFiles.filter(file => !file.startsWith('['));
        
        console.log(`\n📈 VTT File Statistics:`);
        console.log(`   📋 Files with video IDs: ${videoIdFiles.length}`);
        console.log(`   📋 Regular files: ${regularFiles.length}`);
        
        if (videoIdFiles.length > 0) {
            console.log(`💡 Files with [videoId] are ready for caption upload!`);
        }
    }
}

if (require.main === module) {
    cleanupTempFiles();
}

module.exports = { cleanupTempFiles }; 