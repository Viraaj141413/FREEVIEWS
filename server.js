const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const server = createServer(app);
const io = new Server(server);

app.use(express.static('static'));
app.use(express.json());

const userAgents = [
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', locale: 'en-US', region: 'United States' },
    { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', locale: 'en-GB', region: 'United Kingdom' },
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:112.0) Gecko/20100101 Firefox/112.0', locale: 'fr-FR', region: 'France' },
    { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1', locale: 'ja-JP', region: 'Japan' },
    { ua: 'Mozilla/5.0 (Linux; Android 14; SM-G993B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36', locale: 'de-DE', region: 'Germany' },
    { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.2 Safari/605.1.15', locale: 'es-ES', region: 'Spain' },
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/123.0.0.0', locale: 'en-AU', region: 'Australia' },
    { ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36', locale: 'pt-BR', region: 'Brazil' },
    { ua: 'Mozilla/5.0 (iPad; CPU OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1', locale: 'zh-CN', region: 'China' },
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36', locale: 'it-IT', region: 'Italy' }
];

function normalizeUrl(inputUrl) {
    let url = inputUrl.trim();
    if (!url.startsWith('http')) {
        url = 'https://' + url;
    }
    
    // Convert various YouTube formats to standard shorts URL
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        // Extract video ID from various formats
        let videoId = null;
        
        if (url.includes('/shorts/')) {
            videoId = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/)?.[1];
        } else if (url.includes('youtu.be/')) {
            videoId = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/)?.[1];
        } else if (url.includes('watch?v=')) {
            videoId = url.match(/watch\?v=([a-zA-Z0-9_-]+)/)?.[1];
        }
        
        if (videoId) {
            return `https://www.youtube.com/shorts/${videoId}`;
        }
    }
    
    return url;
}

function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanLikeScroll(page, direction = 'down') {
    const scrollAmount = getRandomDelay(100, 400);
    const steps = getRandomDelay(3, 8);
    
    for (let i = 0; i < steps; i++) {
        await page.evaluate((amount, dir) => {
            window.scrollBy(0, dir === 'down' ? amount : -amount);
        }, scrollAmount / steps, direction);
        await page.waitForTimeout(getRandomDelay(50, 150));
    }
}

async function humanLikeMouseMovement(page, viewport) {
    const startX = getRandomDelay(50, viewport.width - 50);
    const startY = getRandomDelay(50, viewport.height - 50);
    const endX = getRandomDelay(50, viewport.width - 50);
    const endY = getRandomDelay(50, viewport.height - 50);
    
    // Move mouse in a curved path
    const steps = getRandomDelay(10, 20);
    for (let i = 0; i <= steps; i++) {
        const progress = i / steps;
        const x = startX + (endX - startX) * progress + Math.sin(progress * Math.PI) * getRandomDelay(-20, 20);
        const y = startY + (endY - startY) * progress + Math.cos(progress * Math.PI) * getRandomDelay(-20, 20);
        
        await page.mouse.move(x, y);
        await page.waitForTimeout(getRandomDelay(20, 50));
    }
}

async function takeScreenshot(page, socketId, context) {
    try {
        const screenshot = await page.screenshot({ 
            fullPage: false,
            type: 'png',
            quality: 80
        });
        io.to(socketId).emit('screenshot', { 
            image: screenshot.toString('base64'), 
            context: context 
        });
        console.log(`Screenshot taken: ${context}`);
    } catch (error) {
        console.log(`Error taking screenshot: ${error.message}`);
    }
}

