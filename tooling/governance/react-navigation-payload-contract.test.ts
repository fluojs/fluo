import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

import { enforceReactNavigationPayloadContract } from './react-navigation-payload-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const clientPath = 'packages/react/src/client/navigation-payload.ts';
const serverPath = 'packages/react/src/page-result.ts';
const transferPath = 'packages/react/src/navigation-payload.ts';
const metadataPath = 'packages/react/src/page-metadata.ts';
const storePath = 'packages/react/src/client/store.ts';
const formStorePath = 'packages/react/src/client/form-store.ts';
const formPath = 'packages/react/src/client/form.ts';
const formTransportPath = 'packages/react/src/client/form-transport.ts';
const experiencePath = 'packages/react/src/client/experience.ts';
const historyPath = 'packages/react/src/client/history.ts';
const providerPath = 'packages/react/src/client/provider.ts';
const guardPath = 'packages/react/src/client/navigation-guard.ts';
const dispatchPath = 'packages/http/src/dispatch/dispatch-response-policy.ts';
const sources = new Map([
  [clientPath, readFileSync(resolve(repoRoot, clientPath), 'utf8')],
  [serverPath, readFileSync(resolve(repoRoot, serverPath), 'utf8')],
  [transferPath, readFileSync(resolve(repoRoot, transferPath), 'utf8')],
  [metadataPath, readFileSync(resolve(repoRoot, metadataPath), 'utf8')],
  [storePath, readFileSync(resolve(repoRoot, storePath), 'utf8')],
  [formStorePath, readFileSync(resolve(repoRoot, formStorePath), 'utf8')],
  [formPath, readFileSync(resolve(repoRoot, formPath), 'utf8')],
  [formTransportPath, readFileSync(resolve(repoRoot, formTransportPath), 'utf8')],
  [experiencePath, readFileSync(resolve(repoRoot, experiencePath), 'utf8')],
  [historyPath, readFileSync(resolve(repoRoot, historyPath), 'utf8')],
  [providerPath, readFileSync(resolve(repoRoot, providerPath), 'utf8')],
  [guardPath, readFileSync(resolve(repoRoot, guardPath), 'utf8')],
  [dispatchPath, readFileSync(resolve(repoRoot, dispatchPath), 'utf8')],
]);

it('accepts the current matching HTTP and browser navigation machine contract', () => {
  expect(() => enforceReactNavigationPayloadContract((path: string) => sources.get(path) ?? '')).not.toThrow();
});

it.each([
  [storePath, 'expectedBackgroundRevision !== backgroundRevision', 'false'],
  [storePath, 'expectedSession !== sessionGeneration', 'false'],
  [storePath, "true, undefined, revision, origins);", "true, undefined, undefined, origins);"],
  [storePath, "true, undefined, revision, origins);", "true, undefined, revision);"],
  [storePath, 'sessionPolicyOrigins = new Set(savedOrigins);', 'sessionPolicyOrigins = new Set();'],
  [storePath, '}, formOrigin, destination.href, backgroundOrigins);', '}, formOrigin, destination.href);'],
  [storePath, 'pending?.backgroundOrigins === origins', 'false'],
  [formPath, 'lease: navigation.sessionLease,', 'lease: undefined,'],
  [formStorePath, 'lease === undefined || lease.current()', 'true'],
  [formStorePath, "mode === 'background' ? 'refresh' : saved.followUp", 'saved.followUp'],
  [formTransportPath, "reading ? 'application/json' : MEDIA_TYPE", 'MEDIA_TYPE'],
  [formTransportPath, "cache: 'no-store'", "cache: 'force-cache'"],
])('rejects a background session transport or freshness bypass in %s', (path, original, changed) => {
  // Given: one isolated mutation breaks a machine-owned background invariant.
  const source = sources.get(path);
  const variant = source?.replaceAll(original, changed) ?? '';
  expect(variant).not.toBe(source);
  // When/Then: the companion rejects the bypass without weakening legacy guards.
  expect(() => enforceReactNavigationPayloadContract((candidate: string) =>
    candidate === path ? variant : sources.get(candidate) ?? '',
  )).toThrow(/React background forms/u);
});

it.each([
  [clientPath, 'decodeDestination(payload, contracts)', 'payload'],
  [clientPath, 'decodeDestination(payload, options.contracts)', 'payload'],
  [clientPath, 'props: contract.decodeProps(payload.destination.props)', 'props: payload.destination.props'],
  [providerPath, 'signal, buildId, ...(contracts === undefined ? {} : { contracts })', 'signal, buildId'],
  [providerPath, 'signal, prefetch: true, buildId, ...(contracts === undefined ? {} : { contracts })',
    'signal, prefetch: true, buildId'],
])('rejects a generated props decoder bypass in %s', (path, original, changed) => {
  const source = sources.get(path);
  const variant = source?.replace(original, changed) ?? '';
  expect(variant).not.toBe(source);
  expect(() => enforceReactNavigationPayloadContract((candidate: string) =>
    candidate === path ? variant : sources.get(candidate) ?? '',
  )).toThrow(/React generated props/u);
});

