# Lulo Lead Scraper Microservice

A simple Express.js API that scrapes Google Maps for business leads.

## Deploy to Render.com (FREE)

1. Push this folder to a new GitHub repo
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** Free

## Local Development

```bash
cd scraper-service
npm install
npm start
# API runs on http://localhost:3001
```

## API Usage

```bash
# Search for leads
curl "http://localhost:3001/scrape?q=dentists+in+dallas&limit=10"

# Health check
curl "http://localhost:3001/health"
```

## Response Format

```json
{
  "leads": [
    {
      "name": "Smith Dental",
      "phone": "(555) 123-4567",
      "email": "info@smithdental.com",
      "website": "https://smithdental.com",
      "address": "123 Main St, Dallas TX"
    }
  ],
  "count": 10
}
```
