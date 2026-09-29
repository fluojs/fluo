import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

import { enforceReactNavigationPayloadContract } from './react-navigation-payload-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const clientPath = 'packages/react/src/client/navigation-payload.ts';
const serverPath = 'packages/react/src/page-result.ts';
const transferPath = 'packages/react/src/navigation-payload.ts';
const storePath = 'packages/react/src/client/store.ts';
const historyPath = 'packages/react/src/client/history.ts';
const providerPath = 'packages/react/src/client/provider.ts';
const dispatchPath = 'packages/http/src/dispatch/dispatch-response-policy.ts';
const sources = new Map([
  [clientPath, readFileSync(resolve(repoRoot, clientPath), 'utf8')],
  [serverPath, readFileSync(resolve(repoRoot, serverPath), 'utf8')],
  [transferPath, readFileSync(resolve(repoRoot, transferPath), 'utf8')],
  [storePath, readFileSync(resolve(repoRoot, storePath), 'utf8')],
  [historyPath, readFileSync(resolve(repoRoot, historyPath), 'utf8')],
  [providerPath, readFileSync(resolve(repoRoot, providerPath), 'utf8')],
  [dispatchPath, readFileSync(resolve(repoRoot, dispatchPath), 'utf8')],
]);

it('accepts the current matching HTTP and browser navigation machine contract', () => {
  expect(() => enforceReactNavigationPayloadContract((path: string) => sources.get(path) ?? '')).not.toThrow();
});

it.each([
  [clientPath, "const MEDIA_TYPE = 'application/vnd.fluo.react-navigation+json;v=1'", "const MEDIA_TYPE = 'application/json'"],
  [clientPath, "credentials: options.prefetch === true ? 'omit' : 'same-origin'",
    "credentials: options.prefetch === true ? 'omit' : 'omit'"],
  [clientPath, "credentials: options.prefetch === true ? 'omit' : 'same-origin'",
    "credentials: options.prefetch === true ? 'same-origin' : 'same-origin'"],
  [clientPath, "cache: 'no-store'", "cache: 'force-cache'"],
  [clientPath, "redirect: 'manual'", "redirect: 'follow'"],
  [serverPath, "mediaType: 'application/vnd.fluo.react-navigation+json;v=1'", "mediaType: 'application/json'"],
  [transferPath, '64 * 1024', 'Infinity'],
  [transferPath, '[<>&\\u2028\\u2029]', '[>]'],
  [transferPath, '(character) =>', '(character) => character ||'],
  [serverPath, 'createReactInitialNavigationPage(createReactNavigationPayload(', 'createReactNavigationPayload('],
  [storePath, 'if (!result.ok)', 'if (false)'],
  [historyPath, "loadAndCommit(browser, activated, 'back')", "loadAndCommit(browser, activated, 'push')"],
  [storePath, 'load(destination.href, controller.signal)', 'load(destination.href)'],
  [providerPath, 'loadReactNavigationDestination(href, modules, { signal, prefetch: true })',
    'loadReactNavigationDestination(href, modules, { signal })'],
  [providerPath, 'loadReactNavigationDestination(href, modules, { signal })',
    'loadReactNavigationDestination(href, modules, { signal, prefetch: true })'],
  [storePath, 'prefetchedResult.ok && prefetchedResult.prefetchExpiresAt !== undefined',
    'true && prefetchedResult.prefetchExpiresAt !== undefined'],
  [storePath, 'Date.now() < prefetchedResult.prefetchExpiresAt',
    'true'],
  [storePath, '      if (!result.ok) {',
    "      browser.pushState?.(destination.href);\n      if (!result.ok) {"],
  [storePath, 'decision = await browser.failurePolicy(failure);',
    "decision = 'document';"],
  [storePath, 'browser.go?.(approvedIndex - failed.index);',
    'browser.assign(destination.href);'],
  [storePath, "loadAndCommit(browser, destination, 'refresh')", "loadAndCommit(browser, destination, 'push')"],
  [storePath, 'const destination = new URL(browser.currentHref());',
    "const destination = new URL('https://example.test/stale');"],
  [storePath, "    refresh(): Promise<ReactRevalidationResult> {\n      const browser = requireEnvironment();\n      cancelPending();",
    "    refresh(): Promise<ReactRevalidationResult> {\n      const browser = requireEnvironment();"],
  [clientPath, "headers.get('X-Fluo-Navigation-Prefetch')", "headers.get('X-Fluo-Navigation-Other')"],
  [dispatchPath, "!hasExistingHeader('set-cookie')", 'true'],
  [dispatchPath, "!hasExistingHeader('cache-control')", 'true'],
  [dispatchPath, 'response.statusCode === 200', 'true'],
] as const)('rejects changed navigation request or response machinery in %s', (path, original, changed) => {
  // Given: a source variant whose machine-consumed HTTP contract changes.
  const source = sources.get(path);
  expect(source).toBeDefined();
  const variant = source?.replace(original, changed) ?? '';
  expect(variant).not.toBe(source);
  const readText = (candidate: string) => candidate === path ? variant : sources.get(candidate) ?? '';

  // When / Then: governance rejects the divergent request or server representation.
  expect(() => enforceReactNavigationPayloadContract(readText)).toThrow(/React navigation/u);
});

it('rejects a disabled initial-transfer size condition with the transfer-specific error', () => {
  const source = sources.get(transferPath);
  expect(source).toBeDefined();
  const variant = source?.replace(
    'if (new TextEncoder().encode(json).byteLength > 64 * 1024)',
    'if (false && new TextEncoder().encode(json).byteLength > 64 * 1024)',
  ) ?? '';
  expect(variant).not.toBe(source);

  expect(() => enforceReactNavigationPayloadContract((path: string) =>
    path === transferPath ? variant : sources.get(path) ?? '',
  )).toThrow('React navigation initial document transfer must retain escaping, size bounds and the shared client validator.');
});

it('rejects a credentialed prefetch even when ordinary navigation remains credentialed', () => {
  // Given: the existing approved navigation request followed by a distinct speculative request.
  const source = sources.get(clientPath);
  expect(source).toBeDefined();
  const variant = `${source ?? ''}
async function prefetchReactNavigationDestination(href: string) {
  return fetch(href, {
    cache: 'no-store',
    credentials: 'include',
    headers: { Accept: MEDIA_TYPE },
    redirect: 'manual',
  });
}
`;
  const readText = (path: string) => path === clientPath ? variant : sources.get(path) ?? '';

  // When / Then: the second request cannot bypass the credential policy.
  expect(() => enforceReactNavigationPayloadContract(readText)).toThrow(/React navigation.*prefetch/u);
});
