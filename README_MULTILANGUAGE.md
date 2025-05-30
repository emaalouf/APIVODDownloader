# Multi-Language Caption System for API.video

This enhanced system generates captions in **Arabic, English, French, Spanish, and Italian** for your API.video videos.

## 🌐 Multi-Language Features

### New Files
- `multiLanguageVttGenerator.js` - Generates VTT files in multiple languages
- `multiLanguageCaptionUploader.js` - Uploads captions in all configured languages
- Enhanced `.env` configuration for language settings

### Supported Languages
- **Arabic** (ar) - العربية
- **English** (en) - English
- **French** (fr) - Français  
- **Spanish** (es) - Español
- **Italian** (it) - Italiano

## 📋 Setup for Multi-Language

### 1. Environment Configuration
Add these settings to your `.env` file:

```bash
# Multi-language Caption Settings
CAPTION_LANGUAGES=ar,en,fr,es,it
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_MODEL=anthropic/claude-3-haiku
TRANSLATION_METHOD=whisper
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Translation Methods

#### Method 1: Whisper Multi-Language (Recommended)
- Uses local Whisper to transcribe directly in each target language
- More accurate for actual spoken content
- No additional API costs
- Set `TRANSLATION_METHOD=whisper`

#### Method 2: OpenRouter Translation Service
- Transcribes in one language, then translates to others using AI models
- Requires OpenRouter API key
- Better for consistent terminology across languages
- High-quality translations using models like Claude 3 Haiku
- Set `TRANSLATION_METHOD=translate`

## 🚀 Multi-Language Workflow

### Complete Multi-Language Process
```bash
# 1. Download videos with video IDs (same as before)
node videoDownloader.js

# 2. Generate VTT files in all languages
node multiLanguageVttGenerator.js

# 3. Upload all language captions to API.video
node multiLanguageCaptionUploader.js
```

### Generated File Structure
```
subtitles/
├── [videoId1]_title1_ar.vtt    # Arabic captions
├── [videoId1]_title1_en.vtt    # English captions
├── [videoId1]_title1_fr.vtt    # French captions
├── [videoId1]_title1_es.vtt    # Spanish captions
├── [videoId1]_title1_it.vtt    # Italian captions
├── [videoId2]_title2_ar.vtt    # Next video...
└── ...
```

## 🎛️ Configuration Options

### Language Selection
```bash
# Generate only specific languages
CAPTION_LANGUAGES=en,ar,fr

# All supported languages
CAPTION_LANGUAGES=ar,en,fr,es,it
```

### Translation Methods
```bash
# Use Whisper for each language (recommended)
TRANSLATION_METHOD=whisper

# Use English transcription + OpenRouter translation
TRANSLATION_METHOD=translate
```

### OpenRouter Models
```bash
# Fast and cost-effective (recommended)
OPENROUTER_MODEL=anthropic/claude-3-haiku

# Higher quality translations
OPENROUTER_MODEL=anthropic/claude-3-5-sonnet
OPENROUTER_MODEL=openai/gpt-4o-mini

# Specialized language models
OPENROUTER_MODEL=meta-llama/llama-3.1-8b-instruct
```

### Whisper Models
```bash
# Balance of speed and accuracy (recommended)
WHISPER_MODEL=base

# Higher accuracy (slower)
WHISPER_MODEL=small
WHISPER_MODEL=medium
WHISPER_MODEL=large
```

## 📋 Individual Language Processing

### Generate VTT for Specific Video
```bash
# Process single video in all languages
node -e "
const { generateMultiLanguageVttForVideo } = require('./multiLanguageVttGenerator.js');
generateMultiLanguageVttForVideo('./downloads/[videoId]_title.mp4');
"
```

### Upload Specific Language
```bash
# Upload specific video, specific language
node multiLanguageCaptionUploader.js videoId ar

# Upload specific video, all languages  
node multiLanguageCaptionUploader.js videoId
```

## 📊 Example Output

### VTT Generation
```bash
$ node multiLanguageVttGenerator.js
🌐 Starting Multi-Language VTT generation process...
🌐 Target languages: Arabic, English, French, Spanish, Italian
🔄 Translation method: translate
🌐 OpenRouter API: Available
🤖 OpenRouter Model: anthropic/claude-3-haiku

🎬 Processing: My_Video_Title
🆔 Video ID: vimRsLwx8pzlV2T5xrZT4Ka
🌐 Target languages: Arabic, English, French, Spanish, Italian

