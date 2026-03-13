import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { scaffoldKonektiApp } from './bootstrap/scaffold.js';

const createdDirectories: string[] = [];
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('scaffoldKonektiApp', () => {
  it('creates a published-package starter template by default', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'create-konekti-'));
    createdDirectories.push(targetDirectory);

    await scaffoldKonektiApp({
      database: 'PostgreSQL',
      orm: 'Prisma',
      packageManager: 'pnpm',
      projectName: 'starter-app',
      skipInstall: true,
      targetDirectory,
    });

    const packageJson = readFileSync(join(targetDirectory, 'package.json'), 'utf8');

    expect(packageJson).not.toContain('workspace:*');
    expect(packageJson).not.toContain('@konekti-internal/');
    expect(packageJson).not.toContain('workspaces');
    expect(existsSync(join(targetDirectory, 'src', 'app.ts'))).toBe(true);
    expect(existsSync(join(targetDirectory, 'apps'))).toBe(false);
    expect(readFileSync(join(targetDirectory, 'src', 'main.ts'), 'utf8')).toContain('@konekti/runtime');
    expect(readFileSync(join(targetDirectory, 'vitest.config.ts'), 'utf8')).not.toContain('tooling/');
  });

  it('creates a runnable pnpm starter project in local-package mode', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'create-konekti-'));
    createdDirectories.push(targetDirectory);

    await scaffoldKonektiApp({
      database: 'PostgreSQL',
      dependencySource: 'local',
      orm: 'Prisma',
      packageManager: 'pnpm',
      projectName: 'starter-app',
      repoRoot,
      targetDirectory,
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };

    expect(packageJson.dependencies['@konekti/runtime']).toContain('.konekti/packages');
    expect(packageJson.devDependencies['@konekti/cli']).toContain('.konekti/packages');
    expect(packageJson.scripts.dev).toBe('node --env-file=.env.dev --watch --watch-preserve-output --import tsx src/main.ts');
    expect(readFileSync(join(targetDirectory, 'src', 'examples', 'user.repo.ts'), 'utf8')).toContain('this.prisma.current()');

    execFileSync('pnpm', ['typecheck'], { cwd: targetDirectory, stdio: 'inherit' });
    execFileSync('pnpm', ['build'], { cwd: targetDirectory, stdio: 'inherit' });
    execFileSync('pnpm', ['test'], { cwd: targetDirectory, stdio: 'inherit' });
    execFileSync('pnpm', ['exec', 'konekti', 'g', 'repo', 'User'], { cwd: targetDirectory, stdio: 'inherit' });

    expect(readFileSync(join(targetDirectory, 'src', 'user.repo.ts'), 'utf8')).toContain('this.prisma.current()');
  }, 240000);

  it('creates runnable npm and yarn starter projects in local-package mode', async () => {
    const npmDirectory = mkdtempSync(join(tmpdir(), 'create-konekti-npm-'));
    const yarnDirectory = mkdtempSync(join(tmpdir(), 'create-konekti-yarn-'));
    createdDirectories.push(npmDirectory, yarnDirectory);

    await scaffoldKonektiApp({
      database: 'PostgreSQL',
      dependencySource: 'local',
      orm: 'Prisma',
      packageManager: 'npm',
      projectName: 'starter-app',
      repoRoot,
      targetDirectory: npmDirectory,
    });
    await scaffoldKonektiApp({
      database: 'PostgreSQL',
      dependencySource: 'local',
      orm: 'Drizzle',
      packageManager: 'yarn',
      projectName: 'starter-app',
      repoRoot,
      targetDirectory: yarnDirectory,
    });

    execFileSync('npm', ['run', 'typecheck'], { cwd: npmDirectory, stdio: 'inherit' });
    execFileSync('npm', ['run', 'build'], { cwd: npmDirectory, stdio: 'inherit' });
    execFileSync('npm', ['run', 'test'], { cwd: npmDirectory, stdio: 'inherit' });
    execFileSync('npm', ['exec', '--', 'konekti', 'g', 'repo', 'Account'], { cwd: npmDirectory, stdio: 'inherit' });

    execFileSync('yarn', ['run', 'typecheck'], { cwd: yarnDirectory, stdio: 'inherit' });
    execFileSync('yarn', ['run', 'build'], { cwd: yarnDirectory, stdio: 'inherit' });
    execFileSync('yarn', ['run', 'test'], { cwd: yarnDirectory, stdio: 'inherit' });
    execFileSync('yarn', ['konekti', 'g', 'repo', 'Ledger'], { cwd: yarnDirectory, stdio: 'inherit' });

    expect(readFileSync(join(npmDirectory, 'src', 'account.repo.ts'), 'utf8')).toContain('this.prisma.current()');
    expect(readFileSync(join(yarnDirectory, 'src', 'ledger.repo.ts'), 'utf8')).toContain('this.database.current()');
  }, 240000);
});
