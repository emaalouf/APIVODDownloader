#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ApiVideoClient = require('@api.video/nodejs-client');

// Configuration from environment variables
const config = {
    vttOutputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles',
    apiVideoApiKey: process.env.APIVIDEO_API_KEY,
    apiVideoEnvironment: process.env.API_VIDEO_ENVIRONMENT || 'production', // 'sandbox' or 'production'
    captionLanguages: (process.env.CAPTION_LANGUAGES || 'ar,en,fr,es,it').split(','),
    dryRun: process.env.DRY_RUN === 'true', // Set to true to see what would happen without actually uploading
    testMode: process.env.TEST_MODE === 'true' // Set to true to run analysis without API connection
};

// Language mapping for API.video caption codes
const languageMapping = {
    'ar': { name: 'Arabic', apiVideoCode: 'ar', nativeName: 'العربية' },
    'en': { name: 'English', apiVideoCode: 'en', nativeName: 'English' },
    'fr': { name: 'French', apiVideoCode: 'fr', nativeName: 'Français' },
    'es': { name: 'Spanish', apiVideoCode: 'es', nativeName: 'Español' },
    'it': { name: 'Italian', apiVideoCode: 'it', nativeName: 'Italiano' }
};

// Initialize API.video client
let client = null;
if (config.testMode) {
    console.log('🔍 Running in TEST MODE - no API connection required');
} else if (config.apiVideoApiKey) {
    client = new ApiVideoClient({
        apiKey: config.apiVideoApiKey,
        environment: config.apiVideoEnvironment
    });
} else {
    console.error('❌ APIVIDEO_API_KEY not found in environment variables');
    console.log('💡 To run analysis only, set TEST_MODE=true');
    process.exit(1);
}

/**
 * Parse VTT filename to extract video ID, title, and language
 */
function parseVttFilename(filename) {
    // Pattern: [videoId]_title.vtt or [videoId]_title_lang.vtt
    const match = filename.match(/^\[([^\]]+)\]_(.+?)(?:_([a-z]{2}))?\.vtt$/);
    
    if (match) {
        const [, videoId, title, language] = match;
        return {
            videoId,
            title,
            language: language || 'original',
            filename,
            hasLanguageCode: !!language,
            isMultiLanguage: !!language
        };
    }
    
    return null;
}

/**
 * Get all VTT files grouped by video ID
 */
function getVttFilesByVideoId() {
    console.log(`📂 Scanning VTT files in: ${config.vttOutputFolder}`);
    
    if (!fs.existsSync(config.vttOutputFolder)) {
        console.error(`❌ VTT directory not found: ${config.vttOutputFolder}`);
        return {};
    }
    
    const files = fs.readdirSync(config.vttOutputFolder);
    const vttFiles = files.filter(file => file.toLowerCase().endsWith('.vtt'));
    const tempWavFiles = files.filter(file => file.endsWith('_temp.wav'));
    
    console.log(`📄 Found ${vttFiles.length} VTT files`);
    if (tempWavFiles.length > 0) {
        console.log(`⚠️  Found ${tempWavFiles.length} temporary WAV files (will be ignored)`);
    }
    
    const videoGroups = {};
    
    vttFiles.forEach(filename => {
        const parsed = parseVttFilename(filename);
        if (parsed) {
            const { videoId } = parsed;
            
            if (!videoGroups[videoId]) {
                videoGroups[videoId] = {
                    videoId,
                    title: parsed.title,
                    vttFiles: []
                };
            }
            
            videoGroups[videoId].vttFiles.push(parsed);
        } else {
            console.log(`⚠️  Skipping invalid filename format: ${filename}`);
        }
    });
    
    return videoGroups;
}

/**
 * Get existing captions for a video from API.video
 */
async function getExistingCaptions(videoId) {
    // In test mode, return empty array to simulate no existing captions
    if (config.testMode || !client) {
        console.log(`🔍 TEST MODE: Simulating no existing captions for ${videoId}`);
        return [];
    }
    
    try {
        // Try different approaches for the list method
        let captionsResponse;
        
        // Approach 1: Simple call
        try {
            captionsResponse = await client.captions.list(videoId);
        } catch (firstError) {
            console.log(`🔍 First approach failed: ${firstError.message}`);
            
            // Approach 2: With query parameters object
            try {
                captionsResponse = await client.captions.list(videoId, {});
            } catch (secondError) {
                console.log(`🔍 Second approach failed: ${secondError.message}`);
                
                // Approach 3: Using object parameter
                captionsResponse = await client.captions.list({ videoId: videoId });
            }
        }
        
        return captionsResponse.data || [];
    } catch (error) {
        if (error.status === 404) {
            console.log(`⚠️  Video ${videoId} not found on API.video`);
            return null;
        }
        console.error(`❌ Error fetching captions for ${videoId}:`, error.message);
        return [];
    }
}

/**
 * Upload a new caption file
 */
