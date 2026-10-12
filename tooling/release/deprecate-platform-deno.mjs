import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packageName = '@fluojs/platform-deno';
const registryUrl = 'https://registry.npmjs.org/@fluojs%2fplatform-deno';
const migrationUrl = 'https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-from-deno.md';
const migrationSourceUrl = 'https://raw.githubusercontent.com/fluojs/fluo/main/docs/getting-started/migrate-from-deno.md';
export const deprecationMessage = `Deno support is deprecated. No new features or runtime compatibility work is planned. Migrate to a supported Fluo adapter: ${migrationUrl}`;

async function readRegistry() {
  const response = await fetch(registryUrl, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Deno registry read failed: HTTP ${response.status}.`);
  return response.json();
}

async function checkMigration() {
  const response = await fetch(migrationSourceUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Deno migration guide is not public: HTTP ${response.status}.`);
}

function deprecate() {
  if (!process.env.NODE_AUTH_TOKEN) throw new Error('NODE_AUTH_TOKEN is required for npm deprecation metadata writes.');
  execFileSync('npm', ['deprecate', `${packageName}@*`, deprecationMessage, '--registry=https://registry.npmjs.org'], {
    stdio: 'inherit',
    timeout: 120_000,
  });
}

/** Runs only after the advisory release is actually available on npm. */
export async function runDenoDeprecation(manifest, dependencies = {}) {
  const read = dependencies.readRegistry ?? readRegistry;
  const publicGuide = dependencies.checkMigration ?? checkMigration;
  const write = dependencies.deprecate ?? deprecate;
  if (manifest.name !== packageName || !manifest.description.startsWith('Deprecated:')) {
    throw new Error('Expected the deprecated Deno package manifest.');
  }

  const registry = await read();
  const latest = registry['dist-tags']?.latest;
  const advisory = registry.versions?.[latest];
  if (typeof latest !== 'string' || typeof advisory?.description !== 'string') {
    throw new Error('Deno registry latest version metadata is invalid.');
  }
  if (latest !== manifest.version || advisory?.description !== manifest.description) {
    return { status: 'pending-advisory-release', version: manifest.version };
  }
  await publicGuide();
  const versions = Object.entries(registry.versions);
  if (versions.length === 0) throw new Error('Deno registry has no versions to deprecate.');
  if (versions.some(([, metadata]) => metadata.deprecated !== deprecationMessage)) {
    await write();
  }

  const observed = await read();
  if (!observed.versions || !Object.keys(observed.versions).length) {
    throw new Error('Deno deprecation verification returned no versions.');
  }
  const missing = Object.entries(observed.versions)
    .filter(([, metadata]) => metadata.deprecated !== deprecationMessage)
    .map(([version]) => version);
  if (missing.length) throw new Error(`Deno deprecation metadata missing for: ${missing.join(', ')}.`);
  return { status: 'deprecated', version: latest, versions: Object.keys(observed.versions).length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(new URL('../../packages/platform-deno/package.json', import.meta.url), 'utf8'));
  console.log(JSON.stringify(await runDenoDeprecation(manifest)));
}