🎤 Transcribing in primary language (English)...
🔄 Translating to Arabic...
✅ Translated to Arabic: "Welcome to this tutorial..." → "مرحباً بكم في هذا الدرس..."
🔄 Translating to French...
✅ Translated to French: "Welcome to this tutorial..." → "Bienvenue dans ce tutoriel..."

✅ VTT generated for Arabic: [vimRsLwx8pzlV2T5xrZT4Ka]_My_Video_Title_ar.vtt
✅ VTT generated for English: [vimRsLwx8pzlV2T5xrZT4Ka]_My_Video_Title_en.vtt
✅ VTT generated for French: [vimRsLwx8pzlV2T5xrZT4Ka]_My_Video_Title_fr.vtt

📊 Multi-Language VTT Generation Summary:
✅ Successful videos: 1
📄 Total VTT files generated: 5
🌐 Languages: Arabic, English, French, Spanish, Italian
```

### Caption Upload
```bash
$ node multiLanguageCaptionUploader.js
🌐 Starting bulk multi-language caption upload process...

📊 Multi-Language Caption Upload Overview:
🎬 Videos with captions: 1
📄 Total caption files: 5
🌐 Languages available: Arabic, English, French, Spanish, Italian

📤 Uploading 1/1: My_Video_Title
🆔 Video ID: vimRsLwx8pzlV2T5xrZT4Ka
🌐 Languages: Arabic, English, French, Spanish, Italian

🔍 Checking existing captions for Arabic...
📤 Updating Arabic caption for video vimRsLwx8pzlV2T5xrZT4Ka...
    Method: PATCH (updating existing)
✅ Arabic caption updated successfully for video vimRsLwx8pzlV2T5xrZT4Ka

🔍 Checking existing captions for English...
📤 Uploading English caption for video vimRsLwx8pzlV2T5xrZT4Ka...
    Method: POST (creating new)
✅ English caption uploaded successfully for video vimRsLwx8pzlV2T5xrZT4Ka

...and so on

🔄 Caption Actions Summary:
🆕 New captions created: 3
📝 Existing captions updated: 2
📊 Total successful operations: 5

🌐 Language-specific Summary:
   Arabic: 1 successful (0 created, 1 updated), 0 failed
   English: 1 successful (1 created, 0 updated), 0 failed
   French: 1 successful (1 created, 0 updated), 0 failed
   Spanish: 1 successful (1 created, 0 updated), 0 failed
   Italian: 1 successful (0 created, 1 updated), 0 failed

✅ Successfully uploaded multi-language captions for 1 videos!
```

## 📝 VTT File Format

Each language file includes metadata:
```vtt
WEBVTT
NOTE Video ID: vimRsLwx8pzlV2T5xrZT4Ka
NOTE Title: My_Video_Title
NOTE Language: Arabic (ar)
NOTE Generated by API.video Multi-Language VTT Generator
NOTE Translation: OpenRouter (anthropic/claude-3-haiku)
NOTE Music Detection: Enabled
NOTE Silence Threshold: 0.01

1
00:00:00.000 --> 00:00:05.000
مرحباً بكم في هذا الفيديو التعليمي

2
00:00:05.000 --> 00:00:10.000
سنتعلم اليوم كيفية استخدام هذه الأداة
```

## 🔧 Troubleshooting

### Common Issues

1. **Missing Language Models**
   ```bash
   # Whisper will download models automatically
   # For Arabic/other languages, ensure you have enough disk space
   ```

2. **OpenRouter API Errors**
   ```bash
   # Check OpenRouter API key at https://openrouter.ai/
   # Verify API credits and model availability
   ```

3. **File Not Found Errors**
   ```bash
   # Ensure videos were downloaded with video IDs
   # Check file naming: [videoId]_title.mp4
   ```

### File Migration from Single-Language
If you have existing single-language VTT files:
```bash
# They will be treated as English captions
# Re-run multiLanguageVttGenerator.js to get all languages
```

## 💰 Cost Considerations

### Whisper Method (Recommended)
- ✅ **Free** - Local processing
- ✅ **Privacy** - No data sent to external services  
- ✅ **Accuracy** - Direct transcription in target language
- ⚠️ **Processing Time** - 5x longer (one run per language)

### OpenRouter Translation Method
- 💰 **OpenRouter** - Pay per token (~$0.50-$2 per million tokens)
- ⚡ **Faster** - One transcription + translation
- 🌐 **Consistent** - Same timing across languages
- 🎯 **High Quality** - AI-powered translations
- 📊 **Transparent Pricing** - Clear token-based billing

### Model Cost Comparison
- **Claude 3 Haiku**: $0.25/$1.25 per million tokens (input/output)
- **GPT-4o Mini**: $0.15/$0.60 per million tokens
- **Llama 3.1**: Often cheaper, varies by provider

## 🎯 Best Practices

### Language Selection
- Start with languages your audience actually speaks
- Arabic and French have excellent AI translation support
- Italian and Spanish work very well with modern models
- Consider your video content's primary language

### Model Selection
```bash
# For cost-effectiveness
OPENROUTER_MODEL=anthropic/claude-3-haiku

