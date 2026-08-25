import type { NextConfig } from 'next';
import { describe, expect, it } from 'vitest';

import { withFluoNextBackend } from './next-config.js';

describe('withFluoNextBackend', () => {
  it('adds the packaged decorator loader while preserving Turbopack config', () => {
    const markdownRule = {
      as: '*.js',
      loaders: ['raw-loader'],
    };
    const existingTypeScriptRule = {
      as: '*.js',
      loaders: ['existing-loader'],
    };
    const input = {
      typedRoutes: true,
      turbopack: {
        resolveAlias: {
          legacy: 'modern',
        },
        rules: {
          '*.md': markdownRule,
          '*.ts': existingTypeScriptRule,
        },
      },
    };

    const result = withFluoNextBackend(input);

    expect(result).toEqual({
      typedRoutes: true,
      turbopack: {
        resolveAlias: {
          legacy: 'modern',
        },
        rules: {
          '*.md': markdownRule,
          '*.ts': [
            existingTypeScriptRule,
            {
              as: '*.js',
              condition: {
                all: [
                  { not: 'foreign' },
                  { not: 'browser' },
                  { content: /@\w+/u },
                ],
              },
              loaders: [
                {
                  loader: expect.stringMatching(/decorators-loader\.cjs$/u),
                },
              ],
            },
          ],
        },
      },
    });
    expect(input.turbopack.rules['*.ts']).toBe(existingTypeScriptRule);
  });

  it('returns a configuration assignable to NextConfig', () => {
    const result: NextConfig = withFluoNextBackend({});

    expect(result.turbopack).toBeDefined();
  });
});
