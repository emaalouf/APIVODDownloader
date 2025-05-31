require('dotenv').config();
const axios = require('axios');
const path = require('path');
const fs = require('fs');

/**
 * Configuration object for API.video downloader
 */
const config = {
    apiKey: process.env.API_VIDEO_KEY,
    outputFolder: process.env.OUTPUT_FOLDER || './downloads',
    apiUrl: 'https://ws.api.video/auth/api-key',
    tokenCacheFile: './.token_cache.json'
};

// In-memory token storage
let tokenCache = {
    access_token: null,
    refresh_token: null,
    expires_at: null,
    token_type: 'Bearer'
};

/**
 * Validates that required environment variables are set
 */
function validateConfig() {
    if (!config.apiKey) {
        throw new Error('API_VIDEO_KEY environment variable is required. Please set it in your .env file.');
    }
}

/**
 * Gets the configured output folder path
 */
function getOutputFolder() {
    return path.resolve(config.outputFolder);
}

/**
 * Loads token cache from file if it exists
 */
function loadTokenCache() {
    try {
        if (fs.existsSync(config.tokenCacheFile)) {
            const data = fs.readFileSync(config.tokenCacheFile, 'utf8');
            const cache = JSON.parse(data);
            
            // Validate cache structure
            if (cache && cache.access_token && cache.expires_at) {
                tokenCache = { ...tokenCache, ...cache };
                console.log('🔄 Loaded cached tokens from file');
                return true;
            }
        }
    } catch (error) {
        console.log('⚠️  Could not load token cache:', error.message);
    }
    return false;
}

/**
 * Saves token cache to file
 */
function saveTokenCache() {
    try {
        fs.writeFileSync(config.tokenCacheFile, JSON.stringify(tokenCache, null, 2));
        console.log('💾 Saved tokens to cache file');
    } catch (error) {
        console.log('⚠️  Could not save token cache:', error.message);
    }
}

/**
 * Checks if the current access token is expired or about to expire
 */
function isTokenExpired() {
    if (!tokenCache.access_token || !tokenCache.expires_at) {
        return true;
    }
    
    // Add 60 second buffer to avoid using tokens that expire very soon
    const bufferTime = 60 * 1000;
    const now = Date.now();
    const expiresAt = new Date(tokenCache.expires_at).getTime();
    
    return (now + bufferTime) >= expiresAt;
}

/**
 * Authenticates with API.video using the API key to get fresh tokens
 */
async function authenticateWithApiKey() {
    validateConfig();
    
    try {
        console.log('🔑 Authenticating with API.video using API key...');
        
        const response = await axios.post(config.apiUrl, {
            apiKey: config.apiKey
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data && response.data.access_token) {
            // Calculate expiration time
            const expiresIn = response.data.expires_in || 3600; // Default to 1 hour
            const expiresAt = new Date(Date.now() + (expiresIn * 1000));
            
            // Update cache
            tokenCache = {
                access_token: response.data.access_token,
                refresh_token: response.data.refresh_token,
                token_type: response.data.token_type || 'Bearer',
                expires_at: expiresAt.toISOString()
            };
            
            // Save to file
            saveTokenCache();
            
            console.log('✅ Authentication successful!');
            console.log('Token Type:', tokenCache.token_type);
            console.log('Expires At:', expiresAt.toLocaleString());
            console.log('Has Refresh Token:', !!tokenCache.refresh_token);
            
            return {
                access_token: tokenCache.access_token,
                refresh_token: tokenCache.refresh_token,
                token_type: tokenCache.token_type,
                expires_in: expiresIn,
                expires_at: tokenCache.expires_at
            };
        } else {
            throw new Error('No access token received in response');
        }

    } catch (error) {
        console.error('❌ Authentication failed:');
        
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Error:', error.response.data);
        } else if (error.request) {
            console.error('No response received:', error.request);
        } else {
            console.error('Error:', error.message);
        }
        
        throw error;
    }
}

/**
 * Refreshes the access token using the refresh token
 */
