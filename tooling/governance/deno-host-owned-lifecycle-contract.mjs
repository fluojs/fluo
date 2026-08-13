import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enforceDenoHostOwnedLifecycleDocs } from './deno-host-owned-lifecycle-docs.mjs';
import { enforceDenoHostOwnedLifecycleSource } from './deno-host-owned-lifecycle-source.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function enforceDenoHostOwnedLifecycleContract(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  enforceDenoHostOwnedLifecycleSource(readText);
  enforceDenoHostOwnedLifecycleDocs(readText);
}
