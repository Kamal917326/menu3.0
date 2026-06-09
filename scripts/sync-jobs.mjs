import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SOURCES_PATH = resolve("config/sources.json");
const DEFAULT_OUTPUT_PATH = resolve("public/data/jobs.json");
const USER_AGENT =
  "JobBridgeBot/0.1 (+https://example.com; contact=owner@example.com)";
const DEFAULT_FALLBACK_EXCLUDES = [
  "accessibility",
  "applicant-privacy",
  "back to top",
  "cookie",
  "diversity",
  "franchise",
  "inclusion",
  "privacy",
  "terms"
];
const ROLE_TITLE_PATTERN =
  /\b(associate|assistant|cashier|cook|crew|customer|developer|driver|engineer|intern|lead|manager|nurse|specialist|support|warehouse)\b/i;
const JOB_URL_PATTERN =
  /\/(apply|job|jobs|opening|openings|position|positions|role|roles|vacancy|vacancies)(\/|$|[?#-])/i;

export async function syncJobs({
  sourcesPath = DEFAULT_SOURCES_PATH,
  outputPath = DEFAULT_OUTPUT_PATH,
  fetchImpl = fetch
} = {}) {
  const sources = await loadSources(sourcesPath);
  const enabledSources = sources.filter((source) => source.enabled !== false);
  const jobs = [];
  const failures = [];

  for (const source of enabledSources) {
    try {
      const html = await fetchCareerPage(source, fetchImpl);
      jobs.push(...extractJobsFromHtml(html, source));
      await wait(300);
    } catch (error) {
      failures.push({ source: source.name || source.url, message: error.message });
    }
  }

  const feed = {
    generatedAt: new Date().toISOString(),
    demo: false,
    failures,
    jobs: dedupeJobs(jobs).sort((a, b) => {
      return `${a.company} ${a.title}`.localeCompare(`${b.company} ${b.title}`);
    })
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(feed, null, 2)}\n`, "utf8");

  return feed;
}

export async function loadSources(sourcesPath = DEFAULT_SOURCES_PATH) {
  const raw = await readFile(sourcesPath, "utf8");
  const sources = JSON.parse(raw);

  if (!Array.isArray(sources)) {
    throw new Error("config/sources.json must contain an array of sources");
  }

  return sources.map(validateSource);
}

export async function fetchCareerPage(source, fetchImpl = fetch) {
  const response = await fetchImpl(source.url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": source.userAgent || USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}`);
  }

  return response.text();
}

export function extractJobsFromHtml(html, source) {
  const structuredJobs = extractStructuredJobPostings(html)
    .map((posting) => normalizeJobPosting(posting, source))
    .filter(Boolean);

  if (structuredJobs.length > 0) {
    return structuredJobs;
  }

  return extractLikelyJobLinks(html, source);
}

export function extractStructuredJobPostings(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  return scripts.flatMap(([, scriptContent]) => {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(scriptContent.trim()));
      return findJobPostings(parsed);
    } catch {
      return [];
    }
  });
}

export function normalizeJobPosting(posting, source) {
  const title = cleanText(posting.title || posting.name);

  if (!title) {
    return null;
  }

  const applyUrl = absoluteUrl(
    firstString(posting.url, posting.sameAs, posting.identifier?.url),
    source.url
  );
  const organization = posting.hiringOrganization || posting.organization || {};

  return {
    id: stableId(source.company || source.name, title, applyUrl || source.url),
    title,
    company:
      cleanText(firstString(organization.name, posting.company, source.company)) ||
      source.company ||
      source.name,
    location: formatLocation(posting.jobLocation) || source.defaultLocation || "See posting",
    type: formatEmploymentType(posting.employmentType),
    description:
      cleanText(stripHtml(posting.description || posting.responsibilities || "")) ||
      "View the original posting for the full job description.",
    sourceName: source.name,
    sourceUrl: source.url,
    applyUrl: applyUrl || source.url,
    postedAt: firstString(posting.datePosted, posting.validThrough, new Date().toISOString())
  };
}

