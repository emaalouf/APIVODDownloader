require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

// Configuration from environment variables
const config = {
    outputFolder: process.env.OUTPUT_FOLDER || './downloads',
    vttOutputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles',
    maxWorkers: parseInt(process.env.MAX_WORKERS) || Math.max(1, Math.floor(os.cpus().length * 0.8)),
    batchSize: parseInt(process.env.BATCH_SIZE) || 1, // Videos per worker batch
    workerTimeout: parseInt(process.env.WORKER_TIMEOUT) || 600000, // 10 minutes per video max
    retryFailedVideos: process.env.RETRY_FAILED_VIDEOS !== 'false'
};

/**
 * Worker thread function - processes a batch of videos
 */
async function workerFunction() {
    if (isMainThread) return;
    
    const { videoBatch, workerId } = workerData;
    const { generateMultiLanguageVttForVideo } = require('./multiLanguageVttGenerator.js');
    
    const results = [];
    
    for (const videoPath of videoBatch) {
        try {
            console.log(`🔄 Worker ${workerId}: Processing ${path.basename(videoPath)}`);
            const startTime = Date.now();
            
            const generatedFiles = await generateMultiLanguageVttForVideo(videoPath);
            
            const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`✅ Worker ${workerId}: Completed ${path.basename(videoPath)} in ${processingTime}s`);
            
            results.push({
                videoPath,
                success: true,
                generatedFiles,
                processingTime: parseFloat(processingTime),
                error: null
            });
            
        } catch (error) {
            console.error(`❌ Worker ${workerId}: Failed ${path.basename(videoPath)}: ${error.message}`);
            results.push({
                videoPath,
                success: false,
                generatedFiles: [],
                processingTime: 0,
                error: error.message
            });
        }
    }
    
    // Send results back to main thread
    parentPort.postMessage({
        workerId,
        results,
        completed: true
    });
}

/**
 * Splits array into chunks for parallel processing
 */
function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

/**
 * Creates and manages worker threads for parallel processing
 */
async function processVideosInParallel(videoFiles) {
    const startTime = Date.now();
    
    console.log(`🚀 Starting parallel processing with ${config.maxWorkers} workers`);
    console.log(`📦 Batch size: ${config.batchSize} videos per worker`);
    console.log(`🎬 Total videos: ${videoFiles.length}`);
    
    // Split videos into batches
    const videoBatches = chunkArray(videoFiles, config.batchSize);
    console.log(`📊 Created ${videoBatches.length} batches`);
    
    const allResults = [];
    const activeWorkers = new Map();
    let batchIndex = 0;
    let completedWorkers = 0;
    
    return new Promise((resolve, reject) => {
        
        // Function to start a new worker
        const startWorker = (workerId, batch) => {
            const worker = new Worker(__filename, {
                workerData: { videoBatch: batch, workerId }
            });
            
            const workerInfo = {
                worker,
                workerId,
                batch,
                startTime: Date.now(),
                timeout: null
            };
            
            // Set timeout for worker
            workerInfo.timeout = setTimeout(() => {
                console.error(`⏰ Worker ${workerId} timed out after ${config.workerTimeout/1000}s`);
                worker.terminate();
                activeWorkers.delete(workerId);
                
                // Mark batch as failed
                const failedResults = batch.map(videoPath => ({
                    videoPath,
                    success: false,
                    generatedFiles: [],
                    processingTime: 0,
                    error: 'Worker timeout'
                }));
                
                allResults.push(...failedResults);
                checkCompletion();
            }, config.workerTimeout);
            
            // Handle worker messages
            worker.on('message', (data) => {
                if (data.completed) {
                    clearTimeout(workerInfo.timeout);
                    activeWorkers.delete(workerId);
                    allResults.push(...data.results);
                    
                    const workerTime = ((Date.now() - workerInfo.startTime) / 1000).toFixed(1);
                    console.log(`🏁 Worker ${workerId} completed batch in ${workerTime}s`);
                    
                    completedWorkers++;
                    checkCompletion();
                }
            });
            
            // Handle worker errors
            worker.on('error', (error) => {
                console.error(`❌ Worker ${workerId} error:`, error.message);
                clearTimeout(workerInfo.timeout);
                activeWorkers.delete(workerId);
                
                // Mark batch as failed
                const failedResults = batch.map(videoPath => ({
                    videoPath,
                    success: false,
                    generatedFiles: [],
                    processingTime: 0,
                    error: error.message
                }));
                
                allResults.push(...failedResults);
                checkCompletion();
            });
            
            activeWorkers.set(workerId, workerInfo);
        };
        
        // Function to check if all work is complete
        const checkCompletion = () => {
            // Start new workers if there are more batches and available slots
            while (activeWorkers.size < config.maxWorkers && batchIndex < videoBatches.length) {
                const workerId = `W${batchIndex + 1}`;
                const batch = videoBatches[batchIndex];
                startWorker(workerId, batch);
                batchIndex++;
            }
            
            // Check if all work is done
            if (activeWorkers.size === 0 && batchIndex >= videoBatches.length) {
                const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(`🎉 All workers completed in ${totalTime}s`);
                resolve(allResults);
            }
        };
        
        // Start initial workers
        checkCompletion();
    });
}

