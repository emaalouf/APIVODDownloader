require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getAccessToken, getOutputFolder } = require('./auth.js');

/**
 * Fetches all videos from API.video with pagination support
 */
async function getAllVideos(accessToken) {
    const allVideos = [];
    let currentPage = 1;
    let totalPages = 1;
    
    const baseUrl = 'https://ws.api.video/videos';
    
    console.log('Fetching video list from API.video...');
    
    do {
        try {
            console.log(`Fetching page ${currentPage} of ${totalPages}...`);
            
            const response = await axios.get(`${baseUrl}?currentPage=${currentPage}&pageSize=25`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.data && response.data.data) {
                allVideos.push(...response.data.data);
                
                // Update pagination info
                if (response.data.pagination) {
                    totalPages = response.data.pagination.pagesTotal;
                    console.log(`Found ${response.data.data.length} videos on page ${currentPage}`);
                    console.log(`Total videos so far: ${allVideos.length}`);
                }
            }
            
            currentPage++;
            
        } catch (error) {
            console.error(`Error fetching page ${currentPage}:`, error.response?.data || error.message);
            throw error;
        }
        
    } while (currentPage <= totalPages);
    
    console.log(`\nTotal videos found: ${allVideos.length}`);
    return allVideos;
}

/**
 * Creates the output directory if it doesn't exist
 */
function ensureOutputDirectory() {
    const outputDir = getOutputFolder();
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
        console.log(`Created output directory: ${outputDir}`);
    }
    return outputDir;
}

/**
 * Sanitizes filename by removing/replacing invalid characters
 */
function sanitizeFilename(filename) {
    return filename
        .replace(/[<>:"/\\|?*]/g, '_')  // Replace invalid characters with underscore
        .replace(/\s+/g, '_')          // Replace spaces with underscore
        .trim();
}

/**
 * Extracts video ID from filename (for files already downloaded with video ID)
 */
function extractVideoIdFromFilename(filename) {
    const match = filename.match(/^\[([^\]]+)\]_/);
    return match ? match[1] : null;
}

/**
 * Downloads a single video file with video ID in filename
 */
async function downloadVideo(video, outputDir, index, total) {
    const { videoId, title, assets } = video;
    
    if (!assets || !assets.mp4) {
        console.log(`⚠️  No MP4 download URL for video: ${title} (${videoId})`);
        return false;
    }
    
    // Create filename with video ID: [videoId]_title.mp4
    const sanitizedTitle = sanitizeFilename(title || `video_${videoId}`);
    const filename = `[${videoId}]_${sanitizedTitle}.mp4`;
    const filepath = path.join(outputDir, filename);
    
    // Check if file already exists (with video ID format)
    if (fs.existsSync(filepath)) {
        console.log(`⏭️  Skipping ${index}/${total}: ${title} (already exists)`);
        return true;
    }
    
    // Also check for old format files (without video ID) and rename them
    const oldFilename = `${sanitizedTitle}.mp4`;
    const oldFilepath = path.join(outputDir, oldFilename);
    if (fs.existsSync(oldFilepath)) {
        console.log(`🔄 Renaming existing file to include video ID: ${oldFilename} -> ${filename}`);
        fs.renameSync(oldFilepath, filepath);
        return true;
    }
    
    try {
        console.log(`⬇️  Downloading ${index}/${total}: ${title}`);
        console.log(`    Video ID: ${videoId}`);
        console.log(`    Filename: ${filename}`);
        console.log(`    URL: ${assets.mp4}`);
        
        const response = await axios({
            method: 'GET',
            url: assets.mp4,
            responseType: 'stream',
            timeout: 300000, // 5 minutes timeout
        });
        
        const writer = fs.createWriteStream(filepath);
        response.data.pipe(writer);
        
        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`✅ Downloaded: ${filename}`);
                resolve(true);
            });
            writer.on('error', (error) => {
                console.error(`❌ Error downloading ${filename}:`, error.message);
                // Clean up partial file
                if (fs.existsSync(filepath)) {
                    fs.unlinkSync(filepath);
                }
                reject(error);
            });
        });
        
    } catch (error) {
        console.error(`❌ Error downloading ${title}:`, error.message);
        return false;
    }
}

/**
 * Downloads all videos from the provided list
 */
async function downloadAllVideos(videos) {
    const outputDir = ensureOutputDirectory();
    console.log(`\nStarting download of ${videos.length} videos to: ${outputDir}\n`);
    
    let successCount = 0;
    let failureCount = 0;
    
    for (let i = 0; i < videos.length; i++) {
        const video = videos[i];
        try {
            const success = await downloadVideo(video, outputDir, i + 1, videos.length);
            if (success) {
                successCount++;
            } else {
                failureCount++;
            }
        } catch (error) {
            failureCount++;
        }
        
        // Add a small delay between downloads to be respectful to the server
        if (i < videos.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    console.log(`\n📊 Download Summary:`);
    console.log(`✅ Successful downloads: ${successCount}`);
    console.log(`❌ Failed downloads: ${failureCount}`);
    console.log(`📁 Output directory: ${outputDir}`);
    console.log(`\n💡 Note: Files are named as [videoId]_title.mp4 for easy caption reuploading`);
}

/**
 * Main function to authenticate and download all videos
 */
async function main() {
    try {
        // Get access token
        console.log('🔑 Getting access token...');
        const tokenData = await getAccessToken();
        const accessToken = tokenData.access_token;
        
        // Fetch all videos
        console.log('\n📹 Fetching all videos...');
        const videos = await getAllVideos(accessToken);
        
        if (videos.length === 0) {
            console.log('No videos found in your API.video account.');
            return;
        }
        
        // Download all videos
        await downloadAllVideos(videos);
        
        console.log('\n🎉 Download process completed!');
        
    } catch (error) {
        console.error('❌ Error in main process:', error.message);
        process.exit(1);
    }
}

// Execute if this file is run directly
if (require.main === module) {
    main();
}

module.exports = { getAllVideos, downloadAllVideos, downloadVideo, main, extractVideoIdFromFilename }; 