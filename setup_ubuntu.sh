#!/bin/bash

# API.video Downloader & VTT Generator - Ubuntu Setup Script
# This script installs all required dependencies for Ubuntu Server

echo "🚀 Starting Ubuntu setup for API.video Downloader & VTT Generator..."
echo "=================================================="

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   echo "❌ This script should not be run as root. Please run as a regular user with sudo privileges."
   exit 1
fi

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js
echo "📦 Installing Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo "✅ Node.js installed: $(node --version)"
else
    echo "✅ Node.js already installed: $(node --version)"
fi

# Install FFmpeg
echo "📦 Installing FFmpeg..."
if ! command -v ffmpeg &> /dev/null; then
    sudo apt install ffmpeg -y
    echo "✅ FFmpeg installed: $(ffmpeg -version | head -n1)"
else
    echo "✅ FFmpeg already installed: $(ffmpeg -version | head -n1)"
fi

# Install Python and pip
echo "📦 Installing Python and pip..."
sudo apt install python3 python3-pip -y
echo "✅ Python installed: $(python3 --version)"
echo "✅ Pip installed: $(pip3 --version)"

# Install Whisper
echo "📦 Installing OpenAI Whisper..."
if ! command -v whisper &> /dev/null; then
    pip3 install openai-whisper
    
    # Add to PATH if needed
    if ! command -v whisper &> /dev/null; then
        echo 'export PATH=$PATH:~/.local/bin' >> ~/.bashrc
        export PATH=$PATH:~/.local/bin
    fi
    
    if command -v whisper &> /dev/null; then
        echo "✅ Whisper installed successfully"
    else
        echo "⚠️  Whisper installed but not in PATH. Please run: source ~/.bashrc"
    fi
else
    echo "✅ Whisper already installed"
fi

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
if [ -f "package.json" ]; then
    npm install
    echo "✅ Node.js dependencies installed"
else
    echo "⚠️  package.json not found. Please run this script from the project directory."
fi

# Create .env file if it doesn't exist
echo "⚙️  Setting up environment configuration..."
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "✅ Created .env file from .env.example"
    else
        cat > .env << 'EOF'
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
EOF
        echo "✅ Created default .env file"
    fi
    echo "⚠️  Please edit .env file with your API.video key:"
    echo "   nano .env"
else
    echo "✅ .env file already exists"
fi

# Create directories
echo "📁 Creating directories..."
mkdir -p downloads subtitles
chmod 755 downloads subtitles
echo "✅ Created downloads and subtitles directories"

# Install optional tools
echo "📦 Installing optional tools..."
sudo apt install screen htop curl wget git -y
echo "✅ Optional tools installed (screen, htop, curl, wget, git)"

# Create automation script
echo "📄 Creating automation script..."
cat > process_all.sh << 'EOF'
#!/bin/bash
echo "🎬 Starting complete video processing pipeline..."
echo "=================================================="

# Check if .env exists and has API key
if [ ! -f ".env" ]; then
    echo "❌ .env file not found. Please create it first."
    exit 1
fi

if ! grep -q "API_VIDEO_KEY=.*[a-zA-Z0-9]" .env; then
    echo "❌ API_VIDEO_KEY not set in .env file. Please configure it."
    exit 1
fi

# Download videos
echo "📹 Downloading videos from API.video..."
node videoDownloader.js

if [ $? -eq 0 ]; then
    echo "✅ Video download completed successfully"
    
    # Generate VTT files
    echo "📝 Generating VTT subtitle files..."
    node vttGenerator.js
    
    if [ $? -eq 0 ]; then
        echo "✅ VTT generation completed successfully"
        echo "🎉 All processing completed!"
        
        # Show summary
        video_count=$(find downloads -name "*.mp4" 2>/dev/null | wc -l)
        vtt_count=$(find subtitles -name "*.vtt" 2>/dev/null | wc -l)
        echo "📊 Summary:"
        echo "   Videos: $video_count"
        echo "   VTT files: $vtt_count"
    else
        echo "❌ VTT generation failed"
        exit 1
    fi
else
    echo "❌ Video download failed"
    exit 1
fi
EOF

chmod +x process_all.sh
echo "✅ Created process_all.sh automation script"

# Security setup
echo "🔒 Setting up security..."
chmod 600 .env
echo "✅ Secured .env file permissions"

# Test installations
echo "🧪 Testing installations..."
echo "Testing Node.js..."
node --version

echo "Testing FFmpeg..."
ffmpeg -version | head -n1

echo "Testing Python..."
python3 --version

echo "Testing Whisper..."
if command -v whisper &> /dev/null; then
    whisper --help | head -n1
else
    echo "⚠️  Whisper not in PATH. Run: source ~/.bashrc"
fi

echo ""
echo "🎉 Ubuntu setup completed!"
echo "=================================================="
echo ""
echo "📋 Next steps:"
echo "1. Edit your API key in .env file:"
echo "   nano .env"
echo ""
echo "2. Test authentication:"
echo "   node auth.js"
echo ""
echo "3. Download videos:"
echo "   node videoDownloader.js"
echo ""
echo "4. Generate VTT files:"
echo "   node vttGenerator.js"
echo ""
echo "5. Or run everything:"
echo "   ./process_all.sh"
echo ""
echo "📖 For detailed instructions, see:"
echo "   - README.md (general documentation)"
echo "   - UBUNTU_SETUP.md (Ubuntu-specific guide)"
echo ""
echo "🔧 System requirements met:"
echo "   ✅ Node.js (for application runtime)"
echo "   ✅ FFmpeg (for audio extraction)"
echo "   ✅ Python3 + pip (for Whisper)"
echo "   ✅ OpenAI Whisper (for local transcription)"
echo ""
echo "Happy processing! 🚀" 