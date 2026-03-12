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
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.dev).toBe("pnpm --filter './apps/*' --if-present run dev");
    expect(appPackageJson.dependencies['@konekti/prisma']).toBe('workspace:*');
    expect(appPackageJson.scripts.dev).toBe('pnpm exec tsx watch src/main.ts');
    expect(existsSync(join(targetDirectory, 'packages', 'prisma', 'src', 'index.ts'))).toBe(true);
    expect(readFileSync(join(targetDirectory, 'apps', 'starter-app', 'src', 'examples', 'user.repo.ts'), 'utf8')).toContain(
      'this.prisma.current()',
    );
    expect(readFileSync(join(targetDirectory, 'apps', 'starter-app', 'src', 'main.ts'), 'utf8')).toContain(
      'createConsoleApplicationLogger',
    );
    expect(readFileSync(join(targetDirectory, 'apps', 'starter-app', 'src', 'main.ts'), 'utf8')).toContain(
      "process.once('SIGINT'",
    );
    expect(readFileSync(join(targetDirectory, 'apps', 'starter-app', 'src', 'main.ts'), 'utf8')).toContain(
      'process.exit(0)',
    );

    execFileSync('pnpm', ['typecheck'], { cwd: targetDirectory, stdio: 'inherit' });
    execFileSync('pnpm', ['build'], { cwd: targetDirectory, stdio: 'inherit' });
    execFileSync('pnpm', ['test'], { cwd: targetDirectory, stdio: 'inherit' });
  }, 180000);

  it('scaffolds a tx-aware drizzle repository example', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'create-konekti-'));
    createdDirectories.push(targetDirectory);

    await scaffoldKonektiApp({
      database: 'PostgreSQL',
      orm: 'Drizzle',
      packageManager: 'pnpm',
      projectName: 'starter-app',
      skipInstall: true,
      targetDirectory,
    });

    expect(readFileSync(join(targetDirectory, 'apps', 'starter-app', 'src', 'examples', 'user.repo.ts'), 'utf8')).toContain(
      'this.database.current()',
    );
  });
});
