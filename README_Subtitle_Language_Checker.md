# Subtitle Language Checker

This tool validates subtitle files by checking if the language suffix in the filename matches the actual language content inside the file using OpenRouter AI.

## Features

- 🔍 **Filename Parsing**: Extracts language codes from various subtitle filename formats
- 🤖 **AI Language Detection**: Uses OpenRouter AI to detect the actual language in subtitle content
- ✅ **Match Validation**: Compares filename language suffix with detected content language
- 📊 **Detailed Reporting**: Generates comprehensive JSON reports with results
- 🔄 **Rate Limiting**: Built-in delays and retry logic to respect API limits
- 🛡️ **Error Handling**: Robust error handling for various edge cases

## Supported Filename Formats

The tool can parse language suffixes from these filename formats:

1. **Bracketed Video ID Format**: `[videoId]_Title_language.vtt`
   - Example: `[vi057I5LKytkjaEW5eqOiJo]_Emotional_Mastery-3_en.vtt`
   - Expected language: `en`

2. **Underscore Separated Format**: `Title_language.vtt`
   - Example: `Emotional_Mastery_en.vtt`
   - Expected language: `en`

3. **Dot Separated Format**: `Title.language.vtt`
   - Example: `Emotional_Mastery.en.vtt`
   - Expected language: `en`

4. **MP4 Format**: `Filename.mp4.language.vtt`
   - Example: `Emotional_Mastery-1.mp4.en.vtt`
   - Expected language: `en`

## Installation & Setup

### Prerequisites

1. Node.js (v14 or higher)
2. npm or yarn package manager
3. OpenRouter API key

### Environment Variables

Create a `.env` file in your project root with:

```env
# Required
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Optional - Defaults provided
SUBTITLES_FOLDER=./subtitles
OPENROUTER_MODEL=anthropic/claude-3-haiku
OPENROUTER_DELAY=3000
```

### Required Dependencies

Install the required packages:

```bash
npm install dotenv axios
```

## Usage

### Command Line Usage

Run the language checker directly:

```bash
node subtitle_language_checker.js
```

### Programmatic Usage

```javascript
const { generateLanguageCheckReport, checkSubtitleFile } = require('./subtitle_language_checker.js');

// Check all subtitle files and generate report
await generateLanguageCheckReport();

// Check a single file
const result = await checkSubtitleFile('./subtitles/example_en.vtt');
console.log(result);
```

## Configuration Options

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `SUBTITLES_FOLDER` | `./subtitles` | Path to folder containing VTT files |
| `OPENROUTER_API_KEY` | *Required* | Your OpenRouter API key |
| `OPENROUTER_MODEL` | `anthropic/claude-3-haiku` | AI model for language detection |
| `OPENROUTER_DELAY` | `3000` | Delay between API requests (ms) |

## Output Report

The tool generates a detailed JSON report (`subtitle_language_check_report.json`) with:

### Summary Section
```json
{
  "summary": {
    "timestamp": "2024-01-15T10:30:00.000Z",
    "totalFiles": 5,
    "matches": 3,
    "mismatches": 1,
    "errors": 0,
    "noLanguageSuffix": 1,
    "config": {
      "model": "anthropic/claude-3-haiku",
      "delay": 3000
    }
  }
}
```

### Results Section
Each file gets a detailed analysis:

```json
{
  "filename": "[vi057I5LKytkjaEW5eqOiJo]_Emotional_Mastery-3_en.vtt",
  "status": "MATCH",
  "message": "Language suffix matches detected content language",
  "expectedLanguage": "en",
  "detectedLanguage": "english",
  "detectedLanguageCode": "en",
  "extractedText": "This is a test caption.",
  "match": true,
  "hasVideoId": true,
  "videoId": "vi057I5LKytkjaEW5eqOiJo",
  "title": "Emotional_Mastery-3"
}
```

## Status Types

| Status | Description |
|--------|-------------|
| `MATCH` | ✅ Language suffix matches detected content |
| `MISMATCH` | ❌ Language suffix does NOT match detected content |
| `NO_LANGUAGE_SUFFIX` | ⚠️ No language code found in filename |
| `NO_TEXT_CONTENT` | ⚠️ No meaningful text found in VTT file |
| `DETECTION_ERROR` | 💥 Error during AI language detection |
| `FILE_ERROR` | 💥 Error reading the VTT file |

## Supported Languages

The tool can detect 50+ languages including:

- **Major Languages**: English, Spanish, French, German, Italian, Portuguese, Russian, Chinese, Japanese, Korean, Arabic
- **European Languages**: Dutch, Swedish, Norwegian, Danish, Finnish, Polish, Czech, Hungarian, Turkish, Greek, Hebrew
- **Asian Languages**: Thai, Vietnamese, Indonesian, Malay, Filipino, Tamil, Telugu, Bengali, Urdu, Persian
- **Other Languages**: Ukrainian, Romanian, Bulgarian, Croatian, Serbian, Slovenian, Slovak, Lithuanian, Latvian, Estonian

## Example Output

```
🎯 Subtitle Language Suffix Checker
=====================================
📁 Checking subtitles folder: ./subtitles
🤖 Using OpenRouter model: anthropic/claude-3-haiku
⏱️  Request delay: 3000ms
📊 Found 2 VTT file(s) to check

🔍 Checking file: [vi057I5LKytkjaEW5eqOiJo]_Emotional_Mastery-3_en.vtt
📝 Extracted text: "This is a test caption."
🤖 AI detected language: "english" for text: "This is a test caption."
✅ [vi057I5LKytkjaEW5eqOiJo]_Emotional_Mastery-3_en.vtt - Language matches (en)

🔍 Checking file: Emotional_Mastery-1.mp4.vtt
⚠️  Emotional_Mastery-1.mp4.vtt - No language suffix in filename

📋 Final Summary
=================
📁 Total files checked: 2
✅ Language matches: 1
❌ Language mismatches: 0
⚠️  No language suffix: 1
💥 Errors: 0

💾 Detailed report saved to: ./subtitle_language_check_report.json
```

## Rate Limiting & Best Practices

- **Default Delay**: 3 seconds between requests to respect OpenRouter rate limits
- **Retry Logic**: Automatic retries with exponential backoff for rate limit errors
- **Text Extraction**: Uses first 10 meaningful subtitle lines for language detection
- **Error Filtering**: Automatically detects and handles placeholder/error text

## Troubleshooting

### Common Issues

1. **Missing API Key**
   ```
   ❌ OPENROUTER_API_KEY not found in environment variables
   ```
   - Solution: Add your OpenRouter API key to the `.env` file

2. **Rate Limiting**
   ```
   🔄 Rate limit hit, retrying...
   ```
   - Solution: Increase `OPENROUTER_DELAY` in your `.env` file

3. **No Language Suffix**
   ```
   ⚠️ No language suffix detected in filename
   ```
   - Solution: Rename files to include language codes (e.g., `_en.vtt`)

4. **Empty Content**
   ```
   ⚠️ No meaningful text content found in file
   ```
   - Solution: Check if VTT file contains actual subtitle text

### Debug Mode

For verbose logging, you can modify the script to add more detailed console output by uncommenting debug statements or setting environment variables for more detailed logging.

## API Costs

- Uses OpenRouter API which charges per token
- Typical cost per subtitle file: ~$0.001-0.005 depending on content length
- Costs are minimal for language detection tasks

## Contributing

Feel free to submit issues or pull requests to improve:
- Additional filename format support
- Better language detection accuracy
- Performance optimizations
- Additional report formats

## License

This tool is part of the APIVODDownloader project and follows the same licensing terms. 