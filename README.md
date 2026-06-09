# JobBridge

JobBridge is a small job-aggregator MVP. It lists jobs from configured company
career pages in one searchable website and sends applicants back to the original
employer posting when they click a listing.

The first version is designed to be easy to host on Namecheap shared hosting:

- `public/` contains a static website that can be uploaded to cPanel.
- `config/sources.json` lists the company career pages to sync.
- `scripts/sync-jobs.mjs` fetches career pages and writes `public/data/jobs.json`.

## Requirements

- Node.js 18 or newer
- A static hosting folder such as Namecheap `public_html`

No npm packages are required for the current MVP.

## Run locally

```bash
npm run dev
```

Open <http://localhost:4173> in your browser.

## Sync job listings

Add or edit company sources in `config/sources.json`, then run:

```bash
npm run sync:jobs
```

The sync command writes `public/data/jobs.json`, which the website reads on page
load.

The scraper works best when a career page exposes
[schema.org `JobPosting`](https://schema.org/JobPosting) JSON-LD. If a site does
not expose structured job data, the script falls back to likely career/job links.
Many large companies render jobs with JavaScript or private APIs, so a future
version can add company-specific connectors for important sources.

## Test

```bash
npm test
```

## Deploy to Namecheap

1. Run `npm run sync:jobs` locally or on a server.
2. Upload the contents of the `public/` directory to your Namecheap
   `public_html` directory.
3. Visit your domain and verify the jobs load.

If your Namecheap plan supports cron jobs, you can run the sync command on a
schedule and keep `public/data/jobs.json` updated automatically. On shared
hosting without Node.js support, run the sync locally and upload the updated JSON
file whenever you want to refresh listings.

## How to add companies

Edit `config/sources.json`:

```json
[
  {
    "name": "McDonald's Careers",
    "company": "McDonald's",
    "url": "https://careers.mcdonalds.com/",
    "enabled": true
  }
]
```

Every listing stores the original `applyUrl`, so users apply on the official
career page instead of through JobBridge.

## Important notes

- Respect each website's terms of service and robots.txt.
- Keep sync frequency reasonable to avoid overloading company websites.
- Verify listings before publishing if the source site changes its layout.