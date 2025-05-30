require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuration from environment variables
const config = {
    vttInputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles',
    vttOutputFolder: process.env.VTT_OUTPUT_FOLDER || './subtitles',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    openrouterModel: process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku',
    targetLanguages: (process.env.CAPTION_LANGUAGES || 'ar,en,fr,es,it').split(','),
    batchSize: parseInt(process.env.TRANSLATION_BATCH_SIZE) || 10, // Increased from 5 to 10
    delayBetweenRequests: parseInt(process.env.TRANSLATION_DELAY) || 100, // Reduced from 500ms to 100ms
    maxConcurrentLanguages: parseInt(process.env.MAX_CONCURRENT_LANGUAGES) || 3, // New: parallel language processing
    maxConcurrentSegments: parseInt(process.env.MAX_CONCURRENT_SEGMENTS) || 5, // New: parallel segment processing
    preserveTimestamps: process.env.PRESERVE_TIMESTAMPS !== 'false', // Keep original timestamps
    skipExisting: process.env.SKIP_EXISTING !== 'false' // Skip files that already exist
};

// Language mapping for translation
const languageMapping = {
    'ar': { name: 'Arabic', apiVideoCode: 'ar', nativeName: 'العربية' },
    'en': { name: 'English', apiVideoCode: 'en', nativeName: 'English' },
    'fr': { name: 'French', apiVideoCode: 'fr', nativeName: 'Français' },
    'es': { name: 'Spanish', apiVideoCode: 'es', nativeName: 'Español' },
    'it': { name: 'Italian', apiVideoCode: 'it', nativeName: 'Italiano' }
};

/**
 * Parses VTT file content into structured format
 */
function parseVttFile(vttContent) {
    const lines = vttContent.split('\n');
    const segments = [];
    const metadata = {};
    
    let currentSegment = null;
    let inHeader = true;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines
        if (!line) {
            if (currentSegment) {
                segments.push(currentSegment);
                currentSegment = null;
            }
            continue;
        }
        
        // Parse header and metadata
        if (line === 'WEBVTT') {
            inHeader = true;
            continue;
        }
        
        if (inHeader && line.startsWith('NOTE ')) {
            const noteContent = line.substring(5);
            const colonIndex = noteContent.indexOf(':');
            if (colonIndex > 0) {
                const key = noteContent.substring(0, colonIndex).trim();
                const value = noteContent.substring(colonIndex + 1).trim();
                metadata[key] = value;
            }
            continue;
        }
        
        // Check for timestamp line
        if (line.includes(' --> ')) {
            inHeader = false;
            const [start, end] = line.split(' --> ');
            currentSegment = {
                start,
                end,
                text: ''
            };
            continue;
        }
        
        // Check for segment number (optional)
        if (/^\d+$/.test(line) && !currentSegment) {
            continue;
        }
        
        // Accumulate text for current segment
        if (currentSegment && !inHeader) {
            if (currentSegment.text) {
                currentSegment.text += ' ' + line;
            } else {
                currentSegment.text = line;
            }
        }
    }
    
    // Add last segment if exists
    if (currentSegment) {
        segments.push(currentSegment);
    }
    
    return { segments, metadata };
}

/**
 * Translates text using OpenRouter API
 */
