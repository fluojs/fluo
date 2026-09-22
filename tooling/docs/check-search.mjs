import assert from 'node:assert/strict';

const origin = process.argv[2];
assert.ok(origin, 'Usage: node tooling/docs/check-search.mjs <site-origin>');

for (const locale of ['en', 'ko']) {
  const url = new URL('/api/search', origin);
  url.searchParams.set('query', 'fluo');
  url.searchParams.set('locale', locale);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200, `${locale}: ${await response.clone().text()}`);
  const results = await response.json();
  assert.ok(Array.isArray(results) && results.length > 0, `${locale}: expected search results`);
  assert.ok(results.every((result) => result.url.startsWith('/docs')),
    `${locale}: search returned a non-canonical URL`);
  console.log(`${locale}: search returned ${results.length} canonical English results`);
}
