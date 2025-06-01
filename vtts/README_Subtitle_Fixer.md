# Subtitle Fixer Tool

This tool automatically **fixes and replaces** incorrect subtitle captions by detecting language mismatches and moving captions to the correct language slots.

## What It Does

Instead of just deleting incorrect captions, this tool:

1. **Detects Language Mismatches**: Uses OpenRouter AI to compare actual content language vs filename language
2. **Fixes API.video Captions**: Moves captions from incorrect language slots to correct ones
3. **Renames Local Files**: Updates local VTT filenames to match the detected language
4. **Preserves Content**: Never deletes valid content, only moves it to the right place

## Key Features

- 🔧 **Fix and Replace**: Moves incorrect captions to correct language slots
- 🤖 **AI Language Detection**: Uses OpenRouter for accurate language identification
- 📝 **File Renaming**: Updates local filenames to match correct language
- 🔄 **Caption Replacement**: Handles cases where target language already has captions
- 📊 **Detailed Reporting**: Shows exactly what was fixed and moved
- ✅ **Safe Operation**: Only works with allowed languages (ar, en, fr, es, it)

## Usage

```bash
# Fix all subtitle files in the /subtitles folder
node subtitle_fixer.js
```

## How It Works

### Example Scenario
You have a file named `[videoId]_Title_fr.vtt` but the content is actually in English:

**Before:**
- 📁 `[vi123]_MyVideo_fr.vtt` (contains English text)
- 🌐 API.video has French caption with English content

**After:**
- 📁 `[vi123]_MyVideo_en.vtt` (renamed to match English content)
- 🌐 API.video has English caption with English content
- 🗑️ French caption slot is cleaned up

### Process Flow

1. **Parse Filename**: Extract video ID and expected language
2. **Read Content**: Extract subtitle text from VTT file
3. **Detect Language**: Use AI to identify actual language of content
4. **Compare**: Check if filename language matches content language
5. **Fix Mismatch**: If mismatch found:
   - Delete existing caption in target language (if exists)
   - Delete incorrectly labeled caption
   - Upload content to correct language slot
   - Rename local file to match correct language

## Example Output

```
📋 Fixing: [vi057I5LKytkjaEW5eqOiJo]_Test_fr.vtt
🤖 AI detected language: "english" for text: "Hello world, this is..."
🔍 Detected language: english (en)
📍 Expected language: fr
❓ Language mismatch: YES

🔧 Language mismatch detected, fixing and replacing caption...
🔄 Moving caption from fr to en for video vi057I5LKytkjaEW5eqOiJo...
⚠️  Target language en already has a caption. Will replace it.
🗑️  Deleting en caption for video vi057I5LKytkjaEW5eqOiJo...
✅ Successfully deleted en caption
🗑️  Deleting fr caption for video vi057I5LKytkjaEW5eqOiJo...
📤 Uploading en caption for video vi057I5LKytkjaEW5eqOiJo...
✅ Successfully uploaded en caption
📝 Renamed local file: [vi057I5LKytkjaEW5eqOiJo]_Test_fr.vtt → [vi057I5LKytkjaEW5eqOiJo]_Test_en.vtt
✅ Successfully fixed caption: fr → en
```

## Configuration

Uses the same environment variables as other tools:

```env
# Required
APIVIDEO_API_KEY=your_api_key_here
OPENROUTER_API_KEY=your_openrouter_key_here

# Optional
OPENROUTER_MODEL=anthropic/claude-3-haiku
VTT_OUTPUT_FOLDER=./subtitles
DELAY_BETWEEN_FILES=2000
OPENROUTER_DELAY=3000
```

## Allowed Languages

Only processes and fixes captions in these languages:
- **ar** (Arabic)
- **en** (English) 
- **fr** (French)
- **es** (Spanish)
- **it** (Italian)

Files with content in other languages will be deleted.

## Actions Taken

The tool can perform these actions:

### `validated`
Caption is already correct, no action needed.

### `fixed_and_renamed`
- Fixed API.video caption by moving to correct language slot
- Renamed local file to match correct language

### `fixed_remote_only`
- Fixed API.video caption but couldn't rename local file

### `fixed_remote_caption`
- Fixed API.video caption, local filename was already correct

### `deleted_unsupported_language`
- Deleted file/caption with unsupported language

### `skipped`
- Skipped file (no video ID, no content, etc.)

### `fix_failed`
- Attempted to fix but encountered an error

## Report Generated

Creates `subtitle_fixing_report.json` with detailed results:

```json
{
  "timestamp": "2025-05-31T19:56:58.703Z",
  "summary": {
    "totalFiles": 3,
    "successCount": 2,
    "errorCount": 1,
    "fixedCount": 1,
    "renamedCount": 1,
    "allowedLanguages": ["ar", "en", "fr", "es", "it"]
  },
  "results": [
    {
      "success": true,
      "filename": "[vi057I5LKytkjaEW5eqOiJo]_Test_fr.vtt",
      "videoId": "vi057I5LKytkjaEW5eqOiJo",
      "expectedLanguage": "fr",
      "detectedLanguage": "en",
      "isLanguageMismatch": true,
      "action": "fixed_and_renamed",
      "newFilename": "[vi057I5LKytkjaEW5eqOiJo]_Test_en.vtt"
    }
  ]
}
```

## API Operations

The tool performs these API.video operations:

### GET Captions
```
GET https://ws.api.video/videos/{videoId}/captions
```
Check existing captions before making changes.

### DELETE Caption
```
DELETE https://ws.api.video/videos/{videoId}/captions/{language}
```
Remove incorrectly labeled captions.

### POST Caption
```
POST https://ws.api.video/videos/{videoId}/captions/{language}
```
Upload caption to correct language slot.

## Error Handling

- **Rate Limiting**: Automatic delays and retries
- **Existing Captions**: Replaces captions if target language already exists
- **Authentication**: Token refresh and caching
- **File Operations**: Safe file renaming with error recovery
- **API Errors**: Graceful handling of API failures

## Best Practices

1. **Backup First**: Keep backups of important subtitle files
2. **Review Reports**: Check fixing reports before bulk operations
3. **Test Small Batches**: Start with a few files to verify behavior
4. **Monitor API Usage**: Be aware of API rate limits
5. **Verify Results**: Check API.video to confirm captions are correctly placed

## When to Use

Use this tool when you have:
- VTT files with incorrect language labels in filenames
- API.video captions in wrong language slots
- Mixed up caption languages that need to be reorganized
- Need to ensure caption consistency across your video library

## Comparison with Other Tools

| Tool | Purpose | Action |
|------|---------|--------|
| `subtitles_validator.js` | Validate and delete incorrect | Deletes mismatched content |
| `caption_cleanup_tool.js` | Remove non-allowed languages | Deletes unwanted languages |
| `subtitle_fixer.js` | Fix and replace incorrect | **Moves content to correct place** |

The subtitle fixer is the **most sophisticated** tool that preserves your content while ensuring it's in the right place. 