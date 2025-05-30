# Smart Caption Uploader for API.video

This system automatically uploads and updates VTT caption files to API.video, handling multiple languages and avoiding duplicates.

## 🎯 What It Does

The **Smart Caption Uploader** scans your VTT files, connects to API.video, and:

1. **Analyzes** all VTT files with video IDs in the format `[videoId]_title.vtt` and `[videoId]_title_lang.vtt`
2. **Checks existing captions** on API.video for each video
3. **Uploads new captions** if they don't exist
4. **Updates existing captions** if they already exist
5. **Cleans up temporary files** (removes `_temp.wav` files)
6. **Provides detailed progress** and summary reporting

## 📁 File Structure Expected

Your subtitles directory should contain files like:

```
subtitles/
├── [vi057I5LKytkjaEW5eqOiJo]_Emotional_Mastery-3.mp4.vtt       # Original
├── [vi057I5LKytkjaEW5eqOiJo]_Emotional_Mastery-3.mp4_ar.vtt    # Arabic
├── [vi057I5LKytkjaEW5eqOiJo]_Emotional_Mastery-3.mp4_en.vtt    # English
├── [vi057I5LKytkjaEW5eqOiJo]_Emotional_Mastery-3.mp4_es.vtt    # Spanish
├── [vi057I5LKytkjaEW5eqOiJo]_Emotional_Mastery-3.mp4_fr.vtt    # French
├── [vi057I5LKytkjaEW5eqOiJo]_Emotional_Mastery-3.mp4_it.vtt    # Italian
└── ...more videos with their language variants
```

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install @api.video/nodejs-client
```

### 2. Configure Environment Variables
Make sure your `.env` file has:
```bash
APIVIDEO_API_KEY=your_api_key_here
VTT_OUTPUT_FOLDER=./subtitles
CAPTION_LANGUAGES=ar,en,fr,es,it
```

### 3. Test First (Recommended)
```bash
# Analyze files without uploading
TEST_MODE=true node test-caption-upload.js
```

### 4. Dry Run
```bash
# See what would be uploaded without actually doing it
DRY_RUN=true node smart-caption-uploader.js
```

### 5. Full Upload
```bash
# Perform actual uploads
node smart-caption-uploader.js
```

## 📊 Scripts Overview

### `smart-caption-uploader.js`
**Main script** that performs the actual uploads/updates to API.video.

**Features:**
- Automatically detects video IDs from filenames
- Groups VTT files by video and language
- Checks existing captions on API.video
- Uploads new or updates existing captions
- Handles rate limiting with delays
- Comprehensive error handling and logging
- Cleanup of temporary WAV files

**Modes:**
- **Normal**: Uploads/updates captions
- **Dry Run**: Shows what would be done (set `DRY_RUN=true`)
- **Test Mode**: Analysis only, no API calls (set `TEST_MODE=true`)

### `test-caption-upload.js`
**Analysis script** that shows you what files would be processed.

**Shows:**
- How many videos and VTT files found
- Language distribution statistics
- Videos with complete vs. incomplete language sets
- Sample video IDs for testing
- Configuration validation

### `video-progress-checker.js`
**Progress tracker** that shows processing status.

**Shows:**
- Total videos vs. videos with VTT files
- Processing completion percentage
- Detailed file analysis

### `quick-status.js`
**Quick overview** of your processing pipeline.

**Shows:**
- Simple count of videos and VTT files
- Basic progress metrics

## 🛠️ Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `APIVIDEO_API_KEY` | *required* | Your API.video API key |
| `VTT_OUTPUT_FOLDER` | `./subtitles` | Directory containing VTT files |
| `CAPTION_LANGUAGES` | `ar,en,fr,es,it` | Supported language codes |
| `API_VIDEO_ENVIRONMENT` | `production` | `production` or `sandbox` |
| `DRY_RUN` | `false` | Set to `true` to simulate without uploading |
| `TEST_MODE` | `false` | Set to `true` for analysis without API calls |

### Supported Languages

| Code | Language | Native Name |
|------|----------|-------------|
| `ar` | Arabic | العربية |
| `en` | English | English |
| `fr` | French | Français |
| `es` | Spanish | Español |
| `it` | Italian | Italiano |

## 📈 Usage Examples

### Check What Files You Have
```bash
# Quick overview
node quick-status.js

