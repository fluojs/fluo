import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspacePackageManifests } from '../release/release-intents.mjs';
import { refreshStarterSnapshotVersions } from './starter-lockfile.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function generateStarterSnapshots(rootDirectory = repoRoot) {
  const directory = join(rootDirectory, 'tooling/cli/verification-locks');
  const manifests = workspacePackageManifests(rootDirectory).map(({ manifest }) => manifest);
  const pending = readdirSync(directory).filter((name) => name.endsWith('.json')).sort().map((name) => {
    const path = join(directory, name);
    const previous = readFileSync(path, 'utf8');
    const snapshot = refreshStarterSnapshotVersions(JSON.parse(previous), manifests);
    return { path, previous, content: `${JSON.stringify(snapshot, null, 2)}\n` };
  });
  // Validate all reviewed graphs before writing any version-only corrections.
  for (const { path, previous, content } of pending) {
    if (previous !== content) writeFileSync(path, content);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateStarterSnapshots();
}
