import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8');
const navigationSource = source('packages/http/src/dispatch/dispatch-response-policy.ts');
const formSource = source('packages/http/src/form-representation.ts');
const exportsSource = source('packages/http/src/index.portable.ts');
const navigationMediaType = navigationSource.match(/application\/vnd\.fluo\.react-navigation\+json;v=\d+/u)?.[0];
const formMediaType = formSource.match(/application\/vnd\.fluo\.form\+json;v=\d+/u)?.[0];
const formExports = ['HttpFormRejection', 'HttpFormErrors', 'HttpFormRepresentationProvider'];
const locales = [
  { path: 'packages/http/README.md', apiHeading: 'Public API', suffix: '' },
  { path: 'packages/http/README.ko.md', apiHeading: '공개 API', suffix: '.ko' },
];

function section(readme: string, heading: string): string {
  const lines = readme.split('\n');
  const anchor = `## ${heading}`;
  expect(lines.filter((line) => line === anchor), `Expected exactly one "${anchor}" heading`).toHaveLength(1);
  return lines.slice(lines.indexOf(anchor) + 1).join('\n').split('\n## ')[0] ?? '';
}

function checkNavigation(readme: string): void {
  const navigation = section(readme, 'HTTP-Owned React Navigation');
  expect(navigationMediaType).toBe('application/vnd.fluo.react-navigation+json;v=2');
  expect(navigation).toContain(`Accept: ${navigationMediaType}`);
  expect(navigation).toContain('version 2');
  expect(navigation, 'Navigation instructions must not contain stale v1').not.toMatch(/version 1|react-navigation\+json;v=1/u);
}

function checkFormExports(readme: string, apiHeading: string): void {
  const api = section(readme, apiHeading);
  for (const name of formExports) {
    expect(exportsSource).toMatch(new RegExp(`export (?:type )?\\{[^}]*\\b${name}\\b[^}]*\\} from './form-representation.js'`, 'u'));
    expect(api).toContain(`\`${name}\``);
  }
}

it.each(locales)('HTTP README $path: current navigation -> matches runtime v2', ({ path }) => {
  const readme = source(path);

  checkNavigation(readme);
});

it.each(locales)('HTTP README $path: public form API -> documents existing exports', ({ path, apiHeading }) => {
  const readme = source(path);

  checkFormExports(readme, apiHeading);
});

it.each(locales)('HTTP README $path: form guidance -> preserves independent form v1 and locale links', ({ path, suffix }) => {
  const readme = source(path);
  const errors = section(readme, 'HTTP Error Representations');

  expect(formMediaType).toBe('application/vnd.fluo.form+json;v=1');
  expect(errors).toContain(`Accept: ${formMediaType}`);
  expect(errors).toContain('errorRepresentation.form.project');
  expect(errors).toContain('HttpErrorRepresentationContext');
  expect(errors).toContain('HttpFormErrors | undefined');
  expect(errors).toContain('Promise<HttpFormErrors | undefined>');
  expect(errors).toContain('fieldErrors');
  expect(errors).toContain('formErrors');
  expect(readme).toContain(`../../docs/contracts/react-progressive-forms${suffix}.md`);
  expect(readme).toContain(`../../docs/contracts/react-navigation-payload${suffix}.md`);
});

for (const locale of locales) {
  it.each([
    'HTTP-Owned React Navigation',
    'HTTP Error Representations',
    locale.apiHeading,
  ])(`HTTP README ${locale.path}: missing section %s -> rejected by heading count`, (heading) => {
    const readme = source(locale.path);

    const variant = readme.replace(`\n## ${heading}\n`, `\n### ${heading}\n`);

    expect(variant).not.toBe(readme);
    expect(() => section(variant, heading)).toThrow(`Expected exactly one "## ${heading}" heading`);
  });

  it.each([
    'HTTP-Owned React Navigation',
    'HTTP Error Representations',
    locale.apiHeading,
  ])(`HTTP README ${locale.path}: duplicate section %s -> rejected by heading count`, (heading) => {
    const readme = source(locale.path);

    const variant = `${readme}\n## ${heading}\nUse version 1 navigation with Accept: application/vnd.fluo.react-navigation+json;v=1.\n`;

    expect(() => section(variant, heading)).toThrow(`Expected exactly one "## ${heading}" heading`);
  });

  it.each([
    'Use Accept: application/vnd.fluo.react-navigation+json;v=1 for navigation.',
    'Use version 1 for navigation.',
  ])(`HTTP README ${locale.path}: added stale instruction %s with v2 retained -> rejected specifically`, (instruction) => {
    const readme = source(locale.path);

    const variant = readme.replace('\n## HTTP-Owned React Navigation\n', `\n## HTTP-Owned React Navigation\n${instruction}\n`);

    expect(variant).not.toBe(readme);
    expect(section(variant, 'HTTP-Owned React Navigation')).toContain(`Accept: ${navigationMediaType}`);
    expect(section(variant, 'HTTP-Owned React Navigation')).toContain('version 2');
    expect(() => checkNavigation(variant)).toThrow('Navigation instructions must not contain stale v1');
  });

  it.each([
    ['media type', 'application/vnd.fluo.react-navigation+json;v=2', 'application/vnd.fluo.react-navigation+json;v=1'],
    ['version description', 'version 2', 'version 1'],
  ])(`HTTP README ${locale.path}: stale navigation %s -> rejected`, (_label, current, stale) => {
    const readme = source(locale.path);

    const variant = readme.replaceAll(current, stale);

    expect(variant).not.toBe(readme);
    expect(() => checkNavigation(variant)).toThrow();
  });

  it.each(formExports)(`HTTP README ${locale.path}: missing %s -> rejected`, (name) => {
    const readme = source(locale.path);

    const variant = readme.replaceAll(name, 'RemovedFormExport');

    expect(variant).not.toBe(readme);
    expect(() => checkFormExports(variant, locale.apiHeading)).toThrow();
  });
}