# Detailed analysis
TEST_MODE=true node test-caption-upload.js
```

### Test Upload Process
```bash
# See what would be uploaded without doing it
DRY_RUN=true node smart-caption-uploader.js
```

### Upload Captions for Production
```bash
# Upload all new captions and update existing ones
node smart-caption-uploader.js
```

### Monitor Progress
```bash
# Check processing progress
node video-progress-checker.js
```

## 🔍 How It Works

### 1. **File Discovery**
- Scans `VTT_OUTPUT_FOLDER` for `.vtt` files
- Parses filenames to extract video IDs, titles, and languages
- Groups files by video ID

### 2. **API.video Integration**
- Connects to API.video using your API key
- For each video, fetches existing caption list
- Determines what needs uploading vs. updating

### 3. **Smart Processing**
- **New captions**: Uploads with appropriate language code
- **Existing captions**: Updates with new VTT content
- **Default language**: Sets English as default if no default exists
- **Rate limiting**: Adds delays between requests

### 4. **Error Handling**
- Handles videos not found on API.video
- Retries failed uploads
- Comprehensive error logging
- Continues processing even if individual videos fail

### 5. **Cleanup**
- Removes temporary WAV files after processing
- Provides detailed summary of operations

## 📋 Output Examples

### Analysis Output
```
🎬 Found 145 videos with VTT files
📄 Total VTT files: 725
🌐 Language distribution:
   ar: 145 files (20.0%)
   en: 145 files (20.0%)
   es: 145 files (20.0%)
   fr: 145 files (20.0%)
   it: 145 files (20.0%)
✅ Videos with complete language sets: 145/145
```

### Upload Progress
```
🎬 Processing video: vi057I5LKytkjaEW5eqOiJo (Emotional_Mastery-3.mp4)
📄 Found 5 VTT files for this video
📋 Existing captions: en
📤 Uploading ar caption for video vi057I5LKytkjaEW5eqOiJo...
✅ Successfully uploaded ar caption
🔄 Updating en caption for video vi057I5LKytkjaEW5eqOiJo...
✅ Successfully updated en caption
📈 Results: Uploaded Arabic, Updated English, Uploaded Spanish, Uploaded French, Uploaded Italian
```

### Final Summary
```
📊 Smart Caption Upload Summary:
============================================================
🎬 Total videos found: 145
✅ Videos processed: 145
⚠️  Videos skipped: 0
📤 New captions uploaded: 580
🔄 Existing captions updated: 145
❌ Failed operations: 0

🎉 Successfully completed 725 caption operations!
```

## 🚨 Important Notes

### Before Running

1. **Backup your data** - The script updates existing captions
2. **Test with a few videos first** - Use `DRY_RUN=true` mode
3. **Check your API quota** - Large uploads may hit rate limits
4. **Verify video IDs** - Make sure your videos exist on API.video

### Rate Limiting

The script includes built-in delays:
- 1 second between caption operations
- 2 seconds between videos
- Automatic retry for failed operations

### File Naming Requirements

Files must follow this exact format:
- `[videoId]_title.vtt` - Original file
- `[videoId]_title_lang.vtt` - Language-specific files

Invalid formats will be skipped with warnings.

## 🔧 Troubleshooting

### Common Issues

**"Video not found on API.video"**
- Video ID doesn't exist on your API.video account
- Check if you're using the correct environment (production vs sandbox)

**"API key not found"**
- Make sure `APIVIDEO_API_KEY` is set in your `.env` file
- Verify the API key is correct and has caption upload permissions

**"No videos with VTT files found"**
- Check that files are in the correct directory (`VTT_OUTPUT_FOLDER`)
- Verify filenames follow the required format with `[videoId]`

**Rate limiting errors**
- The script includes delays, but you may need to increase them
- Consider processing in smaller batches

### Debug Mode

Set environment variables for more detailed logging:
```bash
DEBUG_MODE=true node smart-caption-uploader.js
```

## 🎯 Next Steps After Upload

Once your captions are uploaded:

1. **Verify on API.video dashboard** - Check that captions appear correctly
2. **Test playback** - Ensure captions display properly in your video player
3. **Monitor analytics** - Track caption usage and engagement
4. **Set up automation** - Consider integrating this into your CI/CD pipeline

## 📞 Support

If you encounter issues:

1. Check the console output for specific error messages
2. Run in `DRY_RUN=true` mode to test without uploading
3. Use `TEST_MODE=true` to analyze files without API calls
4. Review API.video documentation for caption requirements 