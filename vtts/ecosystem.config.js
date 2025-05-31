module.exports = {
  apps: [
    {
      name: 'caption-completion-checker',
      script: 'captionCompletionChecker.js',
      env: {
        NODE_ENV: 'production',
        MAX_VIDEOS_TO_CHECK: null, // Check all videos
        DELAY_BETWEEN_REQUESTS: 1000,
        COMPLETION_OUTPUT_FILE: './caption_completion_report.json'
      },
      args: '--no-upload', // Just check, don't upload automatically
      max_memory_restart: '1G',
      restart_delay: 5000,
      watch: false,
      autorestart: false, // Don't restart automatically for one-time tasks
      log_file: './logs/caption-completion-checker.log',
      error_file: './logs/caption-completion-checker-error.log',
      out_file: './logs/caption-completion-checker-out.log',
      time: true
    },
    {
      name: 'universal-caption-uploader',
      script: 'universalCaptionUploader.js',
      env: {
        NODE_ENV: 'production',
        DELAY_BETWEEN_REQUESTS: 1000,
        UNIVERSAL_OUTPUT_FILE: './universal_caption_upload_report.json',
        SUBTITLES_FOLDER: './subtitles',
        PM2_MODE: 'true'
      },
      max_memory_restart: '1G',
      restart_delay: 5000,
      watch: false,
      autorestart: false, // Don't restart automatically for one-time tasks
      log_file: './logs/universal-caption-uploader.log',
      error_file: './logs/universal-caption-uploader-error.log',
      out_file: './logs/universal-caption-uploader-out.log',
      time: true
    },
    {
      name: 'caption-language-validator',
      script: 'captionLanguageValidator.js',
      env: {
        NODE_ENV: 'production',
        MAX_VIDEOS_TO_CHECK: null, // Validate all videos
        DELAY_BETWEEN_VIDEOS: 1000,
        DELAY_BETWEEN_CAPTIONS: 500,
        OPENROUTER_DELAY: 3000,
        OUTPUT_FILE: './caption_validation_report.json'
      },
      max_memory_restart: '1G',
      restart_delay: 5000,
      watch: false,
      autorestart: false,
      log_file: './logs/caption-language-validator.log',
      error_file: './logs/caption-language-validator-error.log',
      out_file: './logs/caption-language-validator-out.log',
      time: true
    },
    {
      name: 'fast-caption-uploader',
      script: 'fastCaptionUploader.js',
      env: {
        NODE_ENV: 'production',
        DELAY_BETWEEN_REQUESTS: 1000,
        COMPLETION_REPORT_FILE: './caption_completion_report.json',
        FAST_UPLOAD_OUTPUT_FILE: './fast_caption_upload_report.json'
      },
      max_memory_restart: '1G',
      restart_delay: 5000,
      watch: false,
      autorestart: false,
      log_file: './logs/fast-caption-uploader.log',
      error_file: './logs/fast-caption-uploader-error.log',
      out_file: './logs/fast-caption-uploader-out.log',
      time: true
    },
    {
      name: 'caption-quick-sample-check',
      script: 'captionCompletionChecker.js',
      env: {
        NODE_ENV: 'production',
        MAX_VIDEOS_TO_CHECK: 50, // Quick sample of 50 videos
        DELAY_BETWEEN_REQUESTS: 500,
        COMPLETION_OUTPUT_FILE: './caption_sample_report.json'
      },
      args: '--no-upload',
      max_memory_restart: '500M',
      restart_delay: 5000,
      watch: false,
      autorestart: false,
      log_file: './logs/caption-quick-sample-check.log',
      error_file: './logs/caption-quick-sample-check-error.log',
      out_file: './logs/caption-quick-sample-check-out.log',
      time: true
    }
  ]
}; 