import { describe, expect, it } from 'vitest';

import { resolveInstallCommand } from './install.js';

describe('resolveInstallCommand', () => {
  it('uses direct install commands for bun, pnpm, and npm', () => {
    expect(resolveInstallCommand('bun')).toEqual({
      args: ['install'],
      command: 'bun',
    });
    expect(resolveInstallCommand('pnpm')).toEqual({
      args: ['install'],
      command: 'pnpm',
    });
    expect(resolveInstallCommand('npm')).toEqual({
      args: ['install'],
      command: 'npm',
    });
  });

  it('uses the corepack yarn install path when corepack is available', () => {
    expect(resolveInstallCommand('yarn', { isCorepackAvailable: true })).toEqual({
      args: ['yarn', 'install'],
      command: 'corepack',
    });
  });

  it('falls back to direct yarn install when corepack is unavailable', () => {
    expect(resolveInstallCommand('yarn', { isCorepackAvailable: false })).toEqual({
      args: ['install'],
      command: 'yarn',
    });
  });
});
