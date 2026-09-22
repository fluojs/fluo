import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = process.argv[2];
if (!origin) throw new Error('Usage: node tooling/docs/check-site.mjs <origin>');
const base = new URL(origin);

async function discover(directory, prefix = '') {
  const pages = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) pages.push(...await discover(path.join(directory, entry.name), `${prefix}${entry.name}/`));
    else if (entry.name.endsWith('.mdx')) {
      const slug = `${prefix}${entry.name.slice(0, -4)}`.replace(/(^|\/)index$/, '');
      pages.push(`/docs/${slug}`.replace(/\/$/, ''));
    }
  }
  return pages;
}

const documents = new Map();
const failures = [];
async function documentFor(url) {
  const key = `${url.origin}${url.pathname}`;
  if (!documents.has(key)) {
    documents.set(key, (async () => {
      const response = await fetch(key, { signal: AbortSignal.timeout(20_000) });
      return { status: response.status, html: await response.text(), url: new URL(response.url) };
    })());
  }
  return documents.get(key);
}

const routes = await discover(path.join(root, 'apps/docs/content/docs'));
let links = 0;
for (const route of routes) {
  const page = await documentFor(new URL(route, base));
  if (page.status !== 200) {
    failures.push(`${route}: HTTP ${page.status}`);
    continue;
  }
  if (!/<html\b[^>]*lang="en"/.test(page.html)) failures.push(`${route}: wrong document language`);
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/.exec(page.html)?.[1];
  if (!article) {
    failures.push(`${route}: missing article`);
    continue;
  }
  for (const [, href] of article.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
    const target = new URL(href.replaceAll('&amp;', '&'), page.url);
    if (target.origin !== base.origin) continue;
    links++;
    const destination = await documentFor(target);
    if (destination.status !== 200) failures.push(`${route} -> ${href}: HTTP ${destination.status}`);
    else if (target.hash) {
      const id = decodeURIComponent(target.hash.slice(1));
      const ids = new Set([...destination.html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
      if (!ids.has(id)) failures.push(`${route} -> ${href}: missing anchor`);
    }
  }
}

for (const failure of [...new Set(failures)]) console.error(failure);
if (failures.length) process.exitCode = 1;
else console.log(`DOCS_SITE_PASS ${routes.length} pages, ${links} internal article links and anchors`);
