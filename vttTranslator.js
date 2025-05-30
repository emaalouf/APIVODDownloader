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
    batchSize: parseInt(process.env.TRANSLATION_BATCH_SIZE) || 5, // Number of segments to translate at once
    delayBetweenRequests: parseInt(process.env.TRANSLATION_DELAY) || 500, // ms delay between API calls
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
 * Translates VTT segments in batches
 */
async function translateVttSegments(segments, targetLanguage) {
    console.log(`🔄 Translating ${segments.length} segments to ${languageMapping[targetLanguage].name}...`);
    
    const translatedSegments = [];
    const totalBatches = Math.ceil(segments.length / config.batchSize);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * config.batchSize;
        const batchEnd = Math.min(batchStart + config.batchSize, segments.length);
        const batch = segments.slice(batchStart, batchEnd);
        
        console.log(`   📦 Batch ${batchIndex + 1}/${totalBatches} (segments ${batchStart + 1}-${batchEnd})`);
        
        // Translate each segment in the batch
        for (const segment of batch) {
            const translatedText = await translateTextWithOpenRouter(
                segment.text, 
                targetLanguage,
                `Subtitle segment timing: ${segment.start} to ${segment.end}`
            );
            
            translatedSegments.push({
                start: segment.start,
                end: segment.end,
                text: translatedText
            });
            
            // Small delay between individual translations
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Longer delay between batches
        if (batchIndex < totalBatches - 1) {
            await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
        }
        
        // Progress indicator
        const progress = Math.round(((batchIndex + 1) / totalBatches) * 100);
        process.stdout.write(`\r   🔄 Progress: ${progress}% `);
    }
    
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
 * Translates a single VTT file to all target languages
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
    
    const translatedFiles = [];
    
    // Translate to each target language
    for (const targetLanguage of config.targetLanguages) {
        const outputFilename = `${filenameWithoutExt}_${targetLanguage}.vtt`;
        const outputPath = path.join(config.vttOutputFolder, outputFilename);
        
        // Skip if file already exists and skipExisting is enabled
        if (config.skipExisting && fs.existsSync(outputPath)) {
            console.log(`   ⏭️  Skipping ${languageMapping[targetLanguage].name} (file exists): ${outputFilename}`);
            translatedFiles.push(outputPath);
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
            
            translatedFiles.push(originalLangPath);
            continue;
        }
        
        try {
            console.log(`   🔄 Translating to ${languageMapping[targetLanguage].name}...`);
            
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
            
            translatedFiles.push(outputPath);
            
        } catch (error) {
            console.error(`   ❌ Failed to translate to ${languageMapping[targetLanguage].name}:`, error.message);
        }
        
        // Delay between languages to avoid rate limiting
        if (targetLanguage !== config.targetLanguages[config.targetLanguages.length - 1]) {
            await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
        }
    }
    
    return translatedFiles;
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
            console.log(`   ⏸️  Waiting before next file...`);
            await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests * 2));
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
        console.log('🌐 Starting VTT translation process...');
        console.log(`📂 VTT source: ${config.vttInputFolder}`);
        console.log(`📂 VTT destination: ${config.vttOutputFolder}`);
        console.log(`🤖 Translation model: ${config.openrouterModel}`);
        console.log(`🌐 Target languages: ${config.targetLanguages.map(lang => languageMapping[lang].name).join(', ')}`);
        
        // Check OpenRouter API configuration
        if (!config.openrouterApiKey) {
            console.log(`\n❌ OpenRouter API key not configured.`);
            console.log(`   Please set OPENROUTER_API_KEY in your .env file`);
            return;
        }
        
        console.log(`\n🔑 OpenRouter API: Configured`);
        console.log(`🤖 Model: ${config.openrouterModel}`);
        
        await translateAllVttFiles();
        
        console.log('\n🎉 VTT translation process completed!');
        
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