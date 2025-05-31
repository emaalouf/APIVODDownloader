require('dotenv').config();
const { makeAuthenticatedRequest } = require('../auth');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const FormData = require('form-data');

const API_BASE_URL = 'https://ws.api.video';
const REQUIRED_LANGUAGES = ['ar', 'en', 'fr', 'es', 'it'];
// IMPORTANT: This directory should contain your VTT subtitle files.
const CAPTIONS_DIR = path.resolve(process.env.CAPTIONS_DIR || './subtitles');

// This list should be populated with the actual filenames of your VTT files
// The script will try to parse videoId and language from these names.
// Alternatively, it can scan the CAPTIONS_DIR if vttFileNamesList is empty or not provided.
const vttFileNamesList = [
    // Add your VTT filenames here if you want to use a specific list
    // e.g., '[vi4ynvmEuSeid9CQMODBJnVJ]_Anxiety_03.mp4_ar.vtt',
    // If empty, the script will scan CAPTIONS_DIR.
];

const captionFileMap = {}; // Structure: { videoId: { lang: 'full_path_to_vtt' } }

/**
 * Parses VTT filenames to extract videoId and language code, building a map.
 * Filenames are expected in a format like: [videoId]_someText_lang.vtt or [videoId]_someText.mp4_lang.vtt
 */
async function buildCaptionFileMap() {
    console.log(`\nScanning for VTT files in: ${CAPTIONS_DIR}`);
    let filesToProcess = vttFileNamesList;

    if (!filesToProcess || filesToProcess.length === 0) {
        try {
            filesToProcess = await fsp.readdir(CAPTIONS_DIR);
            console.log(`Found ${filesToProcess.length} files in directory`);
        } catch (error) {
            console.error(`Error reading captions directory ${CAPTIONS_DIR}: ${error.message}`);
            console.error('Please ensure the CAPTIONS_DIR exists and is readable, or populate vttFileNamesList in the script.');
            return;
        }
    }

    const videoIdRegex = /\[(vi[a-zA-Z0-9]+)\]/; // Extracts videoId like 'vi...'
    const langCodeRegex = /_([a-z]{2})\.vtt$/i;    // Extracts lang like _ar, _en, _it from _xyz_lang.vtt

    let processedCount = 0;
    let skippedCount = 0;

    for (const fileName of filesToProcess) {
        // Skip non-VTT files
        if (!fileName.endsWith('.vtt')) {
            continue;
        }

        const videoIdMatch = fileName.match(videoIdRegex);
        const langMatch = fileName.match(langCodeRegex);

        if (videoIdMatch && videoIdMatch[1] && langMatch && langMatch[1]) {
            const videoId = videoIdMatch[1];
            const lang = langMatch[1].toLowerCase();
            if (!captionFileMap[videoId]) {
                captionFileMap[videoId] = {};
            }
            captionFileMap[videoId][lang] = path.join(CAPTIONS_DIR, fileName);
            console.log(`  ✓ Mapped: ${fileName} -> Video: ${videoId}, Language: ${lang}`);
            processedCount++;
        } else {
            console.warn(`  ✗ Could not parse: ${fileName} (videoId: ${videoIdMatch ? 'found' : 'missing'}, lang: ${langMatch ? 'found' : 'missing'})`);
            skippedCount++;
        }
    }
    
    console.log(`\nCaption file mapping complete:`);
    console.log(`  - Successfully mapped: ${processedCount} files`);
    console.log(`  - Skipped: ${skippedCount} files`);
    console.log(`  - Total videos with captions: ${Object.keys(captionFileMap).length}`);
    
    // Show a summary of what was mapped
    if (Object.keys(captionFileMap).length > 0) {
        console.log(`\nAvailable caption files by video:`);
        for (const [videoId, langs] of Object.entries(captionFileMap)) {
            console.log(`  ${videoId}: ${Object.keys(langs).join(', ')}`);
        }
    }
}

/**
 * Lists all videos from api.video
 */
