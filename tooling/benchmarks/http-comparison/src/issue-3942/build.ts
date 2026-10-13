import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand, WDIR } from '../targets.js';
import { POLICY } from './gates.js';

// Only issue-owned disposable serving entries; package builds are an explicit prerequisite.
for (const name of POLICY.fixtures) {
  await runCommand('pnpm', ['exec', 'esbuild', 'src/issue-3942/server.ts',
    '--bundle', '--platform=node', '--target=node24', '--format=esm', '--packages=external', '--sourcemap',
    '--tsconfig=src/issue-3942/tsconfig.build.json',
    `--define:process.env.ISSUE_3942_FIXTURE=${JSON.stringify(name)}`,
    `--outfile=dist/issue-3942/${name}/server.mjs`]);
}

await runCommand('pnpm', ['exec', 'esbuild', 'src/issue-3942/load-client.ts',
  '--bundle', '--platform=node', '--target=node24', '--format=esm',
  '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  '--outfile=dist/issue-3942/generator/load-client.mjs']);
await copyFile(join(WDIR, 'pnpm-lock.yaml'), join(WDIR, 'dist/issue-3942/generator/pnpm-lock.yaml'));