it.each([
  [storePath, 'requestPermission(\n      { destination: destinationUrl, type }', 'Boolean(\n      { destination: destinationUrl, type }'],
  [historyPath, 'handlers.permission(activated)', 'false'],
  [storePath, 'expectedSession === sessionGeneration', 'true'],
  [storePath, 'activePrefetch.adopted = true', 'activePrefetch.adopted = false'],
  [guardPath, 'store.registerNavigationGuard(() => current.current)', 'store.subscribe(() => {})'],
  [storePath, 'navigationCurrent: () => expectedPermission === permissionGeneration', 'navigationCurrent: () => true'],
  [formStorePath, 'navigationCurrent?.() === false', 'false'],
])('rejects a severed navigation permission invariant in %s', (path, original, replacement) => {
  const source = sources.get(path);
  const variant = source?.replace(original, replacement) ?? '';
  expect(variant).not.toBe(source);
  expect(() => enforceReactNavigationPayloadContract((candidate) =>
    candidate === path ? variant : sources.get(candidate) ?? '',
  )).toThrow(/React navigation permission/u);
});

it.each([
  [storePath, 'controller?.abort();', 'controller?.signal;'],
  [storePath, "decision === 'refresh') await router.refresh();", "decision === 'refresh') await Promise.resolve();"],
  [formStorePath, 'Promise.race([continuation, cancellation.then(() => false)])', 'continuation'],
])('rejects detached session policy cancellation or discarded auth refresh in %s', (path, original, changed) => {
  const source = sources.get(path);
  const variant = source?.replace(original, changed) ?? '';
  expect(variant).not.toBe(source);
  expect(() => enforceReactNavigationPayloadContract((candidate: string) =>
    candidate === path ? variant : sources.get(candidate) ?? '',
  )).toThrow(/React navigation session policy cancellation/u);
});

it.each([
  [storePath, '++sessionGeneration', 'sessionGeneration'],
  [storePath, 'oldPending?.controller.abort();', 'oldPending?.controller.signal;'],
  [formStorePath, 'environment.sessionChanged(mutation.session)', 'Promise.resolve(true)'],
  [experiencePath, "revoked ? createElement('section'", "false ? createElement('section'"],
])('rejects a bypass of session ownership and revoked initial-page fallback in %s', (path, original, changed) => {
  // Given: an isolated negative mutation of a machine-consumed session invariant.
  const source = sources.get(path);
  const variant = source?.replace(original, changed) ?? '';
  expect(variant).not.toBe(source);
  // When/Then: governance detects the broken barrier rather than accepting runtime drift.
  expect(() => enforceReactNavigationPayloadContract((candidate: string) =>
    candidate === path ? variant : sources.get(candidate) ?? '',
  )).toThrow(/React navigation session/u);
});

it.each([
  ['loadAndCommit(browser, destination, type, undefined, true, origin);',
    'loadAndCommit(browser, destination, type);'],
  ['      cached.clear();\n      discardPrefetches();',
    '      discardPrefetches();'],
  ["const type = followUp === 'refresh' ? 'refresh' : 'push';",
    "const type = 'replace';"],
] as const)('rejects a form follow-up bypass of existing fresh HTTP approval (%s)', (original, changed) => {
  const source = sources.get(storePath);
  const variant = source?.replace(original, changed) ?? '';
  expect(variant).not.toBe(source);
  expect(() => enforceReactNavigationPayloadContract((path: string) =>
    path === storePath ? variant : sources.get(path) ?? '',
  )).toThrow(/React navigation form follow-up/u);
});

