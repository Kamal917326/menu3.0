import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractJobsFromHtml,
  extractLikelyJobLinks,
  extractStructuredJobPostings,
  normalizeJobPosting
} from "../scripts/sync-jobs.mjs";

const source = {
  name: "Acme Careers",
  company: "Acme",
  url: "https://example.com/careers"
};

describe("sync-jobs parser", () => {
  it("extracts schema.org JobPosting data from JSON-LD", () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "JobPosting",
              "title": "Store Manager",
              "datePosted": "2026-06-01",
              "employmentType": "FULL_TIME",
              "description": "<p>Lead store operations.</p>",
              "hiringOrganization": { "name": "Acme Retail" },
              "jobLocation": {
                "@type": "Place",
                "address": {
                  "addressLocality": "London",
                  "addressCountry": "UK"
                }
              },
              "url": "/jobs/store-manager"
            }
          </script>
        </head>
      </html>
    `;

    const postings = extractStructuredJobPostings(html);
    assert.equal(postings.length, 1);

    const job = normalizeJobPosting(postings[0], source);
    assert.deepEqual(
      {
        title: job.title,
        company: job.company,
        location: job.location,
        type: job.type,
        applyUrl: job.applyUrl,
        postedAt: job.postedAt
      },
      {
        title: "Store Manager",
        company: "Acme Retail",
        location: "London, UK",
        type: "Full Time",
        applyUrl: "https://example.com/jobs/store-manager",
        postedAt: "2026-06-01"
      }
    );
  });

  it("falls back to likely job links when structured data is absent", () => {
    const html = `
      <main>
        <a href="/about">About us</a>
        <a href="/applicant-privacy#california-notice">California Privacy Notice</a>
        <a href="#main">Back To Top</a>
        <a href="/jobs/customer-support">Customer Support Job</a>
        <a href="https://example.com/jobs/customer-support">Customer Support Job</a>
        <a href="/apply/warehouse-associate">Apply for Warehouse Associate</a>
      </main>
    `;

    const jobs = extractLikelyJobLinks(html, source);

    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].title, "Customer Support Job");
    assert.equal(jobs[0].applyUrl, "https://example.com/jobs/customer-support");
    assert.equal(jobs[1].title, "Apply for Warehouse Associate");
  });

  it("prefers structured postings over fallback links", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Software Engineer",
          "hiringOrganization": { "name": "Acme" },
          "url": "https://example.com/jobs/software-engineer"
        }
      </script>
      <a href="/jobs/marketing">Marketing job</a>
    `;

    const jobs = extractJobsFromHtml(html, source);

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].title, "Software Engineer");
  });
});