async function watchVideo(page, socketId, viewIndex, region) {
    try {
        console.log(`Waiting for video to load for view ${viewIndex} from ${region}`);
        io.to(socketId).emit('bot_update', { message: `Waiting for video to load for view ${viewIndex} from ${region}` });
        
        // Wait for video element with longer timeout
        await page.waitForSelector('video', { timeout: 15000 });
        
        // Take screenshot after video loads
        await takeScreenshot(page, socketId, `Video loaded for view ${viewIndex} from ${region}`);
        
        // Get video duration
        const videoDuration = await page.evaluate(() => {
            const video = document.querySelector('video');
            if (video && video.duration && !isNaN(video.duration)) {
                return video.duration;
            }
            return 30; // Default to 30 seconds if duration not available
        });
        
        console.log(`Video duration: ${videoDuration}s for view ${viewIndex} from ${region}`);
        io.to(socketId).emit('bot_update', { message: `Video duration: ${videoDuration}s for view ${viewIndex} from ${region}` });
        
        // Watch for a realistic amount of time (30-90% of video or minimum 3 seconds)
        const watchPercentage = Math.random() * 0.6 + 0.3; // 30-90%
        const watchTime = Math.max(3000, videoDuration * 1000 * watchPercentage);
        
        console.log(`Watching video for ${(watchTime/1000).toFixed(1)}s (${(watchPercentage*100).toFixed(1)}%) for view ${viewIndex} from ${region}`);
        io.to(socketId).emit('bot_update', { message: `Watching video for ${(watchTime/1000).toFixed(1)}s (${(watchPercentage*100).toFixed(1)}%) for view ${viewIndex} from ${region}` });
        
        // Simulate human watching behavior
        const intervals = Math.floor(watchTime / 2000); // Check every 2 seconds
        for (let i = 0; i < intervals; i++) {
            await page.waitForTimeout(2000);
            
            // Random human actions during video
            const action = Math.random();
            if (action < 0.1) {
                // 10% chance to pause and resume
                await page.keyboard.press('Space');
                await page.waitForTimeout(getRandomDelay(500, 2000));
                await page.keyboard.press('Space');
                console.log(`Paused/resumed video for view ${viewIndex} from ${region}`);
                io.to(socketId).emit('bot_update', { message: `Paused/resumed video for view ${viewIndex} from ${region}` });
            } else if (action < 0.2) {
                // 10% chance to adjust volume
                const volumeKey = Math.random() > 0.5 ? 'ArrowUp' : 'ArrowDown';
                await page.keyboard.press(volumeKey);
                console.log(`Adjusted volume for view ${viewIndex} from ${region}`);
                io.to(socketId).emit('bot_update', { message: `Adjusted volume for view ${viewIndex} from ${region}` });
            } else if (action < 0.3) {
                // 10% chance to move mouse
                const viewport = page.viewport();
                await humanLikeMouseMovement(page, viewport);
            }
            
            // Take periodic screenshots
            if (i % 3 === 0) {
                await takeScreenshot(page, socketId, `Watching video ${i*2}s for view ${viewIndex} from ${region}`);
            }
        }
        
        return true;
    } catch (error) {
        console.log(`Error watching video for view ${viewIndex} from ${region}: ${error.message}`);
        io.to(socketId).emit('bot_update', { message: `Error watching video for view ${viewIndex} from ${region}: ${error.message}` });
        return false;
    }
}

