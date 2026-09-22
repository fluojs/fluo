import assert from 'node:assert/strict';

const origin = process.argv[2];
assert.ok(origin, 'Usage: node tooling/docs/check-english-site.mjs <origin>');

for (const oldPath of ['/en', '/ko', '/en/docs', '/ko/docs', '/en/docs/overview/modules', '/ko/docs/overview/modules']) {
  const response = await fetch(new URL(`${oldPath}?source=legacy`, origin), {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 308, oldPath);
  const destination = new URL(response.headers.get('location'), origin);
  const expected = oldPath.replace(/^\/(en|ko)/, '') || '/docs';
  assert.equal(destination.pathname, expected, oldPath);
  assert.equal(destination.searchParams.get('source'), 'legacy');
}

for (const route of ['/docs', '/docs/overview/modules', '/docs/getting-started/migrate-node24']) {
  const response = await fetch(new URL(route, origin), { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, route);
  const html = await response.text();
  assert.match(html, /<html[^>]+lang="en"/);
  assert.doesNotMatch(html, /href="\/(?:en|ko)\/docs/);
  assert.doesNotMatch(html, /Choose a language/);
}
console.log('ENGLISH_SITE_PASS: canonical pages, legacy redirects, query preservation, language controls');
