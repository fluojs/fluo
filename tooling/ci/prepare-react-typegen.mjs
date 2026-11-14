import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));

/** Generate missing example artifacts; preserve every existing artifact and its check result. */
export function prepareReactTypegen(root = repository) {
  const cwd = resolve(root, 'examples/react-vite-ssr');
  for (const [module, tsconfig, output, options] of [
    ['src/app.ts', 'tsconfig.json', 'src/generated/react-pages.ts', ['--options', 'applicationOptions']],
    ['tests/typegen-fixture/app.module.ts', 'tests/typegen-fixture/tsconfig.json',
      'tests/typegen-fixture/generated/react-pages.ts', []],
  ]) {
    const args = [resolve(root, 'packages/cli/bin/fluo.mjs'), 'typegen', module,
      '--export', 'AppModule', ...options, '--tsconfig', tsconfig, '--output', output];
    const check = spawnSync(process.execPath, [...args, '--check'], { cwd, stdio: 'inherit' });
    if (check.status === 0) continue;
    if (check.status !== 2) return check.status ?? 1;
    const generation = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
    if (generation.status !== 0) return generation.status ?? 1;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = prepareReactTypegen();
}
