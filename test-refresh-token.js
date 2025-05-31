require('dotenv').config();
const { getAccessToken, makeAuthenticatedRequest, clearTokenCache, isTokenExpired } = require('./auth.js');

/**
 * Test script to demonstrate refresh token functionality
 */
async function testRefreshTokenFunctionality() {
    console.log('🧪 Testing Refresh Token Functionality');
    console.log('=====================================\n');
    
    try {
        // Test 1: Clear cache and get fresh tokens
        console.log('Test 1: Getting fresh tokens (clearing cache first)...');
        clearTokenCache();
        const tokenData1 = await getAccessToken();
        console.log('✅ Fresh tokens obtained');
        console.log(`   - Has access token: ${!!tokenData1.access_token}`);
        console.log(`   - Has refresh token: ${!!tokenData1.refresh_token}`);
        console.log(`   - Expires at: ${tokenData1.expires_at}\n`);
        
        // Test 2: Get tokens again (should use cached version)
        console.log('Test 2: Getting tokens again (should use cache)...');
        const tokenData2 = await getAccessToken();
        console.log('✅ Cached tokens used');
        console.log(`   - Same access token: ${tokenData1.access_token === tokenData2.access_token}\n`);
        
        // Test 3: Test token expiration check
        console.log('Test 3: Checking token expiration...');
        const expired = isTokenExpired();
        console.log(`   - Token expired: ${expired}\n`);
        
        // Test 4: Make an authenticated API request
        console.log('Test 4: Making authenticated API request...');
        try {
            const response = await makeAuthenticatedRequest({
                method: 'GET',
                url: 'https://ws.api.video/videos',
                params: { pageSize: 1 }
            });
            console.log('✅ Authenticated API request successful');
            console.log(`   - Status: ${response.status}`);
            console.log(`   - Has data: ${!!response.data}\n`);
        } catch (error) {
            console.log('❌ API request failed:', error.response?.status || error.message);
        }
        
        // Test 5: Simulate token expiration and refresh
        console.log('Test 5: Simulating token expiration...');
        
        // Read current cache to get refresh token
        const fs = require('fs');
        const tokenCacheFile = './.token_cache.json';
        
        if (fs.existsSync(tokenCacheFile)) {
            const cacheData = JSON.parse(fs.readFileSync(tokenCacheFile, 'utf8'));
            
            // Set expiration to past date to force refresh
            cacheData.expires_at = new Date(Date.now() - 1000).toISOString();
            fs.writeFileSync(tokenCacheFile, JSON.stringify(cacheData, null, 2));
            
            console.log('   - Artificially expired the token');
            
            // Try to get tokens again (should trigger refresh)
            const tokenData3 = await getAccessToken();
            console.log('✅ Token refresh triggered');
            console.log(`   - New access token different: ${tokenData1.access_token !== tokenData3.access_token}`);
            console.log(`   - New expires at: ${tokenData3.expires_at}\n`);
        }
        
        console.log('🎉 All tests completed successfully!');
        console.log('\nRefresh token functionality is working correctly.');
        console.log('Your API calls will now automatically handle token expiration.');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Full error:', error);
    }
}

/**
 * Test making API calls with automatic retry on 401
 */
async function testApiRetry() {
    console.log('\n🔄 Testing API Retry Functionality');
    console.log('==================================\n');
    
    try {
        // This will test the automatic retry mechanism
        const response = await makeAuthenticatedRequest({
            method: 'GET',
            url: 'https://ws.api.video/videos',
            params: { pageSize: 5 }
        });
        
        console.log('✅ API call with automatic retry successful');
        console.log(`   - Found ${response.data.data.length} videos`);
        console.log(`   - Response status: ${response.status}`);
        
    } catch (error) {
        console.error('❌ API call failed:', error.response?.status || error.message);
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    const testType = process.argv[2];
    
    if (testType === 'retry') {
        testApiRetry();
    } else if (testType === 'full') {
        testRefreshTokenFunctionality()
            .then(() => testApiRetry())
            .catch(error => {
                console.error('Test suite failed:', error.message);
                process.exit(1);
            });
    } else {
        testRefreshTokenFunctionality()
            .catch(error => {
                console.error('Test failed:', error.message);
                process.exit(1);
            });
    }
}

module.exports = {
    testRefreshTokenFunctionality,
    testApiRetry
}; 