async function listVideos() {
    try {
        console.log('Fetching list of videos...');
        const response = await makeAuthenticatedRequest({
            url: `${API_BASE_URL}/videos`,
            method: 'GET'
        });
        return response.data.data || []; // .data contains pagination, .data.data is the array of videos
    } catch (error) {
        console.error('Error fetching videos:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Gets existing captions for a video
 */
async function getVideoCaptions(videoId) {
    try {
        // console.log(`Fetching captions for video ID: ${videoId}`);
        const response = await makeAuthenticatedRequest({
            url: `${API_BASE_URL}/videos/${videoId}/captions`,
            method: 'GET'
        });
        return response.data.data || []; // .data contains pagination, .data.data is the array of captions
    } catch (error) {
        console.error(`Error fetching captions for video ${videoId}:`, error.response?.data || error.message);
        return []; // Return empty array on error to allow processing other videos
    }
}

/**
 * Uploads a VTT caption file for a specific video and language
 */
async function uploadCaption(videoId, languageCode, vttFilePath) {
    console.log(`Attempting to upload ${languageCode} caption for video ${videoId} from ${vttFilePath}`);
    
    const form = new FormData();
    form.append('file', fs.createReadStream(vttFilePath));

    try {
        await makeAuthenticatedRequest({
            url: `${API_BASE_URL}/videos/${videoId}/captions/${languageCode}`,
            method: 'POST',
            data: form,
            headers: {
                ...form.getHeaders() // Important for multipart/form-data
            }
        });
        console.log(`Successfully uploaded ${languageCode} caption for video ${videoId}`);
    } catch (error) {
        let errorMessage = error.message;
        if (error.response) {
            errorMessage = `Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`;
        }
        console.error(`Error uploading ${languageCode} caption for video ${videoId}:`, errorMessage);
        // If it's a 409 (Conflict, caption already exists), we can consider it a success for our logic.
        if (error.response?.status === 409) {
            console.warn(`Caption for ${languageCode} on video ${videoId} might already exist (409 Conflict).`);
        }
    }
}

/**
 * Main function to process videos and manage captions
 */
async function processVideos() {
    try {
        await buildCaptionFileMap();
        if (Object.keys(captionFileMap).length === 0 && vttFileNamesList.length === 0) {
            console.warn("Caption file map is empty and no specific VTT files listed. Ensure VTT files are in CAPTIONS_DIR and filenames are parsable, or populate 'vttFileNamesList'.");
        }
        
        const videos = await listVideos();
        if (!videos || videos.length === 0) {
            console.log("No videos found in your account.");
            return;
        }

        console.log(`Found ${videos.length} videos. Processing...`);

        for (const video of videos) {
            const videoId = video.videoId;
            const videoTitle = video.title || 'N/A';
            console.log(`\nProcessing video: "${videoTitle}" (ID: ${videoId})`);

            const existingCaptions = await getVideoCaptions(videoId);
            const existingLangs = existingCaptions
                .map(c => c.srclang ? c.srclang.toLowerCase() : null)
                .filter(lang => lang !== null);
            console.log(`Existing captions: ${existingLangs.length > 0 ? existingLangs.join(', ') : 'None'}`);

            for (const lang of REQUIRED_LANGUAGES) {
                if (!existingLangs.includes(lang)) {
                    console.log(`Missing caption for language: ${lang}`);
                    
                    const vttFilePath = captionFileMap[videoId]?.[lang];

                    if (vttFilePath) {
                        try {
                            await fsp.access(vttFilePath); // Check if file exists and is accessible
                            console.log(`Found local VTT file: ${vttFilePath}`);
                            await uploadCaption(videoId, lang, vttFilePath);
                        } catch (fileError) {
                            console.warn(`VTT file for ${videoId} language ${lang} at ${vttFilePath} not found or not accessible.`);
                        }
                    } else {
                        console.warn(`No VTT file mapped for video ${videoId}, language ${lang}.`);
                    }
                } else {
                    console.log(`Caption for ${lang} already exists.`);
                }
            }
        }
        console.log("\nCaption processing complete.");
    } catch (error) {
        console.error("\nAn error occurred during the main processing:", error.message);
    }
}

// Run the process
(async () => {
    try {
        // Validate CAPTIONS_DIR existence
        if (!fs.existsSync(CAPTIONS_DIR)) {
            console.warn(`CAPTIONS_DIR "${CAPTIONS_DIR}" does not exist.`);
            console.error("Please create this directory manually and place your VTT files inside.");
            console.error("Expected VTT filename format: [videoId]_title_lang.vtt");
            console.error("Example: [vi5XpFQ2RTW0S5W2ojpW3wIz]_Emotional_Mastery-16_ar.vtt");
            return; // Stop if directory doesn't exist
        }
        await processVideos();
    } catch (e) {
        console.error("Unhandled error in script execution:", e);
    }
})(); 