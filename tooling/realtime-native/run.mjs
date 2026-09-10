import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const source = process.argv.find((argument) => argument.startsWith('--source='))?.slice('--source='.length) ?? 'baseline';

if (source !== 'baseline' && source !== 'final') {
  throw new TypeError(`Expected --source=baseline or --source=final, received ${source}.`);
}

async function run(command, arguments_) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: root,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${arguments_.join(' ')} exited with ${String(code)}${signal ? ` (${signal})` : ''}.`));
    });
  });
}

console.log(`realtime-native source=${source}`);
console.log('realtime-native builds local package export targets before running fixtures.');

await run('pnpm', [
  '-r',
  '--filter',
  '@fluojs/websockets...',
  '--filter',
  '@fluojs/socket.io...',
  '--filter',
  '@fluojs/platform-cloudflare-workers...',
  'run',
  'build',
]);
await run('pnpm', [
  'exec',
  'babel',
  'tooling/realtime-native/fixtures',
  '--extensions',
  '.ts',
  '--out-dir',
  'tooling/realtime-native/.generated',
  '--config-file',
  './tooling/babel/babel.config.cjs',
  '--plugins',
  './tooling/realtime-native/resolve-workspace-imports.cjs',
]);

if (source === 'final') {
  await run('node', ['tooling/realtime-native/verify-final-public-surface.mjs']);
}

await run('node', ['tooling/realtime-native/.generated/node.js']);
await run('bun', ['tooling/realtime-native/.generated/bun.js']);
await run('pnpm', [
  'dlx',
  'deno@2.5.0',
  'run',
  '--allow-env',
  '--allow-net',
  '--allow-read',
  '--node-modules-dir=manual',
  'tooling/realtime-native/.generated/deno.js',
]);
await run('node', ['tooling/realtime-native/worker-native.mjs']);
await run('bun', ['tooling/realtime-native/.generated/socket-io-bun.js']);

console.log(`realtime-native source=${source} passed.`);
