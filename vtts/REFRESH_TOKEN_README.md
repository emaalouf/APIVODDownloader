# Refresh Token Functionality

This document explains the new automatic token refresh functionality added to the API.video downloader.

## Overview

The authentication system now automatically handles token expiration and refresh, eliminating the need for manual token management. This ensures your scripts can run for extended periods without authentication failures.

## Key Features

### 🔄 Automatic Token Refresh
- Tokens are automatically refreshed when they expire
- Uses refresh tokens provided by the API.video authentication endpoint
- Falls back to API key authentication if refresh fails

### 💾 Token Caching
- Tokens are cached both in memory and on disk (`.token_cache.json`)
- Cached tokens are reused until they expire
- Cache survives script restarts

### 🔁 Automatic Retry
- API calls automatically retry with fresh tokens on 401 errors
- Maximum of 2 retry attempts to prevent infinite loops
- Graceful error handling for permanent failures

### ⏰ Expiration Handling
- 60-second buffer before expiration to avoid edge cases
- Proactive token refresh before expiration

## API Changes

### Enhanced `auth.js`

**New Functions:**
- `makeAuthenticatedRequest(requestConfig)` - Makes API calls with automatic token refresh
- `clearTokenCache()` - Clears cached tokens
- `isTokenExpired()` - Checks if current token is expired
- `refreshAccessToken()` - Manually refresh tokens

**Modified Functions:**
- `getAccessToken()` - Now handles caching and automatic refresh

### Updated `captionManager.js`

All functions now use the new authentication system:
- `getVideoCaptions(videoId)` - No longer requires accessToken parameter
- `deleteCaption(videoId, language)` - No longer requires accessToken parameter  
- `uploadCaption(videoId, vttFilePath, language)` - No longer requires accessToken parameter
- `manageVideoCaption(videoId, vttFilePath, language)` - No longer requires accessToken parameter

## Usage Examples

### Basic Usage (No Changes Required)
```javascript
// Your existing code continues to work unchanged
const { getAccessToken } = require('./auth.js');

const tokenData = await getAccessToken();
// Token is automatically refreshed if expired
```

### Making Authenticated API Calls
```javascript
const { makeAuthenticatedRequest } = require('./auth.js');

// API call with automatic token refresh
const response = await makeAuthenticatedRequest({
    method: 'GET',
    url: 'https://ws.api.video/videos',
    params: { pageSize: 10 }
});
```

### Manual Token Management
```javascript
const { clearTokenCache, isTokenExpired, refreshAccessToken } = require('./auth.js');

// Check if token is expired
if (isTokenExpired()) {
    console.log('Token is expired');
}

// Manually refresh token
const newTokenData = await refreshAccessToken();

// Clear token cache (forces re-authentication)
clearTokenCache();
```

## Testing

Run the test script to verify functionality:

```bash
# Basic refresh token test
node test-refresh-token.js

# Test API retry mechanism
node test-refresh-token.js retry

# Full test suite
node test-refresh-token.js full
```

## Authentication Management

### Clear Token Cache
```bash
# Clear cached tokens (useful for testing)
node auth.js clear
```

### View Token Status
```bash
# View current token information
node auth.js
```

## Error Handling

The system handles various error scenarios:

1. **Expired Access Token**: Automatically refreshed using refresh token
2. **Invalid Refresh Token**: Falls back to API key authentication  
3. **Network Errors**: Retries with exponential backoff
4. **API Errors**: Graceful error reporting with context

## Files Created/Modified

### New Files
- `.token_cache.json` - Token cache file (added to .gitignore)
- `test-refresh-token.js` - Test script for refresh functionality
- `REFRESH_TOKEN_README.md` - This documentation

### Modified Files
- `auth.js` - Enhanced with refresh token functionality
- `captionManager.js` - Updated to use new authentication system
- `.gitignore` - Added token cache file

## Benefits

1. **Zero Downtime**: Scripts can run indefinitely without authentication interruption
2. **Improved Reliability**: Automatic retry on auth failures
3. **Better Performance**: Token caching reduces authentication overhead
4. **Backward Compatibility**: Existing code continues to work unchanged
5. **Enhanced Security**: Tokens are stored securely and refreshed automatically

## Token Lifecycle

1. **Initial Authentication**: API key used to get access + refresh tokens
2. **Token Usage**: Access token used for API calls
3. **Expiration Detection**: System detects when token is about to expire
4. **Automatic Refresh**: Refresh token used to get new access token
5. **Fallback**: If refresh fails, re-authenticate with API key
6. **Cache Update**: New tokens saved to cache for future use

The system ensures continuous operation without manual intervention! 