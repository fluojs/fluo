import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { scaffoldKonektiApp } from './bootstrap/scaffold';

const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('scaffoldKonektiApp', () => {
  it('creates a runnable starter workspace', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'create-konekti-'));
    createdDirectories.push(targetDirectory);

    await scaffoldKonektiApp({
      database: 'PostgreSQL',
      orm: 'Prisma',
      packageManager: 'pnpm',
      projectName: 'starter-app',
      targetDirectory,
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const appPackageJson = JSON.parse(
      readFileSync(join(targetDirectory, 'apps', 'starter-app', 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
    };

    expect(packageJson.scripts.dev).toBe("pnpm --filter './apps/*' --if-present run dev");
    expect(appPackageJson.dependencies['@konekti/prisma']).toBe('workspace:*');
    expect(existsSync(join(targetDirectory, 'packages', 'prisma', 'src', 'index.ts'))).toBe(true);

    execFileSync('pnpm', ['typecheck'], { cwd: targetDirectory, stdio: 'inherit' });
    execFileSync('pnpm', ['build'], { cwd: targetDirectory, stdio: 'inherit' });
    execFileSync('pnpm', ['test'], { cwd: targetDirectory, stdio: 'inherit' });
  }, 180000);
});