async function refreshAccessToken() {
    if (!tokenCache.refresh_token) {
        console.log('⚠️  No refresh token available, authenticating with API key...');
        return await authenticateWithApiKey();
    }
    
    try {
        console.log('🔄 Refreshing access token...');
        
        const response = await axios.post('https://ws.api.video/auth/refresh', {
            refreshToken: tokenCache.refresh_token
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data && response.data.access_token) {
            // Calculate expiration time
            const expiresIn = response.data.expires_in || 3600;
            const expiresAt = new Date(Date.now() + (expiresIn * 1000));
            
            // Update cache with new tokens
            tokenCache = {
                access_token: response.data.access_token,
                refresh_token: response.data.refresh_token || tokenCache.refresh_token,
                token_type: response.data.token_type || tokenCache.token_type,
                expires_at: expiresAt.toISOString()
            };
            
            // Save to file
            saveTokenCache();
            
            console.log('✅ Token refreshed successfully!');
            console.log('New Expires At:', expiresAt.toLocaleString());
            
            return {
                access_token: tokenCache.access_token,
                refresh_token: tokenCache.refresh_token,
                token_type: tokenCache.token_type,
                expires_in: expiresIn,
                expires_at: tokenCache.expires_at
            };
        } else {
            throw new Error('No access token received in refresh response');
        }

    } catch (error) {
        console.error('❌ Token refresh failed:', error.response?.data || error.message);
        console.log('🔑 Falling back to API key authentication...');
        
        // Clear invalid refresh token
        tokenCache.refresh_token = null;
        
        // Fall back to API key authentication
        return await authenticateWithApiKey();
    }
}

/**
 * Gets a valid access token, refreshing if necessary
 */
async function getAccessToken() {
    // Load cached tokens first
    loadTokenCache();
    
    // Check if current token is expired
    if (isTokenExpired()) {
        console.log('🔄 Access token expired or missing, getting new token...');
        
        if (tokenCache.refresh_token) {
            return await refreshAccessToken();
        } else {
            return await authenticateWithApiKey();
        }
    } else {
        console.log('✅ Using cached access token');
        return {
            access_token: tokenCache.access_token,
            refresh_token: tokenCache.refresh_token,
            token_type: tokenCache.token_type,
            expires_at: tokenCache.expires_at
        };
    }
}

/**
 * Makes an authenticated API request with automatic token refresh
 */
async function makeAuthenticatedRequest(requestConfig, retryCount = 0) {
    const maxRetries = 2;
    
    try {
        // Get valid access token
        const tokenData = await getAccessToken();
        
        // Add authorization header
        const config = {
            ...requestConfig,
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                ...requestConfig.headers
            }
        };
        
        // Make the request
        return await axios(config);
        
    } catch (error) {
        // If we get a 401 and haven't retried too many times, refresh token and retry
        if (error.response?.status === 401 && retryCount < maxRetries) {
            console.log(`🔄 Got 401 error, refreshing token and retrying (attempt ${retryCount + 1}/${maxRetries})...`);
            
            // Force refresh token
            tokenCache.expires_at = null;
            
            // Retry the request
            return await makeAuthenticatedRequest(requestConfig, retryCount + 1);
        }
        
        // Re-throw other errors or if we've exhausted retries
        throw error;
    }
}

/**
 * Clears the token cache (useful for testing or forcing re-authentication)
 */
function clearTokenCache() {
    tokenCache = {
        access_token: null,
        refresh_token: null,
        expires_at: null,
        token_type: 'Bearer'
    };
    
    try {
        if (fs.existsSync(config.tokenCacheFile)) {
            fs.unlinkSync(config.tokenCacheFile);
            console.log('🗑️  Cleared token cache file');
        }
    } catch (error) {
        console.log('⚠️  Could not delete token cache file:', error.message);
    }
    
    console.log('🗑️  Token cache cleared');
}

// Execute the function if this file is run directly
if (require.main === module) {
    const command = process.argv[2];
    
    if (command === 'clear') {
        clearTokenCache();
        console.log('Token cache cleared. Next authentication will use API key.');
    } else {
        getAccessToken()
            .then(tokenData => {
                console.log('\nToken data received successfully:');
                console.log(JSON.stringify({
                    token_type: tokenData.token_type,
                    expires_at: tokenData.expires_at,
                    has_access_token: !!tokenData.access_token,
                    has_refresh_token: !!tokenData.refresh_token
                }, null, 2));
            })
            .catch(error => {
                console.error('\nFailed to get access token:', error.message);
                process.exit(1);
            });
    }
}

module.exports = { 
    getAccessToken, 
    getOutputFolder, 
    config,
    makeAuthenticatedRequest,
    clearTokenCache,
    isTokenExpired,
    refreshAccessToken
}; 