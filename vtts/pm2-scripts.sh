#!/bin/bash

# PM2 Caption Tools Management Scripts
# Usage: ./pm2-scripts.sh [command] [options]

set -e

echo "🔧 PM2 Caption Tools Manager"
echo "=============================="

case "$1" in
    "start-completion-check")
        echo "🚀 Starting Caption Completion Checker (All Videos)..."
        pm2 start ecosystem.config.js --only caption-completion-checker
        echo "✅ Started! Monitor with: pm2 logs caption-completion-checker"
        ;;
    
    "start-quick-check")
        echo "🚀 Starting Quick Sample Check (50 Videos)..."
        pm2 start ecosystem.config.js --only caption-quick-sample-check
        echo "✅ Started! Monitor with: pm2 logs caption-quick-sample-check"
        ;;
    
    "start-universal-upload")
        echo "🚀 Starting Universal Caption Uploader..."
        pm2 start ecosystem.config.js --only universal-caption-uploader
        echo "✅ Started! Monitor with: pm2 logs universal-caption-uploader"
        ;;
    
    "start-validator")
        echo "🚀 Starting Caption Language Validator..."
        pm2 start ecosystem.config.js --only caption-language-validator
        echo "✅ Started! Monitor with: pm2 logs caption-language-validator"
        ;;
    
    "start-fast-upload")
        echo "🚀 Starting Fast Caption Uploader..."
        pm2 start ecosystem.config.js --only fast-caption-uploader
        echo "✅ Started! Monitor with: pm2 logs fast-caption-uploader"
        ;;
    
    "status")
        echo "📊 PM2 Process Status:"
        pm2 status
        ;;
    
    "logs")
        if [ -n "$2" ]; then
            echo "📄 Showing logs for: $2"
            pm2 logs "$2"
        else
            echo "📄 Showing all caption tool logs:"
            pm2 logs --grep "caption"
        fi
        ;;
    
    "stop")
        if [ -n "$2" ]; then
            echo "🛑 Stopping: $2"
            pm2 stop "$2"
        else
            echo "🛑 Stopping all caption processes..."
            pm2 stop caption-completion-checker caption-quick-sample-check universal-caption-uploader caption-language-validator fast-caption-uploader 2>/dev/null || true
        fi
        ;;
    
    "restart")
        if [ -n "$2" ]; then
            echo "🔄 Restarting: $2"
            pm2 restart "$2"
        else
            echo "🔄 Restarting all caption processes..."
            pm2 restart caption-completion-checker caption-quick-sample-check universal-caption-uploader caption-language-validator fast-caption-uploader 2>/dev/null || true
        fi
        ;;
    
    "delete")
        if [ -n "$2" ]; then
            echo "🗑️  Deleting: $2"
            pm2 delete "$2"
        else
            echo "🗑️  Deleting all caption processes..."
            pm2 delete caption-completion-checker caption-quick-sample-check universal-caption-uploader caption-language-validator fast-caption-uploader 2>/dev/null || true
        fi
        ;;
    
    "monitor")
        echo "📊 Opening PM2 Monitor..."
        pm2 monit
        ;;
    
    "save")
        echo "💾 Saving PM2 process list..."
        pm2 save
        ;;
    
    "startup")
        echo "🔄 Setting up PM2 startup script..."
        pm2 startup
        ;;
    
    "workflow")
        echo "🎯 Complete Caption Workflow"
        echo "=============================="
        echo ""
        echo "Step 1: Quick Check (50 videos sample)"
        read -p "Press Enter to start quick check..."
        pm2 start ecosystem.config.js --only caption-quick-sample-check
        
        echo ""
        echo "⏳ Waiting for quick check to complete..."
        while pm2 status | grep -q "caption-quick-sample-check.*online"; do
            sleep 5
        done
        
        echo ""
        echo "Step 2: Full Completion Check (all videos)"
        read -p "Press Enter to start full completion check..."
        pm2 start ecosystem.config.js --only caption-completion-checker
        
        echo ""
        echo "⏳ Waiting for completion check to finish..."
        while pm2 status | grep -q "caption-completion-checker.*online"; do
            sleep 10
        done
        
        echo ""
        echo "Step 3: Upload Missing Captions"
        echo "📋 Check the completion report, then:"
        echo "   ./pm2-scripts.sh start-universal-upload"
        ;;
    
    "help"|"")
        echo "Available commands:"
        echo ""
        echo "🔍 Checking Commands:"
        echo "  start-quick-check      - Check 50 videos sample"
        echo "  start-completion-check - Check all videos for completion"
        echo "  start-validator        - Validate caption languages"
        echo ""
        echo "📤 Upload Commands:"
        echo "  start-universal-upload - Upload all VTT files from subtitles folder"
        echo "  start-fast-upload      - Upload from completion report"
        echo ""
        echo "📊 Management Commands:"
        echo "  status                 - Show PM2 process status"
        echo "  logs [process-name]    - Show logs (all if no name specified)"
        echo "  stop [process-name]    - Stop process(es)"
        echo "  restart [process-name] - Restart process(es)"
        echo "  delete [process-name]  - Delete process(es)"
        echo "  monitor               - Open PM2 monitor"
        echo ""
        echo "🎯 Workflow Commands:"
        echo "  workflow              - Run complete caption workflow"
        echo "  save                  - Save PM2 process list"
        echo "  startup               - Setup PM2 startup script"
        echo ""
        echo "Examples:"
        echo "  ./pm2-scripts.sh start-quick-check"
        echo "  ./pm2-scripts.sh logs caption-completion-checker"
        echo "  ./pm2-scripts.sh status"
        echo "  ./pm2-scripts.sh stop universal-caption-uploader"
        ;;
    
    *)
        echo "❌ Unknown command: $1"
        echo "Run './pm2-scripts.sh help' for available commands"
        exit 1
        ;;
esac 