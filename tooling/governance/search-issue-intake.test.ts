import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const intakeScript = resolve(
  process.cwd(),
  '.agents/skills/search-issue/scripts/intake.mjs',
);

const runIntake = (...arguments_: readonly string[]): string =>
  execFileSync(process.execPath, [intakeScript, ...arguments_], {
    encoding: 'utf8',
  }).trim();

const runJson = (...arguments_: readonly string[]): unknown =>
  JSON.parse(runIntake(...arguments_));

describe('$search-issue target intake', () => {
  it('offers all, group, and package target modes', () => {
    expect(runJson('modes')).toEqual([
      {
        id: 'all',
        label: '전체 패키지',
        description: '모든 public @fluojs/* 패키지를 감사합니다.',
      },
      {
        id: 'group',
        label: '특정 패키지군',
        description: '하나 이상의 패키지군을 선택합니다.',
      },
      {
        id: 'package',
        label: '특정 패키지',
        description: '하나 이상의 개별 패키지를 선택합니다.',
      },
    ]);
  });

  it.each([
    ['all', [], ['core', 'config', 'di', 'i18n', 'runtime']],
    ['group', ['foundation'], ['core', 'config', 'di', 'i18n', 'runtime']],
    ['package', ['runtime', 'http'], ['runtime', 'http']],
  ])('resolves the %s target mode', (mode, selections, expected) => {
    const scope = runJson('resolve', mode, ...selections);

    expect(scope).toMatchObject({
      mode,
      packages: expect.arrayContaining(expected),
    });
  });

  it('renders every package group with its packages', () => {
    const catalog = runIntake('packages');

    expect(catalog).toContain('| 패키지군 | 설명 | 포함 패키지 |');
    expect(catalog).toContain('| foundation |');
    expect(catalog).toContain('@fluojs/runtime');
    expect(catalog).toContain('| cli |');
    expect(catalog).toContain('@fluojs/vite');
  });
});

describe('$search-issue purpose intake', () => {
  it('renders every purpose with a user-facing description', () => {
    const catalog = runIntake('purposes');

    expect(catalog).toContain('| 감사 목적 | 살펴보는 내용 |');
    expect(catalog).toContain('| bug-finding |');
    expect(catalog).toContain('| contract-api |');
    expect(catalog).toContain('| release-impact |');
    expect(catalog).toContain('| comprehensive |');
  });
});