async function uploadCaption(videoId, vttFilePath, language, isDefault = false) {
    const filePath = path.join(config.vttOutputFolder, vttFilePath);
    
    if (!fs.existsSync(filePath)) {
        console.error(`❌ VTT file not found: ${filePath}`);
        return false;
    }
    
    try {
        console.log(`📤 Uploading ${language} caption for video ${videoId}...`);
        
        if (config.dryRun || config.testMode || !client) {
            const mode = config.testMode ? 'TEST MODE' : 'DRY RUN';
            console.log(`🔍 ${mode}: Would upload ${filePath} as ${language} caption${isDefault ? ' (default)' : ''}`);
            return true;
        }
        
        // Try different approaches for the upload method
        let result;
        
        // Read the file as a buffer
        const fileBuffer = fs.readFileSync(filePath);
        
        // Approach 1: Pass file path
        try {
            result = await client.captions.upload(videoId, language, filePath);
        } catch (firstError) {
            console.log(`🔍 Upload approach 1 failed: ${firstError.message}`);
            
            // Approach 2: Pass file buffer
            try {
                result = await client.captions.upload(videoId, language, fileBuffer);
            } catch (secondError) {
                console.log(`🔍 Upload approach 2 failed: ${secondError.message}`);
                
                // Approach 3: Using file stream
                const fs_stream = require('fs');
                const fileStream = fs_stream.createReadStream(filePath);
                result = await client.captions.upload(videoId, language, fileStream);
            }
        }
        
        // If this should be the default caption, update it after upload
        if (isDefault) {
            try {
                await client.captions.update(videoId, language, { default: true });
                console.log(`✅ Set ${language} as default caption for video ${videoId}`);
            } catch (updateError) {
                console.error(`⚠️  Uploaded ${language} caption but failed to set as default: ${updateError.message}`);
            }
        }
        
        console.log(`✅ Successfully uploaded ${language} caption for video ${videoId}`);
        return true;
        
    } catch (error) {
        console.error(`❌ Failed to upload ${language} caption for video ${videoId}:`, error.message);
        return false;
    }
}

/**
 * Update an existing caption file
 */
async function updateCaption(videoId, vttFilePath, language) {
    const filePath = path.join(config.vttOutputFolder, vttFilePath);
    
    if (!fs.existsSync(filePath)) {
        console.error(`❌ VTT file not found: ${filePath}`);
        return false;
    }
    
    try {
        console.log(`🔄 Updating ${language} caption for video ${videoId}...`);
        
        if (config.dryRun || config.testMode || !client) {
            const mode = config.testMode ? 'TEST MODE' : 'DRY RUN';
            console.log(`🔍 ${mode}: Would update ${filePath} as ${language} caption`);
            return true;
        }
        
        // For updating captions, we need to delete the old one and upload the new one
        // because the API.video client doesn't have a direct file update method
        try {
            await client.captions.delete(videoId, language);
            console.log(`🗑️  Deleted existing ${language} caption for video ${videoId}`);
        } catch (deleteError) {
            console.log(`⚠️  Could not delete existing ${language} caption (may not exist): ${deleteError.message}`);
        }
        
        // Now upload the new caption using the upload function
        const success = await uploadCaption(videoId, vttFilePath, language, false);
        
        if (success) {
            console.log(`✅ Successfully updated ${language} caption for video ${videoId}`);
            return true;
        } else {
            throw new Error('Upload failed during update');
        }
        
    } catch (error) {
        console.error(`❌ Failed to update ${language} caption for video ${videoId}:`, error.message);
        return false;
    }
}

/**
 * Process captions for a single video
 */
