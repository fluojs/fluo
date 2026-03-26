import { describe, expect, it } from 'vitest';

import { resolveInstallCommand } from './install.js';

describe('resolveInstallCommand', () => {
  it('uses direct install commands for pnpm and npm', () => {
    expect(resolveInstallCommand('pnpm')).toEqual({
      args: ['install'],
      command: 'pnpm',
    });
    expect(resolveInstallCommand('npm')).toEqual({
      args: ['install'],
      command: 'npm',
    });
  });

  it('uses the corepack yarn install path only when yarn is selected', () => {
    expect(resolveInstallCommand('yarn')).toEqual({
      args: ['yarn', 'install', '--no-cache'],
      command: 'corepack',
    });
  });
});