async function navigateToNextVideos(page, socketId, viewIndex, region, count = 3) {
    try {
        console.log(`Navigating to next ${count} videos for view ${viewIndex} from ${region}`);
        io.to(socketId).emit('bot_update', { message: `Navigating to next ${count} videos for view ${viewIndex} from ${region}` });
        
        for (let i = 0; i < count; i++) {
            // Scroll down to next video (YouTube Shorts navigation)
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(getRandomDelay(1000, 2000));
            
            // Wait for new video to load
            await page.waitForTimeout(getRandomDelay(2000, 4000));
            
            // Take screenshot of new video
            await takeScreenshot(page, socketId, `Next video ${i+1} loaded for view ${viewIndex} from ${region}`);
            
            // Watch this video for a shorter time
            const shortWatchTime = getRandomDelay(2000, 8000); // 2-8 seconds
            console.log(`Watching next video ${i+1} for ${(shortWatchTime/1000).toFixed(1)}s for view ${viewIndex} from ${region}`);
            io.to(socketId).emit('bot_update', { message: `Watching next video ${i+1} for ${(shortWatchTime/1000).toFixed(1)}s for view ${viewIndex} from ${region}` });
            
            await page.waitForTimeout(shortWatchTime);
            
            // Random human actions
            const action = Math.random();
            if (action < 0.15) {
                // 15% chance to like the video
                try {
                    const likeSelectors = [
                        'button[aria-label*="like"]',
                        'button[title*="like"]',
                        '#like-button',
                        'button[data-e2e="like-button"]',
                        '.like-button'
                    ];
                    
                    for (const selector of likeSelectors) {
                        try {
                            await page.click(selector, { timeout: 1000 });
                            console.log(`Liked video ${i+1} for view ${viewIndex} from ${region}`);
                            io.to(socketId).emit('bot_update', { message: `Liked video ${i+1} for view ${viewIndex} from ${region}` });
                            break;
                        } catch (e) {
                            // Try next selector
                        }
                    }
                } catch (e) {
                    // Like button not found or not clickable
                }
            } else if (action < 0.25) {
                // 10% chance to scroll comments
                await humanLikeScroll(page, 'down');
                await page.waitForTimeout(getRandomDelay(1000, 2000));
                await humanLikeScroll(page, 'up');
            }
        }
        
        return true;
    } catch (error) {
        console.log(`Error navigating to next videos for view ${viewIndex} from ${region}: ${error.message}`);
        io.to(socketId).emit('bot_update', { message: `Error navigating to next videos for view ${viewIndex} from ${region}: ${error.message}` });
        return false;
    }
}

async function processView(url, viewIndex, totalViews, socketId, browser) {
    let page;
    try {
        const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
        const { ua, locale, region } = userAgent;
        const isMobile = ua.includes('Mobile') || ua.includes('iPhone') || ua.includes('Android') || ua.includes('iPad');
        
        const viewport = {
            width: isMobile ? getRandomDelay(360, 414) : getRandomDelay(1200, 1920),
            height: isMobile ? getRandomDelay(640, 896) : getRandomDelay(800, 1080)
        };

        page = await browser.newPage();
        
        // Set user agent and viewport
        await page.setUserAgent(ua);
        await page.setViewport(viewport);
        
        // Set extra headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': locale,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none'
        });

        // Anti-detection measures
        await page.evaluateOnNewDocumentPreload(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            window.chrome = { runtime: {} };
            
            // Override permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
        });

        console.log(`Starting view ${viewIndex}/${totalViews} from ${region}`);
        io.to(socketId).emit('bot_update', { message: `Starting view ${viewIndex}/${totalViews} from ${region}` });

        // Navigate to the video with realistic loading time
        const response = await page.goto(url, { 
            waitUntil: 'networkidle2', 
            timeout: 30000 
        });
        
        if (!response || response.status() >= 400) {
            throw new Error(`Failed to load page: ${response ? response.status() : 'No response'}`);
        }

        console.log(`Page loaded successfully for view ${viewIndex}/${totalViews} from ${region}`);
        io.to(socketId).emit('bot_update', { message: `Page loaded successfully for view ${viewIndex}/${totalViews} from ${region}` });

        // Wait for page to fully load
        await page.waitForTimeout(getRandomDelay(2000, 4000));

        // Handle cookie consent and popups
        try {
            const cookieSelectors = [
                'button[aria-label*="Accept"]',
                'button[aria-label*="consent"]',
                'button:contains("Accept all")',
                '[data-testid="accept-button"]',
                '.cookie-accept'
            ];
            
            for (const selector of cookieSelectors) {
                try {
                    await page.click(selector, { timeout: 2000 });
                    await page.waitForTimeout(1000);
                    console.log(`Accepted cookies for view ${viewIndex} from ${region}`);
                    io.to(socketId).emit('bot_update', { message: `Accepted cookies for view ${viewIndex} from ${region}` });
                    break;
                } catch (e) {
                    // Try next selector
                }
            }
        } catch (e) {
            // No cookie popup found
        }

        // Take initial screenshot
        await takeScreenshot(page, socketId, `Initial page load for view ${viewIndex} from ${region}`);

        // Watch the main video
        const videoWatched = await watchVideo(page, socketId, viewIndex, region);
        
        if (!videoWatched) {
            console.log(`Failed to watch video for view ${viewIndex} from ${region}`);
            io.to(socketId).emit('bot_update', { message: `Failed to watch video for view ${viewIndex} from ${region}` });
            return;
        }

        // Navigate and watch next few videos
        await navigateToNextVideos(page, socketId, viewIndex, region, getRandomDelay(2, 4));

        // Final human-like actions
        const viewport_final = page.viewport();
        await humanLikeMouseMovement(page, viewport_final);
        await page.waitForTimeout(getRandomDelay(1000, 3000));

        console.log(`Successfully completed view ${viewIndex}/${totalViews} from ${region}`);
        io.to(socketId).emit('bot_update', { message: `Successfully completed view ${viewIndex}/${totalViews} from ${region}` });

        // Final screenshot
        await takeScreenshot(page, socketId, `Final state for view ${viewIndex} from ${region}`);

    } catch (error) {
        console.log(`Error processing view ${viewIndex}/${totalViews}: ${error.message}`);
        io.to(socketId).emit('bot_update', { message: `Error processing view ${viewIndex}/${totalViews}: ${error.message}` });
    } finally {
        if (page) {
            await page.close().catch(e => console.log(`Error closing page: ${e.message}`));
        }
    }
}