it.each([
  [metadataPath, 'value.title.length > 512', 'value.title.length > 9999'],
  [metadataPath, 'value.meta.length > 32', 'value.meta.length > 9999'],
  [metadataPath, 'value.links.length > 32', 'value.links.length > 9999'],
  [metadataPath, 'entry.content.length > 2048', 'entry.content.length > 9999'],
  [metadataPath, 'isPageLinkHref(entry.href)', 'true'],
  [metadataPath, "return href.startsWith('/') && new URL(href, 'https://fluo.invalid').origin === 'https://fluo.invalid';",
    'return true;'],
  [metadataPath, 'metaKeys.has(identity)', 'false'],
  [metadataPath, 'linkKeys.has(identity)', 'false'],
  [clientPath, 'parseReactPageMetadata(value.metadata)', 'value.metadata'],
  [clientPath, 'value.metadata !== undefined && metadata === undefined', 'false'],
  [serverPath, 'pageMetadata(writerContext.requestContext)', 'undefined'],
  [serverPath, 'pageMetadata(requestContext)', 'undefined'],
  [storePath, 'result.payload.metadata,', 'undefined,'],
  [transferPath, 'readonly metadata?: ReactPageMetadata;', 'readonly ignoredMetadata?: ReactPageMetadata;'],
  [transferPath, '...(metadata === undefined ? {} : { metadata }),', '...{},'],
] as const)('rejects a dropped or unbounded page-owned metadata contract in %s', (path, original, changed) => {
  // Given: one machine-consumed metadata boundary is changed while the others stay intact.
  const source = sources.get(path);
  expect(source).toBeDefined();
  const variant = source?.replace(original, changed) ?? '';
  expect(variant).not.toBe(source);
  const readText = (candidate: string) => candidate === path ? variant : sources.get(candidate) ?? '';

  // When / Then: the governance gate detects the severed source-to-head contract.
  expect(() => enforceReactNavigationPayloadContract(readText)).toThrow(/React navigation.*metadata/u);
});

it.each([
  [clientPath, "const MEDIA_TYPE = 'application/vnd.fluo.react-navigation+json;v=2'", "const MEDIA_TYPE = 'application/json'"],
  [clientPath, 'payload.buildId !== options.buildId', 'false'],
  [clientPath, 'payload.buildId !== buildId', 'false'],
  [clientPath, 'value.buildId.length === 0', 'false'],
  [transferPath, 'readonly buildId: string', 'readonly buildId?: string'],
  [clientPath, "credentials: options.prefetch === true ? 'omit' : 'same-origin'",
    "credentials: options.prefetch === true ? 'omit' : 'omit'"],
  [clientPath, "credentials: options.prefetch === true ? 'omit' : 'same-origin'",
    "credentials: options.prefetch === true ? 'same-origin' : 'same-origin'"],
  [clientPath, "cache: 'no-store'", "cache: 'force-cache'"],
  [clientPath, "redirect: 'manual'", "redirect: 'follow'"],
  [serverPath, "mediaType: 'application/vnd.fluo.react-navigation+json;v=2'", "mediaType: 'application/json'"],
  [transferPath, '64 * 1024', 'Infinity'],
  [transferPath, '[<>&\\u2028\\u2029]', '[>]'],
  [transferPath, '(character) =>', '(character) => character ||'],
  [serverPath, 'createReactInitialNavigationPage(createReactNavigationPayload(', 'createReactNavigationPayload('],
  [storePath, 'if (!result.ok)', 'if (false)'],
  [historyPath, "loadAndCommit(browser, activated, 'back')", "loadAndCommit(browser, activated, 'push')"],
  [storePath, 'load(destination.href, controller.signal)', 'load(destination.href)'],
  [providerPath, 'loadReactNavigationDestination(href, modules, {\n            signal, prefetch: true, buildId, ...(contracts === undefined ? {} : { contracts }),\n          })',
    'loadReactNavigationDestination(href, modules, { signal })'],
  [providerPath, 'loadReactNavigationDestination(href, modules, {\n        signal, buildId, ...(contracts === undefined ? {} : { contracts }),\n      })',
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
  [storePath, "loadAndCommit(browser, new URL(browser.currentHref()), 'refresh')",
    "loadAndCommit(browser, new URL(browser.currentHref()), 'push')"],
  [storePath, 'loadAndCommit(nextEnvironment, new URL(nextEnvironment.currentHref()), \'refresh\')',
    'loadAndCommit(nextEnvironment, new URL(nextEnvironment.currentHref()), \'push\')'],
  [storePath, 'browser.go?.(approvedIndex - restoreFrom);',
    'browser.replace(browser.currentHref());'],
  [storePath, "|| restoringIndex !== null) && toSnapshotUrl(browser.currentHref()) !== snapshot.url;",
    "|| restoringIndex !== null) && toSnapshotUrl(browser.currentHref()) === snapshot.url;"],
  [storePath, 'new URL(browser.currentHref()), \'refresh\'',
    "new URL('https://example.test/stale'), 'refresh'"],
  [storePath, "      cancelPending();\n      failed = null;\n      deferredBack = false;",
    "      failed = null;\n      deferredBack = false;"],
  [clientPath, "headers.get('X-Fluo-Navigation-Prefetch')", "headers.get('X-Fluo-Navigation-Other')"],
  [dispatchPath, "!hasExistingHeader('set-cookie')", 'true'],
  [dispatchPath, "!hasExistingHeader('cache-control')", 'true'],
  [dispatchPath, 'response.statusCode === 200', 'true'],
  [dispatchPath, "request.method.toUpperCase() === 'GET'", 'true'],
] as const)('rejects changed navigation request or response machinery in %s (%s)', (path, original, changed) => {
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