/**
 * Main parallel processing function
 */
async function generateMultiLanguageVttParallel() {
    try {
        console.log('🌐 Starting Parallel Multi-Language VTT generation...');
        console.log(`📂 Video source: ${config.outputFolder}`);
        console.log(`📂 VTT destination: ${config.vttOutputFolder}`);
        console.log(`🔧 Max workers: ${config.maxWorkers}`);
        console.log(`📦 Batch size: ${config.batchSize} videos per worker`);
        console.log(`⏰ Worker timeout: ${config.workerTimeout/1000}s`);
        
        // Get video files
        const downloadsDir = config.outputFolder;
        
        if (!fs.existsSync(downloadsDir)) {
            console.error(`❌ Downloads directory not found: ${downloadsDir}`);
            return;
        }
        
        const videoFiles = fs.readdirSync(downloadsDir)
            .filter(file => file.toLowerCase().endsWith('.mp4'))
            .map(file => path.join(downloadsDir, file));
        
        if (videoFiles.length === 0) {
            console.log(`📭 No video files found in ${downloadsDir}`);
            return;
        }
        
        console.log(`🎬 Found ${videoFiles.length} video files to process`);
        
        // Ensure output directory exists
        if (!fs.existsSync(config.vttOutputFolder)) {
            fs.mkdirSync(config.vttOutputFolder, { recursive: true });
        }
        
        // Process videos in parallel
        const results = await processVideosInParallel(videoFiles);
        
        // Analyze results
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        const totalFilesGenerated = successful.reduce((sum, r) => sum + r.generatedFiles.length, 0);
        const avgProcessingTime = successful.length > 0 
            ? (successful.reduce((sum, r) => sum + r.processingTime, 0) / successful.length).toFixed(1)
            : 0;
        
        console.log(`\n📊 Parallel Processing Summary:`);
        console.log(`✅ Successful videos: ${successful.length}`);
        console.log(`❌ Failed videos: ${failed.length}`);
        console.log(`📄 Total VTT files generated: ${totalFilesGenerated}`);
        console.log(`⏱️  Average processing time per video: ${avgProcessingTime}s`);
        console.log(`🔧 Workers used: ${config.maxWorkers}`);
        console.log(`📁 VTT files location: ${config.vttOutputFolder}`);
        
        // Show failed videos if any
        if (failed.length > 0) {
            console.log(`\n❌ Failed Videos:`);
            failed.forEach(result => {
                console.log(`   - ${path.basename(result.videoPath)}: ${result.error}`);
            });
            
            if (config.retryFailedVideos) {
                console.log(`\n🔄 Retrying failed videos sequentially...`);
                const { generateMultiLanguageVttForVideo } = require('./multiLanguageVttGenerator.js');
                
                for (const failedResult of failed) {
                    try {
                        console.log(`🔄 Retrying: ${path.basename(failedResult.videoPath)}`);
                        await generateMultiLanguageVttForVideo(failedResult.videoPath);
                        console.log(`✅ Retry successful: ${path.basename(failedResult.videoPath)}`);
                    } catch (error) {
                        console.error(`❌ Retry failed: ${path.basename(failedResult.videoPath)}: ${error.message}`);
                    }
                }
            }
        }
        
        console.log(`\n💡 Files with [videoId] prefix are ready for multi-language caption upload!`);
        
    } catch (error) {
        console.error('❌ Error in parallel VTT generation:', error.message);
        process.exit(1);
    }
}

// Handle both main thread and worker thread execution
if (isMainThread) {
    // Main thread - orchestrate parallel processing
    if (require.main === module) {
        generateMultiLanguageVttParallel();
    }
    module.exports = { generateMultiLanguageVttParallel, config };
} else {
    // Worker thread - process video batch
    workerFunction();
} 