export function extractLikelyJobLinks(html, source) {
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const jobs = [];

  for (const [, attributes, rawLabel] of anchors) {
    const href = getAttribute(attributes, "href");
    const label = cleanText(stripHtml(rawLabel));

    if (!href || !label || label.length < 4) {
      continue;
    }

    const url = absoluteUrl(href, source.url);

    if (!isLikelyFallbackJobLink({ label, url, source })) {
      continue;
    }

    jobs.push({
      id: stableId(source.company || source.name, label, url),
      title: toJobTitle(label),
      company: source.company || source.name,
      location: source.defaultLocation || "See posting",
      type: "See posting",
      description: "This role was discovered from a career-page link. Open the original posting for full details.",
      sourceName: source.name,
      sourceUrl: source.url,
      applyUrl: url,
      postedAt: new Date().toISOString()
    });
  }

  return dedupeJobs(jobs).slice(0, source.maxFallbackLinks || 25);
}

function isLikelyFallbackJobLink({ label, url, source }) {
  const signalText = `${label} ${url}`.toLowerCase();
  const excludedPatterns = [
    ...DEFAULT_FALLBACK_EXCLUDES,
    ...(source.fallbackExcludePatterns || [])
  ];

  if (matchesAnyPattern(signalText, excludedPatterns)) {
    return false;
  }

  if (source.fallbackIncludePatterns?.length) {
    return matchesAnyPattern(signalText, source.fallbackIncludePatterns);
  }

  const looksLikeRoleTitle = ROLE_TITLE_PATTERN.test(label);
  const hasJobUrl = JOB_URL_PATTERN.test(url);
  const isSearchPage =
    /\/jobs?([/?#]|$)|search-jobs|job-search|careers\/search/i.test(url) &&
    /\b(career|find|job|join|opening|opportunit|role|search)\b/i.test(label);

  return looksLikeRoleTitle || hasJobUrl || isSearchPage;
}

function validateSource(source) {
  if (!source || typeof source !== "object") {
    throw new Error("Each source must be an object");
  }

  if (!source.name || !source.url) {
    throw new Error("Each source requires name and url");
  }

  return source;
}

function findJobPostings(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(findJobPostings);
  }

  if (typeof value !== "object") {
    return [];
  }

  const type = value["@type"];
  const types = Array.isArray(type) ? type : [type];
  const isJobPosting = types.some((item) => String(item).toLowerCase() === "jobposting");
  const nestedValues = [
    value["@graph"],
    value.itemListElement,
    value.mainEntity,
    value.hasPart
  ].flatMap(findJobPostings);

  return isJobPosting ? [value, ...nestedValues] : nestedValues;
}

function dedupeJobs(jobs) {
  const seen = new Set();
  const uniqueJobs = [];

  for (const job of jobs) {
    const key = job.applyUrl
      ? slugify(job.applyUrl)
      : [job.company, job.title].map((value) => slugify(value)).join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueJobs.push(job);
  }

  return uniqueJobs;
}

function formatLocation(location) {
  if (!location) {
    return "";
  }

  if (Array.isArray(location)) {
    return location.map(formatLocation).filter(Boolean).join(" / ");
  }

  if (typeof location === "string") {
    return cleanText(location);
  }

  const address = location.address || location;

  if (typeof address === "string") {
    return cleanText(address);
  }

  return [
    address.addressLocality,
    address.addressRegion,
    address.addressCountry?.name || address.addressCountry
  ]
    .filter(Boolean)
    .map(cleanText)
    .join(", ");
}

function formatEmploymentType(type) {
  const values = Array.isArray(type) ? type : [type].filter(Boolean);

  if (values.length === 0) {
    return "See posting";
  }

  return values
    .map((value) => {
      return cleanText(String(value))
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
    })
    .join(" / ");
}

function firstString(...values) {
  for (const value of values.flat()) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return "";
}

function absoluteUrl(value, baseUrl) {
  if (!value) {
    return "";
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function getAttribute(attributes, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, "i");
  const match = attributes.match(pattern);
  return match?.[2] || "";
}

function matchesAnyPattern(value, patterns) {
  return patterns.some((pattern) => {
    return new RegExp(pattern, "i").test(value);
  });
}

function toJobTitle(label) {
  return cleanText(label)
    .replace(/\s*\|\s*.*/, "")
    .replace(/\s+-\s+Apply.*/i, "")
    .slice(0, 90);
}

function stripHtml(value) {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ");
}

function cleanText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stableId(...parts) {
  return slugify(parts.filter(Boolean).join("-")).slice(0, 120);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function wait(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);

if (isCli) {
  syncJobs()
    .then((feed) => {
      console.log(`Synced ${feed.jobs.length} jobs from config/sources.json`);

      if (feed.failures.length > 0) {
        console.warn(`Completed with ${feed.failures.length} source failure(s):`);
        feed.failures.forEach((failure) => {
          console.warn(`- ${failure.source}: ${failure.message}`);
        });
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
