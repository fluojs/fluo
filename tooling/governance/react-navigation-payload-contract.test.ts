import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

import { enforceReactNavigationPayloadContract } from './react-navigation-payload-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const clientPath = 'packages/react/src/client/navigation-payload.ts';
const serverPath = 'packages/react/src/page-result.ts';
const sources = new Map([
  [clientPath, readFileSync(resolve(repoRoot, clientPath), 'utf8')],
  [serverPath, readFileSync(resolve(repoRoot, serverPath), 'utf8')],
]);

it('accepts the current matching HTTP and browser navigation machine contract', () => {
  expect(() => enforceReactNavigationPayloadContract((path: string) => sources.get(path) ?? '')).not.toThrow();
});

it.each([
  [clientPath, "credentials: 'same-origin'", "credentials: 'omit'"],
  [clientPath, "cache: 'no-store'", "cache: 'force-cache'"],
  [clientPath, "redirect: 'manual'", "redirect: 'follow'"],
  [serverPath, "mediaType: 'application/vnd.fluo.react-navigation+json;v=1'", "mediaType: 'application/json'"],
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
