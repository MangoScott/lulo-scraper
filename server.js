/**
 * Lulo Lead Scraper - Express API Server
 * 
 * Deploy to Render.com free tier for always-available scraping
 */

const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main scraping endpoint
app.get('/scrape', async (req, res) => {
    const query = req.query.q || req.query.query;
    const limit = parseInt(req.query.limit) || 10;

    if (!query || query.length < 3) {
        return res.status(400).json({ error: 'Query required (min 3 chars)' });
    }

    console.log(`[Scrape] Query: "${query}", Limit: ${limit}`);

    try {
        const leads = await scrapeGoogleMaps(query, limit);
        res.json({
            leads,
            count: leads.length,
            query,
            scrapedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('[Scrape] Error:', error.message);
        res.status(500).json({ error: error.message, leads: [], count: 0 });
    }
});

// POST endpoint for more options
app.post('/scrape', async (req, res) => {
    const { query, limit = 10 } = req.body;

    if (!query || query.length < 3) {
        return res.status(400).json({ error: 'Query required' });
    }

    try {
        const leads = await scrapeGoogleMaps(query, limit);
        res.json({
            leads,
            count: leads.length,
            query,
            scrapedAt: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message, leads: [], count: 0 });
    }
});

// The scraper function
async function scrapeGoogleMaps(query, limit) {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
            '--no-zygote'
        ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    const leads = [];

    try {
        // Navigate to Google Maps
        const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
        console.log(`[Scrape] Navigating to: ${mapsUrl}`);

        await page.goto(mapsUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait for results
        await page.waitForSelector('[role="feed"]', { timeout: 10000 }).catch(() => { });
        await new Promise(r => setTimeout(r, 3000));

        // Scroll to load more
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => {
                const feed = document.querySelector('[role="feed"]');
                if (feed) feed.scrollBy(0, 1000);
            });
            await new Promise(r => setTimeout(r, 1500));
        }

        // Get business cards
        const cards = await page.evaluate(() => {
            const results = [];
            const cards = document.querySelectorAll('[role="feed"] > div > div > a');

            cards.forEach(card => {
                const ariaLabel = card.getAttribute('aria-label') || '';
                const href = card.href || '';

                if (ariaLabel && ariaLabel.length > 3) {
                    const parts = ariaLabel.split('·').map(p => p.trim());
                    results.push({
                        name: parts[0] || ariaLabel,
                        href: href,
                        fullLabel: ariaLabel
                    });
                }
            });

            return results;
        });

        console.log(`[Scrape] Found ${cards.length} businesses`);

        // Process each business
        for (let i = 0; i < Math.min(cards.length, limit); i++) {
            const biz = cards[i];
            console.log(`[Scrape] Processing: ${biz.name}`);

            try {
                // Click to get details
                await page.goto(biz.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await new Promise(r => setTimeout(r, 2000));

                // Extract details using multiple methods
                const details = await page.evaluate(() => {
                    const pageText = document.body.innerText || '';
                    const pageHtml = document.body.innerHTML || '';

                    // Phone - find pattern in page text
                    const phoneMatch = pageText.match(/\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/);
                    const phone = phoneMatch ? `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}` : '';

                    // Website - look for website links
                    const websiteLink = document.querySelector('a[data-item-id="authority"]')?.href
                        || document.querySelector('a[href*="http"]:not([href*="google"])')?.href
                        || '';

                    // Address - find in text (street patterns)
                    const addressMatch = pageText.match(/\d+\s+[\w\s]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road)[^,]*,\s*[^,]+,\s*[A-Z]{2}\s*\d{5}/i);
                    const address = addressMatch ? addressMatch[0] : '';

                    return { phone, website: websiteLink, address };
                });

                // Try to get email from website
                let email = '';
                let description = '';

                if (details.website && details.website.startsWith('http')) {
                    try {
                        const bizPage = await browser.newPage();
                        await bizPage.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
                        await bizPage.goto(details.website, { waitUntil: 'domcontentloaded', timeout: 10000 });

                        const pageData = await bizPage.evaluate(() => {
                            const text = document.body.innerText || '';
                            const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
                            const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
                            return {
                                email: emailMatch ? emailMatch[0] : '',
                                description: metaDesc.slice(0, 150)
                            };
                        });

                        email = pageData.email;
                        description = pageData.description;
                        await bizPage.close();
                    } catch (e) {
                        // Website may be down
                    }
                }

                leads.push({
                    name: biz.name,
                    phone: details.phone,
                    email: email,
                    website: details.website,
                    address: details.address,
                    description: description,
                    source: 'Google Maps'
                });

            } catch (err) {
                // Add partial data
                leads.push({
                    name: biz.name,
                    phone: '',
                    email: '',
                    website: '',
                    address: '',
                    description: '',
                    source: 'Google Maps'
                });
            }

            // Rate limit
            await new Promise(r => setTimeout(r, 1000));
        }

    } finally {
        await browser.close();
    }

    return leads;
}

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Lulo Scraper running on port ${PORT}`);
    console.log(`📍 Health: http://localhost:${PORT}/health`);
    console.log(`🔍 Scrape: http://localhost:${PORT}/scrape?q=dentists+in+dallas`);
});
