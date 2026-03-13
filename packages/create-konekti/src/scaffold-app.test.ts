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
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
      workspaces: string[];
    };
    const appPackageJson = JSON.parse(
      readFileSync(join(targetDirectory, 'apps', 'starter-app', 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };

    expect(packageJson.devDependencies['@konekti/cli']).toBe('workspace:*');
    expect(packageJson.scripts.dev).toBe('node ./tooling/scripts/run-workspace-script.mjs dev --scope=apps --first');
    expect(packageJson.workspaces).toEqual(['packages/*', 'tooling/*', 'apps/*']);
    expect(appPackageJson.dependencies['@konekti/prisma']).toBe('workspace:*');
    expect(appPackageJson.scripts.dev).toBe('node --watch --watch-preserve-output --import tsx src/main.ts');
    expect(existsSync(join(targetDirectory, 'packages', 'cli', 'package.json'))).toBe(true);
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
    execFileSync('pnpm', ['exec', 'konekti', 'g', 'repo', 'User'], { cwd: targetDirectory, stdio: 'inherit' });

    expect(readFileSync(join(targetDirectory, 'apps', 'starter-app', 'src', 'user.repo.ts'), 'utf8')).toContain(
      'this.prisma.current()',
    );
  }, 180000);

  it('creates a runnable npm starter workspace', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'create-konekti-'));
    createdDirectories.push(targetDirectory);

    await scaffoldKonektiApp({
      database: 'PostgreSQL',
      orm: 'Prisma',
      packageManager: 'npm',
      projectName: 'starter-app',
      targetDirectory,
    });

    expect(existsSync(join(targetDirectory, 'pnpm-workspace.yaml'))).toBe(false);

    execFileSync('npm', ['run', 'typecheck'], { cwd: targetDirectory, stdio: 'inherit' });
    execFileSync('npm', ['run', 'build'], { cwd: targetDirectory, stdio: 'inherit' });
    execFileSync('npm', ['run', 'test'], { cwd: targetDirectory, stdio: 'inherit' });
    execFileSync('npm', ['exec', '--', 'konekti', 'g', 'repo', 'Account'], { cwd: targetDirectory, stdio: 'inherit' });

    expect(readFileSync(join(targetDirectory, 'apps', 'starter-app', 'src', 'account.repo.ts'), 'utf8')).toContain(
      'this.prisma.current()',
    );
  }, 180000);

  it('creates a runnable yarn starter workspace', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'create-konekti-'));
    createdDirectories.push(targetDirectory);

    await scaffoldKonektiApp({
      database: 'PostgreSQL',
      orm: 'Drizzle',
      packageManager: 'yarn',
      projectName: 'starter-app',
      targetDirectory,
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
      workspaces: string[];
    };

    expect(packageJson.workspaces).toEqual(['packages/*', 'tooling/*', 'apps/*']);
    expect(packageJson.scripts.build).toBe('node ./tooling/scripts/run-workspace-script.mjs build');
    expect(existsSync(join(targetDirectory, 'pnpm-workspace.yaml'))).toBe(false);
    expect(readFileSync(join(targetDirectory, 'README.md'), 'utf8')).toContain('yarn konekti g repo User');

    execFileSync('yarn', ['run', 'typecheck'], { cwd: targetDirectory, stdio: 'inherit' });
    execFileSync('yarn', ['run', 'build'], { cwd: targetDirectory, stdio: 'inherit' });
    execFileSync('yarn', ['run', 'test'], { cwd: targetDirectory, stdio: 'inherit' });
    execFileSync('yarn', ['konekti', 'g', 'repo', 'Ledger'], { cwd: targetDirectory, stdio: 'inherit' });

    expect(readFileSync(join(targetDirectory, 'apps', 'starter-app', 'src', 'ledger.repo.ts'), 'utf8')).toContain(
      'this.database.current()',
    );
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
