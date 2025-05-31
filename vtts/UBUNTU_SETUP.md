# Ubuntu Server Setup Guide

This guide covers setting up the API.video Downloader & VTT Generator on Ubuntu Server.

## Prerequisites

### 1. Update System
```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Install Node.js
```bash
# Install Node.js 18+ (recommended)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### 3. Install FFmpeg
```bash
sudo apt install ffmpeg -y

# Verify installation
ffmpeg -version
```

### 4. Install Python and pip
```bash
sudo apt install python3 python3-pip -y

# Verify installation
python3 --version
pip3 --version
```

### 5. Install Whisper (Local Transcription)
```bash
# Install OpenAI Whisper
pip3 install openai-whisper

# Verify installation
whisper --help

# If whisper command not found, add to PATH
echo 'export PATH=$PATH:~/.local/bin' >> ~/.bashrc
source ~/.bashrc
```

## Project Setup

### 1. Clone/Upload Project Files
```bash
# If using git
git clone <your-repo-url>
cd APIVODDownloader

# Or upload files manually to your server
```

### 2. Install Node.js Dependencies
```bash
npm install
```

### 3. Configure Environment
```bash
# Copy environment template
cp .env.example .env

# Edit environment file
nano .env
```

Add your configuration to `.env`:
```bash
# API.video Configuration
API_VIDEO_KEY=your_api_video_key_here

# Folders
OUTPUT_FOLDER=./downloads
VTT_OUTPUT_FOLDER=./subtitles

# OpenAI API Key (optional - local Whisper will be used if not provided)
OPENAI_API_KEY=

# VTT Generation Settings
WHISPER_MODEL=base
SILENCE_THRESHOLD=0.01
MUSIC_DETECTION_ENABLED=true
```

## Usage on Ubuntu

### 1. Download Videos
```bash
node videoDownloader.js
```

### 2. Generate VTT Subtitles (Using Local Whisper)
```bash
node vttGenerator.js
```

### 3. Run in Background (Optional)
```bash
# Install screen for background processes
sudo apt install screen -y

# Start screen session
screen -S video-processing

# Run your commands
node videoDownloader.js
# Press Ctrl+A, then D to detach

# Reattach later
screen -r video-processing
```

## Whisper Models

Local Whisper supports different models with varying accuracy/speed:

| Model | Size | Speed | Quality |
|-------|------|-------|---------|
| `tiny` | 39 MB | Fastest | Basic |
| `base` | 74 MB | Fast | Good |
| `small` | 244 MB | Medium | Better |
| `medium` | 769 MB | Slow | Very Good |
| `large` | 1550 MB | Slowest | Best |

Change model in `.env`:
```bash
WHISPER_MODEL=small  # or tiny, base, medium, large
```

## Performance Optimization

### 1. System Resources
```bash
# Check available resources
free -h
df -h
htop
```

### 2. Batch Processing Settings
Edit `vttGenerator.js` to adjust processing delays:
```javascript
// Reduce delay for faster processing (line ~340)
await new Promise(resolve => setTimeout(resolve, 1000)); // was 2000
```

### 3. Parallel Processing (Advanced)
For large video collections, consider running multiple instances:
```bash
# Split video files into batches and process in parallel
# This requires custom scripting
```

## Troubleshooting

### Common Ubuntu Issues

#### FFmpeg Not Found
```bash
sudo apt update
sudo apt install ffmpeg -y
```

#### Whisper Not Found
```bash
# Add to PATH
echo 'export PATH=$PATH:~/.local/bin' >> ~/.bashrc
source ~/.bashrc

# Or install globally
sudo pip3 install openai-whisper
```

#### Permission Issues
```bash
# Fix file permissions
sudo chown -R $USER:$USER ./downloads ./subtitles
chmod -R 755 ./downloads ./subtitles
```

#### Disk Space Issues
```bash
# Check disk usage
df -h

# Clean up temporary files
sudo apt autoremove -y
sudo apt autoclean
```

#### Memory Issues
```bash
# Check memory usage
free -h

# For large videos, use smaller Whisper model
# Set WHISPER_MODEL=tiny in .env
```

## Automation Scripts

### 1. Complete Processing Script
Create `process_all.sh`:
```bash
#!/bin/bash
echo "Starting video download and VTT generation..."

# Download videos
echo "Downloading videos..."
node videoDownloader.js

# Generate VTT files
echo "Generating VTT files..."
node vttGenerator.js

echo "Processing complete!"
```

Make it executable:
```bash
chmod +x process_all.sh
./process_all.sh
```

### 2. Cron Job (Scheduled Processing)
```bash
# Edit crontab
crontab -e

# Add line to run daily at 2 AM
0 2 * * * cd /path/to/APIVODDownloader && ./process_all.sh >> /var/log/video-processing.log 2>&1
```

## Monitoring

### 1. Log Files
```bash
# Monitor real-time logs
tail -f /var/log/video-processing.log

# Check system logs
journalctl -f
```

### 2. Process Monitoring
```bash
# Monitor running processes
ps aux | grep node
htop
```

## Security Considerations

### 1. File Permissions
```bash
# Secure environment file
chmod 600 .env

# Secure directories
chmod 750 downloads subtitles
```

### 2. Firewall (if applicable)
```bash
# Basic UFW setup
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
```

## Performance Benchmarks

Typical processing times on Ubuntu server:

| Video Length | Whisper Model | Processing Time |
|-------------|---------------|-----------------|
| 10 minutes | tiny | ~2 minutes |
| 10 minutes | base | ~4 minutes |
| 10 minutes | small | ~8 minutes |
| 60 minutes | base | ~20 minutes |

*Times vary based on server specifications*

## Support

For Ubuntu-specific issues:
- Check `/var/log/syslog` for system errors
- Use `dmesg` for hardware/driver issues
- Monitor with `htop` for resource usage

For application issues:
- Check the main README.md
- Review error logs in the console output 