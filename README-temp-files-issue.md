# Temporary WAV Files Issue - Root Cause and Solutions

## Problem Description

You noticed that your `subtitles/` directory had more `.wav` files than `.vtt` files. Specifically, files ending with `_temp.wav` were left behind while corresponding `.vtt` files were not generated.

## Root Causes

### 1. **Processing Failures**
- When VTT generation fails during transcription (Whisper errors, API timeouts, etc.)
- The audio extraction step succeeds (creates `_temp.wav`) but VTT generation fails
- The cleanup code in the `catch` block may not execute properly

### 2. **Worker Timeouts** 
- In parallel processing, workers have a 10-minute timeout
- If a video takes longer than the timeout, the worker gets terminated
- Original code didn't clean up temp files when workers timed out

### 3. **Worker Errors**
- If workers crash or encounter errors
- Temp files were not cleaned up in error scenarios

### 4. **Process Interruption**
- Manual termination (Ctrl+C) or system crashes
- No cleanup happens for interrupted processes

## Solutions Implemented

### 1. **Cleanup Script** (`cleanup-temp-files.js`)
```bash
node cleanup-temp-files.js
```
- Manually removes all `_temp.wav` files
- Shows statistics about remaining VTT files
- Safe to run anytime

### 2. **Improved Worker Error Handling**
Enhanced `parallelVttGenerator.js` with:
- Better temp file tracking in workers
- Cleanup on worker failures
- Cleanup on worker timeouts
- Cleanup on worker errors

### 3. **Final Cleanup Step**
Added final cleanup after parallel processing:
- Scans for any remaining temp files
- Removes them automatically
- Reports cleanup statistics

## Prevention Strategies

### 1. **Environment Configuration**
```bash
# Increase worker timeout for large files
WORKER_TIMEOUT=900000  # 15 minutes

# Reduce worker count if system is resource-constrained
MAX_WORKERS=2

# Process fewer videos per worker
BATCH_SIZE=1
```

### 2. **Regular Cleanup**
```bash
# Add to your workflow
node cleanup-temp-files.js
```

### 3. **Monitor Processing**
- Check logs for failed videos
- Run cleanup after processing sessions
- Monitor disk space during processing

## File Processing Flow

```
Video File (mp4)
    ↓
Audio Extraction → temp.wav created
    ↓
Whisper Transcription
    ↓
VTT Generation → .vtt created
    ↓
Cleanup → temp.wav deleted
```

**If any step fails after audio extraction, temp.wav is left behind**

## Troubleshooting

### Check Current Status
```bash
ls subtitles/*.wav | wc -l    # Count WAV files
ls subtitles/*.vtt | wc -l    # Count VTT files
```

### Manual Cleanup
```bash
node cleanup-temp-files.js
```

### Check Disk Space
```bash
du -sh subtitles/             # Directory size
df -h                         # Available disk space
```

### Processing Logs
- Look for timeout messages: `⏰ Worker timed out`
- Look for error messages: `❌ Worker error`
- Look for cleanup messages: `🗑️ Cleaned up temp file`

## Best Practices

1. **Start Small**: Test with a few videos first
2. **Monitor Resources**: Watch CPU, memory, and disk usage
3. **Regular Cleanup**: Run cleanup script periodically
4. **Check Whisper**: Ensure Whisper is properly installed
5. **Timeout Settings**: Adjust timeouts based on video length
6. **Batch Size**: Use smaller batches for large/complex videos

## Updated Features

The parallel processor now:
- ✅ Tracks temp files in workers
- ✅ Cleans up on worker failures
- ✅ Cleans up on worker timeouts  
- ✅ Cleans up on worker errors
- ✅ Performs final cleanup after processing
- ✅ Reports cleanup statistics
- ✅ More robust error handling 