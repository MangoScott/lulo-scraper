#!/usr/bin/env node
/**
 * Lulo Lead Scraper - CLI for GitHub Actions
 * 
 * Usage: node scrape-cli.js "dentists in dallas" --limit 10 --json
 */

const puppeteer = require('puppeteer');

async function scrapeGoogleMaps(query, limit) {
    console.error(`[Scraping] "${query}" (limit: ${limit})`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote'
        ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    const leads = [];

    try {
        const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
        console.error(`[Navigating] ${mapsUrl}`);

        await page.goto(mapsUrl, { waitUntil: 'networkidle2', timeout: 30000 });
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
            document.querySelectorAll('[role="feed"] > div > div > a').forEach(card => {
                const ariaLabel = card.getAttribute('aria-label') || '';
                const href = card.href || '';
                if (ariaLabel && ariaLabel.length > 3) {
                    const parts = ariaLabel.split('·').map(p => p.trim());
                    results.push({ name: parts[0] || ariaLabel, href, fullLabel: ariaLabel });
                }
            });
            return results;
        });

        console.error(`[Found] ${cards.length} businesses`);

        // Process each business
        for (let i = 0; i < Math.min(cards.length, limit); i++) {
            const biz = cards[i];
            console.error(`[Processing] ${biz.name}`);

            try {
                await page.goto(biz.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await new Promise(r => setTimeout(r, 2000));

                const details = await page.evaluate(() => {
                    const pageText = document.body.innerText || '';
                    const phoneMatch = pageText.match(/\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/);
                    const phone = phoneMatch ? `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}` : '';
                    const websiteLink = document.querySelector('a[data-item-id="authority"]')?.href
                        || document.querySelector('a[href*="http"]:not([href*="google"])')?.href || '';
                    const addressMatch = pageText.match(/\d+\s+[\w\s]+(?:St|Street|Ave|Avenue|Blvd|Dr|Rd)[^,]*,\s*[^,]+,\s*[A-Z]{2}\s*\d{5}/i);
                    return { phone, website: websiteLink, address: addressMatch ? addressMatch[0] : '' };
                });

                // Try to get email from website
                let email = '', description = '';
                if (details.website && details.website.startsWith('http')) {
                    try {
                        const bizPage = await browser.newPage();
                        await bizPage.setUserAgent('Mozilla/5.0');
                        await bizPage.goto(details.website, { waitUntil: 'domcontentloaded', timeout: 10000 });
                        const pageData = await bizPage.evaluate(() => {
                            const text = document.body.innerText || '';
                            const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
                            const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
                            return { email: emailMatch ? emailMatch[0] : '', description: metaDesc.slice(0, 150) };
                        });
                        email = pageData.email;
                        description = pageData.description;
                        await bizPage.close();
                    } catch (e) { }
                }

                leads.push({
                    name: biz.name,
                    phone: details.phone,
                    email,
                    website: details.website,
                    address: details.address,
                    description,
                    source: 'Google Maps'
                });
            } catch (err) {
                leads.push({ name: biz.name, phone: '', email: '', website: '', address: '', description: '', source: 'Google Maps' });
            }
            await new Promise(r => setTimeout(r, 1000));
        }
    } finally {
        await browser.close();
    }

    return leads;
}

// CLI
async function main() {
    const args = process.argv.slice(2);
    const query = args.find(a => !a.startsWith('--')) || '';
    const limitIdx = args.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 10;
    const jsonOutput = args.includes('--json');

    if (!query) {
        console.error('Usage: node scrape-cli.js "search query" --limit 10 --json');
        process.exit(1);
    }

    try {
        const leads = await scrapeGoogleMaps(query, limit);
        const result = { leads, count: leads.length, query, scrapedAt: new Date().toISOString() };

        if (jsonOutput) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(`Found ${leads.length} leads:`);
            leads.forEach(l => console.log(`  - ${l.name}: ${l.phone || 'no phone'} | ${l.email || 'no email'}`));
        }
    } catch (error) {
        console.error('Error:', error.message);
        // Important: Output valid JSON to stdout so it can be captured
        console.log(JSON.stringify({ error: error.message, leads: [], count: 0 }));
        process.exit(0); // Exit gracefully so artifact is created? Or fail? 
        // If we fail with 1, the `|| true` in bash handles it, but we want the JSON.
    }
}

main();
