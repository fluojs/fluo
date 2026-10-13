import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GeneratorArtifacts } from './generator-identity';

export async function observeGeneratorArtifacts(entryUrl: URL): Promise<GeneratorArtifacts> {
  const entry = await realpath(fileURLToPath(entryUrl));
  const directory = await realpath(process.cwd());
  let root = dirname(entry);
  let declaredLock: string;
  for (;;) {
    try {
      declaredLock = await realpath(join(root, 'pnpm-lock.yaml'));
      break;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      if (root === dirname(root)) throw new Error('Generator entry has no actual declared lockfile');
      root = dirname(root);
    }
  }
  const resolver = createRequire(entryUrl);
  const roles = {
    executable: await realpath(process.execPath),
    entry, declaredLock,
    installedLock: await realpath(join(root, 'node_modules/.pnpm/lock.yaml')),
    autocannonEntry: await realpath(resolver.resolve('autocannon')),
    autocannonManifest: await realpath(resolver.resolve('autocannon/package.json')),
  };
  const artifacts: Record<string, string> = {};
  for (const path of Object.values(roles)) {
    artifacts[path] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return { directory, roles, artifacts };
}
