import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nError } from '../errors.js';
import type { I18nErrorCode } from '../types.js';
import { createFileSystemI18nLoader, FileSystemI18nLoader } from './fs.js';

let rootDir: string;

async function writeCatalog(locale: string, namespace: string, contents: string): Promise<void> {
  const namespaceParts = namespace.split('/');
  const fileName = `${namespaceParts.pop() ?? namespace}.json`;
  const directory = join(rootDir, locale, ...namespaceParts);

  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, fileName), contents, 'utf8');
}

async function expectI18nRejection(action: () => Promise<unknown>, code: I18nErrorCode): Promise<void> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(I18nError);
    expect((error as I18nError).code).toBe(code);
    return;
  }

  throw new Error(`Expected action to fail with ${code}.`);
}

function expectI18nThrow(action: () => unknown, code: I18nErrorCode): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(I18nError);
    expect((error as I18nError).code).toBe(code);
    return;
  }

  throw new Error(`Expected action to fail with ${code}.`);
}

describe('@fluojs/i18n/loaders/fs', () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'fluo-i18n-fs-'));
  });

  afterEach(async () => {
    await rm(rootDir, { force: true, recursive: true });
  });

  it('loads and freezes JSON catalogs from locale and namespace paths', async () => {
    await writeCatalog('en', 'common/actions', JSON.stringify({ save: 'Save', nested: { cancel: 'Cancel' } }));

    const loader = createFileSystemI18nLoader({ rootDir });
    const catalog = await loader.load('en', 'common/actions');

    expect(catalog).toEqual({ save: 'Save', nested: { cancel: 'Cancel' } });
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.nested)).toBe(true);
  });

  it('fails with a stable code for missing catalog files', async () => {
    const loader = new FileSystemI18nLoader({ rootDir });

    await expectI18nRejection(() => loader.load('en', 'missing'), 'I18N_MISSING_CATALOG');
  });

  it('fails with a stable code for malformed JSON', async () => {
    await writeCatalog('en', 'common', '{');

    const loader = new FileSystemI18nLoader({ rootDir });

    await expectI18nRejection(() => loader.load('en', 'common'), 'I18N_INVALID_CATALOG');
  });

  it('fails with a stable code for valid JSON that is not a message tree', async () => {
    await writeCatalog('en', 'array', JSON.stringify(['not', 'a', 'tree']));
    await writeCatalog('en', 'number', JSON.stringify(123));
    await writeCatalog('en', 'boolean-entry', JSON.stringify({ enabled: true }));
    await writeCatalog('en', 'array-entry', JSON.stringify({ labels: ['save'] }));
    await writeCatalog('en', 'empty-key', JSON.stringify({ '': 'blank' }));

    const loader = new FileSystemI18nLoader({ rootDir });

    await expectI18nRejection(() => loader.load('en', 'array'), 'I18N_INVALID_CATALOG');
    await expectI18nRejection(() => loader.load('en', 'number'), 'I18N_INVALID_CATALOG');
    await expectI18nRejection(() => loader.load('en', 'boolean-entry'), 'I18N_INVALID_CATALOG');
    await expectI18nRejection(() => loader.load('en', 'array-entry'), 'I18N_INVALID_CATALOG');
    await expectI18nRejection(() => loader.load('en', 'empty-key'), 'I18N_INVALID_CATALOG');
  });

  it('rejects invalid rootDir constructor options', () => {
    const invalidOptions: readonly unknown[] = [
      undefined,
      null,
      {},
      { rootDir: '' },
      { rootDir: '   ' },
      { rootDir: 123 },
    ];

    for (const options of invalidOptions) {
      expectI18nThrow(
        () => new FileSystemI18nLoader(options as { readonly rootDir: string }),
        'I18N_INVALID_LOADER_OPTIONS',
      );
    }
  });

  it('fails before disk reads for invalid locale values', async () => {
    const loader = new FileSystemI18nLoader({ rootDir });

    await expectI18nRejection(() => loader.load('../en', 'common'), 'I18N_INVALID_LOADER_OPTIONS');
    await expectI18nRejection(() => loader.load('', 'common'), 'I18N_INVALID_LOADER_OPTIONS');
  });

  it('fails before disk reads for invalid namespace values', async () => {
    const loader = new FileSystemI18nLoader({ rootDir });

    await expectI18nRejection(() => loader.load('en', ''), 'I18N_INVALID_LOADER_OPTIONS');
    await expectI18nRejection(() => loader.load('en', 'common.json'), 'I18N_INVALID_LOADER_OPTIONS');
  });

  it('rejects namespace traversal attempts before resolving files', async () => {
    const loader = new FileSystemI18nLoader({ rootDir });

    await expectI18nRejection(() => loader.load('en', '../secrets'), 'I18N_INVALID_LOADER_OPTIONS');
    await expectI18nRejection(() => loader.load('en', 'common/../../secrets'), 'I18N_INVALID_LOADER_OPTIONS');
    await expectI18nRejection(() => loader.load('en', 'common\\..\\secrets'), 'I18N_INVALID_LOADER_OPTIONS');
  });

  it('rejects absolute namespace paths before resolving files', async () => {
    const loader = new FileSystemI18nLoader({ rootDir });

    await expectI18nRejection(() => loader.load('en', '/common'), 'I18N_INVALID_LOADER_OPTIONS');
    await expectI18nRejection(() => loader.load('en', `${rootDir}/common`), 'I18N_INVALID_LOADER_OPTIONS');
  });
});
