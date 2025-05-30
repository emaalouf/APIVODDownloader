# API.video Downloader & VTT Generator

A Node.js application to download videos from API.video and generate VTT subtitle files with advanced audio analysis.

## Features

### Video Downloader
- 🔐 **Secure Authentication** via environment variables
- 📹 **Bulk Download** - Downloads all videos from your API.video account
- ⚡ **Smart Resume** - Skips already downloaded files
- 📊 **Progress Tracking** - Shows download progress and summary
- 🎯 **Configurable Output** - Set custom download folders

### VTT Generator
- 🎤 **AI Transcription** using OpenAI Whisper API
- 🔇 **Silence Detection** - Identifies and marks silent moments
- 🎵 **Music Detection** - Special handling for musical segments
- ⏱️ **Precise Timestamps** - WebVTT format with millisecond accuracy
- 🎛️ **Configurable Settings** - Adjustable silence thresholds and detection

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy your API key and settings to `.env`:
```bash
# API.video Configuration
API_VIDEO_KEY=your_api_video_key_here

# Folders
OUTPUT_FOLDER=./downloads
VTT_OUTPUT_FOLDER=./subtitles

# OpenAI API Key for Whisper transcription (required for VTT generation)
OPENAI_API_KEY=your_openai_api_key_here

# VTT Generation Settings
WHISPER_MODEL=base
SILENCE_THRESHOLD=0.01
MUSIC_DETECTION_ENABLED=true
```

### 3. Get API Keys
- **API.video Key**: From your API.video dashboard
- **OpenAI Key**: From [OpenAI Platform](https://platform.openai.com/api-keys) (for VTT transcription)

## Usage

### Download All Videos
```bash
node videoDownloader.js
```
This will:
- Authenticate with API.video
- Fetch all videos (handles pagination automatically)
- Download MP4 files to your configured folder
- Show progress and summary

### Generate VTT Subtitles
```bash
node vttGenerator.js
```
This will:
- Process all downloaded video files
- Extract audio and analyze for silence/music
- Generate transcriptions using OpenAI Whisper
- Create WebVTT subtitle files with special markers

### Authentication Only
```bash
node auth.js
```
Test authentication and view access token.

## Advanced Features

### Music & Silence Detection
The VTT generator includes intelligent audio analysis:

- **Silence Detection**: Identifies quiet segments using configurable thresholds
- **Music Identification**: Heuristic detection of musical content
- **Special Markers**: Adds `♪ text ♪` for music and `[Silence]` for quiet parts
- **Warnings**: Marks potentially musical segments as `[Possible Music]`

### Configuration Options

| Setting | Description | Default |
|---------|-------------|---------|
| `SILENCE_THRESHOLD` | Audio level threshold for silence detection | `0.01` |
| `MUSIC_DETECTION_ENABLED` | Enable/disable music detection heuristics | `true` |
| `WHISPER_MODEL` | OpenAI Whisper model to use | `base` |
| `OUTPUT_FOLDER` | Where to save downloaded videos | `./downloads` |
| `VTT_OUTPUT_FOLDER` | Where to save VTT subtitle files | `./subtitles` |

### File Structure
```
APIVODDownloader/
├── auth.js              # Authentication utilities
├── videoDownloader.js   # Main video download script
├── vttGenerator.js      # VTT subtitle generation
├── .env                 # Your configuration (not in git)
├── .env.example         # Example configuration
├── downloads/           # Downloaded video files (not in git)
├── subtitles/           # Generated VTT files (not in git)
└── README.md
```

## Example VTT Output

```vtt
WEBVTT

1
00:00:00.000 --> 00:00:05.000
Welcome to this video tutorial

2
00:00:05.000 --> 00:00:08.000
♪ Background music playing ♪ [Possible Music]

3
00:00:10.000 --> 00:00:15.000
Now let's dive into the main content

4
00:00:20.000 --> 00:00:22.000
[Silence]
```

## Requirements

- **Node.js** 14+ 
- **FFmpeg** (for audio processing)
- **OpenAI API Key** (for transcription)
- **API.video Account** with API key

### Installing FFmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install ffmpeg
```

**Windows:**
Download from [FFmpeg website](https://ffmpeg.org/download.html)

## Troubleshooting

### Common Issues

1. **FFmpeg not found**: Install FFmpeg and ensure it's in your PATH
2. **OpenAI API errors**: Check your API key and account billing
3. **Large files**: Increase timeout settings for very long videos
4. **Audio extraction fails**: Ensure video files are not corrupted

### Error Codes
- **401 Unauthorized**: Check your API.video key
- **429 Rate Limited**: Wait and retry, or add delays
- **500 Server Error**: API.video service issue, try again later

## Cost Considerations

- **API.video**: Check your plan's download limits
- **OpenAI Whisper**: ~$0.006 per minute of audio transcribed
- **Storage**: Videos and audio files can be large

## License

ISC

## Support

For issues with:
- **API.video API**: Check [API.video documentation](https://docs.api.video/)
- **OpenAI Whisper**: Check [OpenAI documentation](https://platform.openai.com/docs/)
- **This tool**: Open an issue in this repository 