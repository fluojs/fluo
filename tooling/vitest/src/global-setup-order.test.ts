import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const vitestEntrypoint = fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url));

describe('Vitest global setup', () => {
  it('runs before its worker consumes the emitted artifacts', () => {
    const fixtureRoot = mkdtempSync(join(repoRoot, '.vitest-global-setup-order-'));
    const tracePath = join(fixtureRoot, 'trace.log');
    const setupPath = join(fixtureRoot, 'setup.mjs');
    const workerPath = join(fixtureRoot, 'worker.test.ts');
    const configPath = join(fixtureRoot, 'vitest.config.mjs');

    try {
      writeFileSync(
        setupPath,
        `import { appendFileSync } from 'node:fs'; export default () => appendFileSync(${JSON.stringify(tracePath)}, 'setup\\n');`,
      );
      writeFileSync(
        workerPath,
        [
          "import { appendFileSync, existsSync } from 'node:fs';",
          "import { expect, it } from 'vitest';",
          `it('observes setup artifacts', () => { expect(existsSync(${JSON.stringify(tracePath)})).toBe(true); appendFileSync(${JSON.stringify(tracePath)}, 'worker\\n'); });`,
        ].join('\n'),
      );
      writeFileSync(
        configPath,
        [
          "import { defineConfig } from 'vitest/config';",
          `export default defineConfig({ test: { globalSetup: ${JSON.stringify(setupPath)}, include: [${JSON.stringify(workerPath)}] } });`,
        ].join('\n'),
      );

      const result = spawnSync(process.execPath, [vitestEntrypoint, 'run', '--config', configPath], {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 60_000,
      });

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(tracePath, 'utf8')).toBe('setup\nworker\n');
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });
});
