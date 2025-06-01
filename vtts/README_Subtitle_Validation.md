# Subtitle Validation and Cleanup Tools

This document describes the subtitle validation and cleanup tools created to ensure caption correctness and manage allowed languages for API.video.

## Overview

We've created two main tools to validate and clean up subtitle files:

1. **`subtitles_validator.js`** - Validates VTT files using OpenRouter AI to detect language mismatches
2. **`caption_cleanup_tool.js`** - Cleans up API.video captions by removing non-allowed languages

## Allowed Languages

The system is configured to only keep captions in these languages:
- **ar** (Arabic)
- **en** (English) 
- **fr** (French)
- **es** (Spanish)
- **it** (Italian)

Any captions in other languages will be automatically deleted.

## Tool 1: Subtitle Validator (`subtitles_validator.js`)

### Purpose
Validates local VTT files in the `/subtitles` folder to ensure:
- Captions are in correct languages
- Language labels match actual content
- Non-allowed languages are removed

### Features
- **AI Language Detection**: Uses OpenRouter AI to detect actual language of subtitle content
- **Filename Parsing**: Extracts video ID and expected language from filename format `[videoId]_Title_language.vtt`
- **Mismatch Detection**: Identifies when filename language doesn't match content language
- **Automatic Cleanup**: Deletes incorrect local files and remote captions
- **Report Generation**: Creates detailed validation report

### Usage
```bash
# Run validation on all VTT files in /subtitles folder
node subtitles_validator.js
```

### Example Output
```
🚀 Starting Subtitle Validation Process...
📁 Scanning folder: ./subtitles
✅ Allowed languages: ar, en, fr, es, it

📋 Validating: [vi057I5LKytkjaEW5eqOiJo]_Emotional_Mastery-3_en.vtt
🤖 AI detected language: "english" for text: "This is a test caption...."
🔍 Detected language: english (en)
📍 Expected language: en
🤖 Detected language: en
❓ Language mismatch: NO

✅ Successfully validated: 1
❌ Errors: 1
🗑️  Files/captions deleted: 0
```

## Tool 2: Caption Cleanup Tool (`caption_cleanup_tool.js`)

### Purpose
Manages API.video captions to ensure only allowed languages remain on the platform.

### Features
- **API.video Integration**: Fetches and manages captions directly via API
- **Bulk Processing**: Can process all videos or specific videos
- **Interactive Mode**: Processes videos found in local subtitle files
- **Safe Deletion**: Only deletes non-allowed languages, preserves allowed ones
- **Detailed Reporting**: Shows exactly what was deleted and what was kept

### Usage Options

#### Interactive Mode (Recommended)
```bash
# Process videos found in subtitle files
node caption_cleanup_tool.js --interactive
# or simply
node caption_cleanup_tool.js
```

#### Specific Video
```bash
# Clean captions for a specific video
node caption_cleanup_tool.js --video=vi057I5LKytkjaEW5eqOiJo
```

#### All Videos (Use with Caution)
```bash
# Clean all videos in your API.video account
node caption_cleanup_tool.js --all
```

### Example Output
```
🎬 Processing video: Manual Cleanup (vi057I5LKytkjaEW5eqOiJo)
📊 Found 5 captions for this video
   📝 ar: https://vod.api.video/vod/vi057I5LKytkjaEW5eqOiJo/captions/ar.vtt
   📝 fr: https://vod.api.video/vod/vi057I5LKytkjaEW5eqOiJo/captions/fr.vtt
   📝 es: https://vod.api.video/vod/vi057I5LKytkjaEW5eqOiJo/captions/es.vtt
   📝 it: https://vod.api.video/vod/vi057I5LKytkjaEW5eqOiJo/captions/it.vtt
   📝 en: https://vod.api.video/vod/vi057I5LKytkjaEW5eqOiJo/captions/en.vtt
✅ Language 'ar' is allowed, keeping it
✅ Language 'fr' is allowed, keeping it
✅ Language 'es' is allowed, keeping it
✅ Language 'it' is allowed, keeping it
✅ Language 'en' is allowed, keeping it

📝 Captions found: 5
🗑️  Captions deleted: 0
```

## Configuration

Both tools use environment variables from your `.env` file:

```env
# Required
APIVIDEO_API_KEY=your_api_key_here
OPENROUTER_API_KEY=your_openrouter_key_here

# Optional
OPENROUTER_MODEL=anthropic/claude-3-haiku
VTT_OUTPUT_FOLDER=./subtitles
DELAY_BETWEEN_FILES=2000
OPENROUTER_DELAY=3000
DELAY_BETWEEN_REQUESTS=1000
```

## API Endpoints Used

The tools interact with these API.video endpoints:

### GET Captions
```
GET https://ws.api.video/videos/{videoId}/captions
```
Lists all captions for a specific video.

### DELETE Caption
```
DELETE https://ws.api.video/videos/{videoId}/captions/{language}
```
Deletes a specific caption by language code.

## Reports Generated

### Validation Report (`subtitle_validation_report.json`)
Contains detailed results of subtitle validation including:
- Files processed
- Language detection results
- Mismatches found
- Actions taken

### Cleanup Report (`caption_cleanup_report.json`)
Contains results of caption cleanup including:
- Videos processed
- Captions found per video
- Captions deleted
- Languages cleaned up

## Error Handling

Both tools include comprehensive error handling:
- **Rate Limiting**: Automatic delays and retries
- **Authentication**: Token refresh and caching
- **API Errors**: Graceful handling of 404s and other errors
- **File System**: Safe file operations with error recovery

## Best Practices

1. **Always run validation first** to understand what needs cleanup
2. **Use interactive mode** for targeted cleanup of specific videos
3. **Review reports** before running bulk operations
4. **Test with single videos** before using `--all` option
5. **Keep backups** of important caption files

## Workflow Example

```bash
# 1. Validate local subtitle files
node subtitles_validator.js

# 2. Review the validation report
cat subtitle_validation_report.json

# 3. Clean up API.video captions for validated videos
node caption_cleanup_tool.js --interactive

# 4. Review the cleanup report
cat caption_cleanup_report.json
```

## Troubleshooting

### OpenRouter API Issues
- Ensure `OPENROUTER_API_KEY` is set correctly
- Check for duplicate entries in `.env`
- Verify API key has sufficient credits

### API.video Authentication
- Ensure `APIVIDEO_API_KEY` is valid
- Check token cache file `.token_cache.json`
- Verify API permissions

### Rate Limiting
- Increase `DELAY_BETWEEN_FILES` or `DELAY_BETWEEN_REQUESTS`
- Use smaller batch sizes for large operations
- Monitor API rate limits

This comprehensive validation and cleanup system ensures your subtitle files are correctly labeled and your API.video captions only contain the allowed languages (ar, en, fr, es, it). 