async function runViewBot(url, views, socketId) {
    const normalizedUrl = normalizeUrl(url);
    
    // Validate YouTube Shorts URL
    if (!normalizedUrl.includes('youtube.com/shorts/')) {
        io.to(socketId).emit('bot_update', { message: 'Invalid URL. Only YouTube Shorts URLs are supported.' });
        return;
    }

    let browser;
    try {
        // Launch browser with realistic settings
        browser = await puppeteer.launch({
            headless: true, // Set to false to see browser windows
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-features=VizDisplayCompositor',
                '--window-size=1280,720'
            ],
            defaultViewport: {
                width: 1280,
                height: 720
            }
        });

        console.log('Browser launched successfully');
        io.to(socketId).emit('bot_update', { message: 'Browser launched successfully' });

        // Process views sequentially to avoid detection
        for (let i = 0; i < Math.min(views, 100); i++) { // Limit to 100 views for safety
            await processView(normalizedUrl, i + 1, views, socketId, browser);
            
            // Random delay between views (10 seconds to 1 minute for testing)
            if (i < views - 1) { // Don't wait after the last view
                const delay = getRandomDelay(10000, 60000);
                console.log(`Waiting ${(delay/1000).toFixed(0)}s before next view...`);
                io.to(socketId).emit('bot_update', { message: `Waiting ${(delay/1000).toFixed(0)}s before next view...` });
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        console.log('Bot completed successfully');
        io.to(socketId).emit('bot_update', { message: 'Bot completed successfully' });

    } catch (error) {
        console.log(`Bot error: ${error.message}`);
        io.to(socketId).emit('bot_update', { message: `Bot error: ${error.message}` });
    } finally {
        if (browser) {
            await browser.close().catch(e => console.log(`Error closing browser: ${e.message}`));
        }
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

app.post('/start', async (req, res) => {
    let { url, views, socketId } = req.body;
    url = normalizeUrl(url);
    
    if (!url.includes('youtube.com/shorts/')) {
        return res.status(400).json({ error: 'Invalid URL. Only YouTube Shorts URLs are supported' });
    }
    
    if (!Number.isInteger(views) || views < 1 || views > 100) {
        return res.status(400).json({ error: 'Views must be between 1 and 100' });
    }
    
    // Don't await this - let it run in background
    runViewBot(url, views, socketId).catch(e => {
        console.log(`Bot error: ${e.message}`);
        io.to(socketId).emit('bot_update', { message: `Bot error: ${e.message}` });
    });
    
    res.status(200).json({ message: 'Bot started' });
});

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});