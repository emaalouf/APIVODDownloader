require('dotenv').config();
const axios = require('axios');
const path = require('path');

/**
 * Configuration object for API.video downloader
 */
const config = {
    apiKey: process.env.API_VIDEO_KEY,
    outputFolder: process.env.OUTPUT_FOLDER || './downloads',
    apiUrl: 'https://ws.api.video/auth/api-key'
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
 * Authenticates with API.video using the provided API key and returns an access token
 */
async function getAccessToken() {
    validateConfig();
    
    try {
        console.log('Authenticating with API.video...');
        console.log('Output folder configured to:', getOutputFolder());
        
        const response = await axios.post(config.apiUrl, {
            apiKey: config.apiKey
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data && response.data.access_token) {
            console.log('Authentication successful!');
            console.log('Access Token:', response.data.access_token);
            console.log('Token Type:', response.data.token_type || 'Bearer');
            console.log('Expires In:', response.data.expires_in || 'Not specified');
            
            return response.data;
        } else {
            throw new Error('No access token received in response');
        }

    } catch (error) {
        console.error('Authentication failed:');
        
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error('Status:', error.response.status);
            console.error('Error:', error.response.data);
        } else if (error.request) {
            // The request was made but no response was received
            console.error('No response received:', error.request);
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('Error:', error.message);
        }
        
        throw error;
    }
}

// Execute the function if this file is run directly
if (require.main === module) {
    getAccessToken()
        .then(tokenData => {
            console.log('\nToken data received successfully:');
            console.log(JSON.stringify(tokenData, null, 2));
        })
        .catch(error => {
            console.error('\nFailed to get access token:', error.message);
            process.exit(1);
        });
}

module.exports = { getAccessToken, getOutputFolder, config }; 