# For maximum quality
OPENROUTER_MODEL=anthropic/claude-3-5-sonnet

# For technical content
OPENROUTER_MODEL=openai/gpt-4o-mini
```

### Processing Strategy
```bash
# For large collections, process in batches
CAPTION_LANGUAGES=en,ar node multiLanguageVttGenerator.js
# Then add more languages
CAPTION_LANGUAGES=fr,es,it node multiLanguageVttGenerator.js
```

### Quality Control
- Review generated captions in each language
- Test different OpenRouter models for your content type
- Use native speakers for quality assessment
- Consider your audience's language preferences

## 🚀 Advanced Usage

### Custom Language Sets
```bash
# European languages only
CAPTION_LANGUAGES=en,fr,es,it

# Arabic + English
CAPTION_LANGUAGES=ar,en

# Single language testing
CAPTION_LANGUAGES=en
```

### OpenRouter Configuration
```bash
# Get API key from https://openrouter.ai/
export OPENROUTER_API_KEY="sk-or-v1-..."

# Test different models
OPENROUTER_MODEL=anthropic/claude-3-haiku
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_MODEL=meta-llama/llama-3.1-8b-instruct
```

### Batch Processing
```bash
# Process first 10 videos only
head -10 downloads/* | node multiLanguageVttGenerator.js

# Process specific video IDs
node multiLanguageCaptionUploader.js vimRsLwx8pzlV2T5xrZT4Ka
```

## 📞 Support

For multi-language specific issues:
- **Whisper Language Support**: [OpenAI Whisper Languages](https://github.com/openai/whisper#available-models-and-languages)
- **API.video Language Codes**: [API.video Documentation](https://docs.api.video/reference/api/Captions)
- **OpenRouter API**: [OpenRouter Documentation](https://openrouter.ai/docs)
- **Model Availability**: [OpenRouter Models](https://openrouter.ai/models)

## 🎉 Success Metrics

After setup, you'll have:
- ✅ 5 caption languages per video
- ✅ AI-powered high-quality translations
- ✅ Automatic filename organization  
- ✅ Bulk upload capability
- ✅ Language-specific error tracking
- ✅ Cost-effective translation options
- ✅ Compatible with existing workflow

Perfect for international content, education, accessibility, and reaching global audiences with professional-quality multilingual captions! 🌍 

## 🔄 Smart Caption Management

The system automatically detects and handles existing captions:

### **Auto-Detection Logic:**
- 🔍 **Checks existing captions** for each video/language combination
- 📝 **PATCH updates** existing captions if they're already present
- 🆕 **POST creates** new captions if they don't exist
- 📊 **Reports detailed statistics** on created vs updated captions

### **API Endpoints Used:**
```bash
# Check if captions exist
GET https://ws.api.video/videos/{videoId}/captions/{language}

# Create new captions (if none exist)
POST https://ws.api.video/videos/{videoId}/captions/{language}

# Update existing captions (if they exist)
PATCH https://ws.api.video/videos/{videoId}/captions/{language}
```

### **Benefits:**
- ✅ **Safe re-runs** - Won't duplicate captions
- ✅ **Update workflow** - Improve captions by re-running the generator
- ✅ **Selective updates** - Only updates languages that changed
- ✅ **Clear reporting** - Know exactly what was created vs updated

### **Example Scenarios:**

#### **First Run (All New):**
```
🆕 New captions created: 2,370 (474 videos × 5 languages)
📝 Existing captions updated: 0
```

#### **Re-run After Improvements:**
```
🆕 New captions created: 47 (new videos added)
📝 Existing captions updated: 2,323 (improved existing captions)
```

## 🚀 Multi-Language Workflow