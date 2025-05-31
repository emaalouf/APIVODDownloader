require('dotenv').config();
const axios = require('axios');

// Configuration
const config = {
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    openrouterModel: process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku'
};

// Language mapping
const languageMapping = {
    'ar': { name: 'Arabic', nativeName: 'العربية' },
    'en': { name: 'English', nativeName: 'English' },
    'fr': { name: 'French', nativeName: 'Français' },
    'es': { name: 'Spanish', nativeName: 'Español' },
    'it': { name: 'Italian', nativeName: 'Italiano' }
};

/**
 * Test OpenRouter translation
 */
async function testTranslation(text, targetLanguage) {
    if (!config.openrouterApiKey) {
        console.log(`❌ OpenRouter API key not configured`);
        return null;
    }
    
    try {
        const targetLangInfo = languageMapping[targetLanguage];
        
        const prompt = `Translate the following text to ${targetLangInfo.name} (${targetLangInfo.nativeName}). 
Return ONLY the translated text without any additional explanation or formatting:

${text}`;

        console.log(`🔄 Translating to ${targetLangInfo.name}...`);
        console.log(`📝 Original: "${text}"`);
        
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
                'HTTP-Referer': 'https://api.video-downloader.local',
                'X-Title': 'API.video Multi-Language Caption Generator - Test'
            }
        });
        
        const translatedText = response.data.choices[0].message.content.trim();
        console.log(`✅ ${targetLangInfo.name}: "${translatedText}"`);
        
        return translatedText;
        
    } catch (error) {
        console.error(`❌ Translation error for ${languageMapping[targetLanguage].name}:`, 
                     error.response?.data || error.message);
        return null;
    }
}

/**
 * Run translation tests
 */
async function runTests() {
    console.log('🧪 Testing OpenRouter Translation Integration\n');
    
    // Check configuration
    console.log(`🔑 OpenRouter API Key: ${config.openrouterApiKey ? 'Configured' : 'Missing'}`);
    console.log(`🤖 Model: ${config.openrouterModel}\n`);
    
    if (!config.openrouterApiKey) {
        console.log(`❌ Please set OPENROUTER_API_KEY in your .env file`);
        console.log(`   Get your API key from: https://openrouter.ai/\n`);
        return;
    }
    
    // Test phrase
    const testText = "Welcome to this video tutorial. Today we will learn how to use this tool.";
    
    console.log(`🎯 Test phrase: "${testText}"\n`);
    
    // Test each language
    const languages = ['ar', 'fr', 'es', 'it'];
    
    for (const lang of languages) {
        await testTranslation(testText, lang);
        console.log(''); // Empty line for readability
        
        // Small delay to be respectful to the API
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('🎉 Translation test completed!');
    console.log(`💡 If all translations look good, you can run:`);
    console.log(`   TRANSLATION_METHOD=translate node multiLanguageVttGenerator.js`);
}

// Run tests if this file is executed directly
if (require.main === module) {
    runTests().catch(error => {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    });
}

module.exports = { testTranslation, runTests }; 