async function processVideoCaption(videoData) {
    const { videoId, title, vttFiles } = videoData;
    
    console.log(`\n🎬 Processing video: ${videoId} (${title})`);
    console.log(`📄 Found ${vttFiles.length} VTT files for this video`);
    
    // Get existing captions from API.video
    const existingCaptions = await getExistingCaptions(videoId);
    
    if (existingCaptions === null) {
        console.log(`⚠️  Skipping video ${videoId} - not found on API.video`);
        return {
            videoId,
            skipped: true,
            reason: 'Video not found'
        };
    }
    
    const existingLanguages = existingCaptions.map(cap => cap.srclang);
    console.log(`📋 Existing captions: ${existingLanguages.length > 0 ? existingLanguages.join(', ') : 'None'}`);
    
    const results = {
        videoId,
        title,
        uploaded: 0,
        updated: 0,
        failed: 0,
        details: []
    };
    
    // Determine if we should set a default language
    const hasDefault = existingCaptions.some(cap => cap.default);
    let shouldSetDefault = !hasDefault;
    
    // Process each VTT file
    for (const vttFile of vttFiles) {
        const { language, filename, isMultiLanguage } = vttFile;
        
        // Skip original language files if they don't have a specific language code
        if (!isMultiLanguage && language === 'original') {
            console.log(`⚠️  Skipping ${filename} - no language code specified`);
            continue;
        }
        
        // Check if this language is in our supported list
        if (isMultiLanguage && !config.captionLanguages.includes(language)) {
            console.log(`⚠️  Skipping ${filename} - language ${language} not in supported list`);
            continue;
        }
        
        const languageCode = isMultiLanguage ? language : 'en'; // Default to English for original files
        const languageName = languageMapping[languageCode]?.name || languageCode;
        
        // Check if caption already exists
        const existingCaption = existingCaptions.find(cap => cap.srclang === languageCode);
        
        if (existingCaption) {
            // Update existing caption
            const success = await updateCaption(videoId, filename, languageCode);
            if (success) {
                results.updated++;
                results.details.push(`Updated ${languageName}`);
            } else {
                results.failed++;
                results.details.push(`Failed to update ${languageName}`);
            }
        } else {
            // Upload new caption
            const isDefault = shouldSetDefault && languageCode === 'en';
            if (isDefault) shouldSetDefault = false; // Only set first one as default
            
            const success = await uploadCaption(videoId, filename, languageCode, isDefault);
            if (success) {
                results.uploaded++;
                results.details.push(`Uploaded ${languageName}${isDefault ? ' (default)' : ''}`);
            } else {
                results.failed++;
                results.details.push(`Failed to upload ${languageName}`);
            }
        }
        
        // Add delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return results;
}

/**
 * Clean up temporary WAV files
 */
function cleanupTempFiles() {
    if (!fs.existsSync(config.vttOutputFolder)) return;
    
    const files = fs.readdirSync(config.vttOutputFolder);
    const tempWavFiles = files.filter(file => file.endsWith('_temp.wav'));
    
    if (tempWavFiles.length > 0) {
        console.log(`\n🧹 Cleaning up ${tempWavFiles.length} temporary WAV files...`);
        
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
        
        console.log(`✨ Cleanup completed: ${cleanedCount} files removed`);
    }
}

/**
 * Main function
 */
async function smartCaptionUpload() {
    try {
        console.log('🚀 Starting Smart Caption Upload to API.video...');
        console.log(`🌐 Environment: ${config.apiVideoEnvironment}`);
        console.log(`🎯 Target languages: ${config.captionLanguages.join(', ')}`);
        console.log(`📂 VTT source: ${config.vttOutputFolder}`);
        
        if (config.dryRun) {
            console.log(`🔍 DRY RUN MODE: No actual uploads will be performed`);
        }
        
        console.log('─'.repeat(60));
        
        // Clean up temp files first
        cleanupTempFiles();
        
        // Get all VTT files grouped by video ID
        const videoGroups = getVttFilesByVideoId();
        const videoIds = Object.keys(videoGroups);
        
        if (videoIds.length === 0) {
            console.log('📭 No videos with VTT files found');
            return;
        }
        
        console.log(`\n🎬 Found ${videoIds.length} videos with VTT files`);
        console.log('─'.repeat(60));
        
        const summary = {
            totalVideos: videoIds.length,
            processedVideos: 0,
            skippedVideos: 0,
            totalUploaded: 0,
            totalUpdated: 0,
            totalFailed: 0
        };
        
        // Process each video
        for (let i = 0; i < videoIds.length; i++) {
            const videoId = videoIds[i];
            const videoData = videoGroups[videoId];
            
            console.log(`\n📊 Progress: ${i + 1}/${videoIds.length}`);
            
            const result = await processVideoCaption(videoData);
            
            if (result.skipped) {
                summary.skippedVideos++;
                console.log(`⚠️  Skipped: ${result.reason}`);
            } else {
                summary.processedVideos++;
                summary.totalUploaded += result.uploaded;
                summary.totalUpdated += result.updated;
                summary.totalFailed += result.failed;
                
                console.log(`📈 Results: ${result.details.join(', ')}`);
            }
            
            // Add delay between videos to avoid rate limiting
            if (i < videoIds.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        // Final summary
        console.log('\n' + '='.repeat(60));
        console.log('📊 Smart Caption Upload Summary:');
        console.log('='.repeat(60));
        console.log(`🎬 Total videos found: ${summary.totalVideos}`);
        console.log(`✅ Videos processed: ${summary.processedVideos}`);
        console.log(`⚠️  Videos skipped: ${summary.skippedVideos}`);
        console.log(`📤 New captions uploaded: ${summary.totalUploaded}`);
        console.log(`🔄 Existing captions updated: ${summary.totalUpdated}`);
        console.log(`❌ Failed operations: ${summary.totalFailed}`);
        
        const totalOperations = summary.totalUploaded + summary.totalUpdated;
        console.log(`\n🎉 Successfully completed ${totalOperations} caption operations!`);
        
        if (config.dryRun) {
            console.log(`\n💡 This was a DRY RUN. Set DRY_RUN=false to perform actual uploads.`);
        }
        
    } catch (error) {
        console.error('❌ Error in smart caption upload:', error.message);
        process.exit(1);
    }
}

// Execute if this file is run directly
if (require.main === module) {
    smartCaptionUpload();
}

module.exports = { 
    smartCaptionUpload, 
    parseVttFilename, 
    getVttFilesByVideoId,
    config 
}; 