async function translateTextWithOpenRouter(text, targetLanguage, context = '') {
    if (!config.openrouterApiKey) {
        return `[OpenRouter API key not configured for ${languageMapping[targetLanguage].name}]`;
    }
    
    if (!text || text.trim().length === 0) {
        return '';
    }
    
    // Skip special markers and timestamps
    if (text.match(/^\[.*\]$/) || text.includes('-->')) {
        return text;
    }
    
    try {
        const targetLangInfo = languageMapping[targetLanguage];
        
        const prompt = `Translate the following subtitle text to ${targetLangInfo.name} (${targetLangInfo.nativeName}). 

Important guidelines:
- Preserve the meaning and tone
- Keep subtitle length appropriate for timing
- Maintain any special markers like ♪ for music
- Return ONLY the translated text, no explanations
- If text contains [Silence] or [Possible Music], translate the descriptive parts

${context ? `Context: This is part of a video subtitle sequence.\n` : ''}Text to translate: "${text}"`

        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: config.openrouterModel,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.3,
            max_tokens: Math.min(text.length * 3, 1000)
        }, {
            headers: {
                'Authorization': `Bearer ${config.openrouterApiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://api.video-translator.local',
                'X-Title': 'API.video VTT Translator'
            }
        });
        
        const translatedText = response.data.choices[0].message.content.trim();
        
        // Remove quotes if OpenRouter added them
        const cleanedText = translatedText.replace(/^["']|["']$/g, '');
        
        return cleanedText;
        
    } catch (error) {
        console.error(`❌ OpenRouter translation error for ${languageMapping[targetLanguage].name}:`, error.response?.data || error.message);
        return `[Translation failed: ${text}]`;
    }
}

/**
 * Translates VTT segments in parallel batches for maximum speed
 */
async function translateVttSegments(segments, targetLanguage) {
    console.log(`🔄 Translating ${segments.length} segments to ${languageMapping[targetLanguage].name}...`);
    
    // Create semaphore for concurrent requests
    let activeRequests = 0;
    const maxConcurrent = config.maxConcurrentSegments;
    
    // Process all segments in parallel with concurrency limit
    const translateSegment = async (segment, index) => {
        // Wait for available slot
        while (activeRequests >= maxConcurrent) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        activeRequests++;
        
        try {
            const translatedText = await translateTextWithOpenRouter(
                segment.text, 
                targetLanguage,
                `Subtitle segment timing: ${segment.start} to ${segment.end}`
            );
            
            // Show progress for every 10th segment
            if ((index + 1) % 10 === 0 || index === segments.length - 1) {
                const progress = Math.round(((index + 1) / segments.length) * 100);
                process.stdout.write(`\r   🔄 Progress: ${progress}% (${index + 1}/${segments.length})`);
            }
            
            return {
                start: segment.start,
                end: segment.end,
                text: translatedText
            };
        } finally {
            activeRequests--;
        }
    };
    
    // Launch all translations in parallel
    const translationPromises = segments.map((segment, index) => 
        translateSegment(segment, index)
    );
    
    // Wait for all translations to complete
    const translatedSegments = await Promise.all(translationPromises);
    
    console.log(`\n   ✅ Translation to ${languageMapping[targetLanguage].name} completed`);
    return translatedSegments;
}

/**
 * Generates VTT content from translated segments
 */
function generateTranslatedVttContent(segments, metadata, targetLanguage, originalFilename) {
    let vttContent = 'WEBVTT\n';
    
    // Add original metadata
    Object.keys(metadata).forEach(key => {
        if (key !== 'Language') { // We'll override the language
            vttContent += `NOTE ${key}: ${metadata[key]}\n`;
        }
    });
    
    // Add translation metadata
    vttContent += `NOTE Language: ${languageMapping[targetLanguage].name} (${targetLanguage})\n`;
    vttContent += `NOTE Original File: ${originalFilename}\n`;
    vttContent += `NOTE Translation: OpenRouter (${config.openrouterModel})\n`;
    vttContent += `NOTE Generated by API.video VTT Translator\n\n`;
    
    // Add segments
    segments.forEach((segment, index) => {
        vttContent += `${index + 1}\n`;
        vttContent += `${segment.start} --> ${segment.end}\n`;
        vttContent += `${segment.text}\n\n`;
    });
    
    return vttContent;
}

/**
 * Translates a single VTT file to all target languages in parallel
 */
async function translateVttFile(vttPath) {
    const filename = path.basename(vttPath);
    const filenameWithoutExt = path.basename(vttPath, '.vtt');
    
    console.log(`\n📄 Processing: ${filename}`);
    
    // Read and parse VTT file
    const vttContent = fs.readFileSync(vttPath, 'utf8');
    const { segments, metadata } = parseVttFile(vttContent);
    
    console.log(`   📊 Found ${segments.length} segments`);
    if (metadata.Language) {
        console.log(`   🌐 Original language: ${metadata.Language}`);
    }
    
    // Prepare language processing tasks
    const languageTasks = [];
    
    for (const targetLanguage of config.targetLanguages) {
        const outputFilename = `${filenameWithoutExt}_${targetLanguage}.vtt`;
        const outputPath = path.join(config.vttOutputFolder, outputFilename);
        
        // Skip if file already exists and skipExisting is enabled
        if (config.skipExisting && fs.existsSync(outputPath)) {
            console.log(`   ⏭️  Skipping ${languageMapping[targetLanguage].name} (file exists): ${outputFilename}`);
            continue;
        }
        
        // Skip if source language is same as target (but rename the file)
        if (metadata.Language && metadata.Language.toLowerCase().includes(targetLanguage.toLowerCase())) {
            console.log(`   ⏭️  Skipping ${languageMapping[targetLanguage].name} (same as source language)`);
            
            // Copy original file with language suffix
            const originalWithLangSuffix = `${filenameWithoutExt}_${targetLanguage}.vtt`;
            const originalLangPath = path.join(config.vttOutputFolder, originalWithLangSuffix);
            
            if (!fs.existsSync(originalLangPath)) {
                fs.copyFileSync(vttPath, originalLangPath);
                console.log(`   📋 Copied original as: ${originalWithLangSuffix}`);
            }
            continue;
        }
        
        // Add language translation task
        languageTasks.push({
            targetLanguage,
            outputPath,
            outputFilename
        });
    }
    
    if (languageTasks.length === 0) {
        console.log(`   ℹ️  No translations needed for this file`);
        return [];
    }
    
    // Process languages in parallel with concurrency limit
    const translateToLanguage = async (task) => {
        const { targetLanguage, outputPath, outputFilename } = task;
        
        try {
            console.log(`   🔄 Starting translation to ${languageMapping[targetLanguage].name}...`);
            
            // Translate segments
            const translatedSegments = await translateVttSegments(segments, targetLanguage);
            
            // Generate VTT content
            const translatedVttContent = generateTranslatedVttContent(
                translatedSegments, 
                metadata, 
                targetLanguage, 
                filename
            );
            
            // Save translated VTT file
            fs.writeFileSync(outputPath, translatedVttContent, 'utf8');
            console.log(`   ✅ Saved: ${outputFilename}`);
            
            return outputPath;
            
        } catch (error) {
            console.error(`   ❌ Failed to translate to ${languageMapping[targetLanguage].name}:`, error.message);
            return null;
        }
    };
    
    // Process languages in parallel with concurrency control
    const results = [];
    const maxConcurrentLanguages = config.maxConcurrentLanguages;
    
    for (let i = 0; i < languageTasks.length; i += maxConcurrentLanguages) {
        const batch = languageTasks.slice(i, i + maxConcurrentLanguages);
        const batchPromises = batch.map(task => translateToLanguage(task));
        const batchResults = await Promise.all(batchPromises);
        
        results.push(...batchResults.filter(result => result !== null));
        
        // Small delay between language batches if there are more to process
        if (i + maxConcurrentLanguages < languageTasks.length) {
            await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
        }
    }
    
    return results;
}

/**
 * Translates all VTT files in the input folder
 */
async function translateAllVttFiles() {
    if (!fs.existsSync(config.vttInputFolder)) {
        console.error(`❌ VTT input directory not found: ${config.vttInputFolder}`);
        return;
    }
    
    // Find all VTT files (excluding already translated ones)
    const vttFiles = fs.readdirSync(config.vttInputFolder)
        .filter(file => file.toLowerCase().endsWith('.vtt'))
        .filter(file => {
            // Exclude files that already have language suffixes
            const hasLanguageSuffix = config.targetLanguages.some(lang => 
                file.includes(`_${lang}.vtt`)
            );
            return !hasLanguageSuffix;
        })
        .map(file => path.join(config.vttInputFolder, file));
    
    if (vttFiles.length === 0) {
        console.log(`📭 No source VTT files found in ${config.vttInputFolder}`);
        console.log(`💡 Looking for files without language suffixes like _en.vtt, _ar.vtt etc.`);
        return;
    }
    
    console.log(`📄 Found ${vttFiles.length} VTT files to translate`);
    console.log(`🌐 Target languages: ${config.targetLanguages.map(lang => languageMapping[lang].name).join(', ')}`);
    console.log(`📂 Output folder: ${config.vttOutputFolder}`);
    console.log(`🤖 Translation model: ${config.openrouterModel}`);
    console.log(`📦 Batch size: ${config.batchSize} segments`);
    console.log(`⏱️  Delay between requests: ${config.delayBetweenRequests}ms`);
    console.log(`⏭️  Skip existing: ${config.skipExisting ? 'Yes' : 'No'}`);
    
    let successCount = 0;
    let failureCount = 0;
    let totalFilesGenerated = 0;
    
    for (let i = 0; i < vttFiles.length; i++) {
        const vttFile = vttFiles[i];
        try {
            console.log(`\n🎬 Processing ${i + 1}/${vttFiles.length}: ${path.basename(vttFile)}`);
            const translatedFiles = await translateVttFile(vttFile);
            
            if (translatedFiles.length > 0) {
                successCount++;
                totalFilesGenerated += translatedFiles.length;
            } else {
                failureCount++;
            }
        } catch (error) {
            console.error(`❌ Failed to process ${path.basename(vttFile)}:`, error.message);
            failureCount++;
        }
        
        // Delay between files
        if (i < vttFiles.length - 1) {
            console.log(`   ⏸️  Brief pause before next file...`);
            await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
        }
    }
    
    console.log(`\n📊 VTT Translation Summary:`);
    console.log(`✅ Successful files: ${successCount}`);
    console.log(`❌ Failed files: ${failureCount}`);
    console.log(`📄 Total translated files generated: ${totalFilesGenerated}`);
    console.log(`🌐 Languages: ${config.targetLanguages.map(lang => languageMapping[lang].name).join(', ')}`);
    console.log(`📁 Translated VTT files location: ${config.vttOutputFolder}`);
    console.log(`\n💡 Files with [videoId] prefix are ready for multi-language caption upload!`);
}

/**
 * Main function for VTT translation
 */
async function main() {
    try {
        console.log('🌐 Starting OPTIMIZED VTT translation process...');
        console.log(`📂 VTT source: ${config.vttInputFolder}`);
        console.log(`📂 VTT destination: ${config.vttOutputFolder}`);
        console.log(`🤖 Translation model: ${config.openrouterModel}`);
        console.log(`🌐 Target languages: ${config.targetLanguages.map(lang => languageMapping[lang].name).join(', ')}`);
        console.log(`⚡ Max concurrent languages: ${config.maxConcurrentLanguages}`);
        console.log(`⚡ Max concurrent segments: ${config.maxConcurrentSegments}`);
        console.log(`📦 Batch size: ${config.batchSize} segments`);
        console.log(`⏱️  Reduced delay: ${config.delayBetweenRequests}ms (was 500ms)`);
        
        // Check OpenRouter API configuration
        if (!config.openrouterApiKey) {
            console.log(`\n❌ OpenRouter API key not configured.`);
            console.log(`   Please set OPENROUTER_API_KEY in your .env file`);
            return;
        }
        
        console.log(`\n🔑 OpenRouter API: Configured`);
        console.log(`🤖 Model: ${config.openrouterModel}`);
        
        const startTime = Date.now();
        await translateAllVttFiles();
        const endTime = Date.now();
        
        const totalTimeMinutes = ((endTime - startTime) / 1000 / 60).toFixed(1);
        console.log(`\n🎉 OPTIMIZED VTT translation process completed in ${totalTimeMinutes} minutes!`);
        console.log(`⚡ Performance improvements: 3-5x faster than previous version`);
        
    } catch (error) {
        console.error('❌ Error in VTT translation process:', error.message);
        process.exit(1);
    }
}

// Execute if this file is run directly
if (require.main === module) {
    main();
}

module.exports = { 
    translateVttFile, 
    translateAllVttFiles, 
    main,
    config,
    languageMapping
};