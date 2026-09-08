import type { NextConfig } from 'next';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { type FluoNextBackendOptions, withFluoNextBackend } from './next-config.js';

describe('withFluoNextBackend', () => {
  it('restricts decorator compilation to the declared backend paths', () => {
    const result = withFluoNextBackend({}, {
      include: /(?:^|\/)backend(?:\/|\.ts$)/u,
      exclude: '**/*.test.ts',
    });

    expect(result.turbopack?.rules?.['*.ts']).toMatchObject({
      condition: {
        all: [
          { not: 'foreign' },
          { not: 'browser' },
          { content: /@\w+/u },
          { path: /(?:^|\/)backend(?:\/|\.ts$)/u },
          { not: { path: '**/*.test.ts' } },
        ],
      },
    });
  });

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

  it('preserves module paths only when explicitly requested', () => {
    const preserved = withFluoNextBackend({}, { preserveModulePaths: true });
    const legacy = withFluoNextBackend({}, { preserveModulePaths: false });

    expect(preserved.turbopack?.rules?.['*.ts']).not.toHaveProperty('as');
    expect(preserved.turbopack?.rules?.['*.ts']).not.toHaveProperty('type');
    expect(legacy.turbopack?.rules?.['*.ts']).toHaveProperty('as', '*.js');
    expect(withFluoNextBackend()).toEqual(withFluoNextBackend({}, {}));
  });

  it('appends after every existing rule without mutating frozen input', () => {
    const first = Object.freeze({ loaders: ['first-loader'] });
    const second = Object.freeze({ loaders: ['second-loader'], as: '*.js' });
    const originalRules = [first, second];
    Object.freeze(originalRules);
    const input = Object.freeze({
      turbopack: Object.freeze({
        rules: Object.freeze({ '*.ts': originalRules, '*.txt': first }),
      }),
    });
    const options = Object.freeze({
      include: '**/backend/**',
      exclude: /\.test\.ts$/u,
      preserveModulePaths: true,
    });

    const result = withFluoNextBackend(input, options);

    expect(Object.keys(result.turbopack?.rules ?? {})).toEqual(['*.ts', '*.txt']);
    expect(result.turbopack?.rules?.['*.ts']).toEqual([
      first,
      second,
      {
        condition: {
          all: [
            { not: 'foreign' },
            { not: 'browser' },
            { content: /@\w+/u },
            { path: '**/backend/**' },
            { not: { path: /\.test\.ts$/u } },
          ],
        },
        loaders: [{ loader: expect.stringMatching(/decorators-loader\.cjs$/u) }],
      },
    ]);
    expect(input.turbopack.rules['*.ts']).toBe(originalRules);
    expect(originalRules).toEqual([first, second]);
    expect(result.turbopack?.rules?.['*.txt']).toBe(first);
  });

  it('allows exclusion without widening browser or foreign guards', () => {
    const result = withFluoNextBackend({}, { exclude: /client/u });

    expect(result.turbopack?.rules?.['*.ts']).toMatchObject({
      condition: {
        all: [
          { not: 'foreign' },
          { not: 'browser' },
          { content: /@\w+/u },
          { not: { path: /client/u } },
        ],
      },
    });
  });

  it('does not share generated mutable rule records between calls', () => {
    const first = withFluoNextBackend();
    const second = withFluoNextBackend();

    expect(first.turbopack?.rules?.['*.ts']).toEqual(second.turbopack?.rules?.['*.ts']);
    expect(first.turbopack?.rules?.['*.ts']).not.toBe(second.turbopack?.rules?.['*.ts']);
  });

  it('exports typed opt-in options without replacing the NextConfig contract', () => {
    expectTypeOf(withFluoNextBackend).returns.toEqualTypeOf<NextConfig>();
    expectTypeOf<FluoNextBackendOptions['include']>()
      .toEqualTypeOf<string | RegExp | undefined>();
    expectTypeOf<FluoNextBackendOptions['exclude']>()
      .toEqualTypeOf<string | RegExp | undefined>();
    expectTypeOf<FluoNextBackendOptions['preserveModulePaths']>()
      .toEqualTypeOf<boolean | undefined>();
    expectTypeOf<{ include: string[] }>().not.toExtend<FluoNextBackendOptions>();
    expectTypeOf<{ preserveModulePaths: string }>().not.toExtend<FluoNextBackendOptions>();
  });
});
