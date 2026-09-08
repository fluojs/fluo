import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, matchesGlob } from 'node:path';
import * as ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { verifyBookSeries } from './verify-book-series.mjs';

const roots: string[] = [];

function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'fluo-book-series-'));
  roots.push(root);
  const volumes = [24, 28, 20].map((count, index) => ({
    id: `0${index + 1}-volume`,
    chapters: Array.from({ length: count }, (_, number) => ({
      number: number + 1,
      slug: `ch${String(number + 1).padStart(2, '0')}-subject`,
      packages: ['@fluojs/core'],
    })),
  }));
  put(root, 'book/series.json', JSON.stringify({ schemaVersion: 1, originalLanguage: 'ko', volumes }));
  put(root, 'packages/core/package.json', JSON.stringify({ name: '@fluojs/core' }));
  for (const suffix of ['.ko', '']) {
    put(root, `book/README${suffix}.md`, '# Series\n');
    put(root, `book/EDITORIAL${suffix}.md`, '# Editorial\n');
    for (const volume of volumes) {
      put(root, `book/${volume.id}/README${suffix}.md`, '# Volume\n');
      put(root, `book/${volume.id}/toc${suffix}.md`, volume.chapters.map((chapter) =>
        `[${chapter.number}](./${chapter.slug}${suffix}.md)`,
      ).join('\n'));
      for (const chapter of volume.chapters) {
        put(root, `book/${volume.id}/${chapter.slug}${suffix}.md`, [
          `<!-- book:volume=${volume.id};chapter=${String(chapter.number).padStart(2, '0')} -->`,
          '# Chapter',
          '',
          `[Contents](./toc${suffix}.md)`,
          '',
          '```ts',
          'const amount = 100;',
          '```',
          '',
        ].join('\n'));
      }
    }
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('book series verification', () => {
  it('discovers both test and spec files in the published book configuration', () => {
    // Given: the exact configuration readers copy in the testing chapter.
    const chapter = readFileSync(
      new URL('../../book/01-fluoblog/ch04-testing-from-the-start.ko.md', import.meta.url),
      'utf8',
    );
    const config = [...chapter.matchAll(/```ts\n([\s\S]*?)\n```/g)]
      .map((match) => match[1])
      .find((code) => code?.includes('defineConfig'));
    if (!config) throw new Error('Missing executable Vitest configuration');
    const source = ts.createSourceFile('vitest.config.ts', config, ts.ScriptTarget.Latest, true);
    const exported = source.statements.find(ts.isExportAssignment);
    if (!exported || !ts.isCallExpression(exported.expression)) {
      throw new Error('Expected an exported Vitest configuration call');
    }
    const options = exported.expression.arguments[0];
    if (!options || !ts.isObjectLiteralExpression(options)) {
      throw new Error('Expected literal Vitest options');
    }
    const property = (object: ts.ObjectLiteralExpression, name: string): ts.Expression => {
      const entry = object.properties.find((candidate) =>
        ts.isPropertyAssignment(candidate) && candidate.name.getText(source) === name,
      );
      if (!entry || !ts.isPropertyAssignment(entry)) throw new Error(`Missing ${name} option`);
      return entry.initializer;
    };
    const test = property(options, 'test');
    if (!ts.isObjectLiteralExpression(test)) throw new Error('Expected literal test options');
    const includes = property(test, 'include');
    if (!ts.isArrayLiteralExpression(includes)) throw new Error('Expected include patterns');
    const patterns = includes.elements.map((element) => {
      if (!ts.isStringLiteral(element)) throw new Error('Expected a literal include glob');
      return element.text;
    });

    // When / Then: later chapter files are discoverable without including ordinary source.
    for (const path of [
      'src/posts/posts.test.ts',
      'src/operations/lifecycle-order.spec.ts',
      'src/pages/reading.spec.tsx',
      'test/posts.e2e.test.ts',
      'test/release-app.spec.ts',
      'test/reading.test.tsx',
    ]) {
      expect(patterns.some((pattern) => matchesGlob(path, pattern)), path).toBe(true);
    }
    expect(patterns.some((pattern) => matchesGlob('src/posts/posts.service.ts', pattern))).toBe(false);
  });

  it('allows the Korean stage before any English chapter exists', () => {
    // Given
    const root = fixture();
    rmSync(join(root, 'book/01-volume/ch01-subject.md'));
    // When
    const result = verifyBookSeries(root, { locale: 'ko' });
    // Then
    expect(result.issues).toEqual([]);
    expect(result.chapters).toBe(72);
  });

  it('rejects a missing Korean chapter', () => {
    const root = fixture();
    rmSync(join(root, 'book/01-volume/ch01-subject.ko.md'));
    const result = verifyBookSeries(root, { locale: 'ko' });
    expect(result.issues).toContainEqual({
      code: 'missing-file', path: 'book/01-volume/ch01-subject.ko.md',
    });
  });

  it('requires the English counterpart at the translation gate', () => {
    const root = fixture();
    rmSync(join(root, 'book/01-volume/ch01-subject.md'));
    const result = verifyBookSeries(root);
    expect(result.issues).toContainEqual({
      code: 'missing-file', path: 'book/01-volume/ch01-subject.md',
    });
  });

  it('rejects a chapter identifier that disagrees with the manifest', () => {
    const root = fixture();
    put(root, 'book/01-volume/ch01-subject.ko.md', '<!-- book:volume=01-volume;chapter=02 -->\n');
    const result = verifyBookSeries(root, { locale: 'ko' });
    expect(result.issues.some((issue) => issue.code === 'chapter-identity')).toBe(true);
  });

  it('rejects a changed executable code block in translation', () => {
    const root = fixture();
    put(root, 'book/01-volume/ch01-subject.md', [
      '<!-- book:volume=01-volume;chapter=01 -->',
      '# Chapter',
      '```ts',
      'const amount = 200;',
      '```',
    ].join('\n'));
    const result = verifyBookSeries(root);
    expect(result.issues.some((issue) => issue.code === 'code-parity')).toBe(true);
  });

  it('rejects a broken local link without requesting external URLs', () => {
    const root = fixture();
    put(root, 'book/01-volume/README.ko.md', '[Missing](./missing.ko.md)\n[External](https://example.invalid)\n');
    const result = verifyBookSeries(root, { locale: 'ko' });
    expect(result.issues).toContainEqual({
      code: 'broken-link',
      path: 'book/01-volume/README.ko.md',
      target: './missing.ko.md',
    });
  });

  it('rejects a table of contents that omits a declared chapter', () => {
    const root = fixture();
    put(root, 'book/01-volume/toc.ko.md', '# Contents\n');
    const result = verifyBookSeries(root, { locale: 'ko' });
    expect(result.issues.some((issue) => issue.code === 'toc-order')).toBe(true);
  });

  it('does not validate Markdown-shaped text inside executable fences as links', () => {
    const root = fixture();
    put(root, 'book/01-volume/README.ko.md', '```ts\nconst text = "[not a link](./missing.md)";\n```\n');
    expect(verifyBookSeries(root, { locale: 'ko' }).issues).toEqual([]);
  });

  it('rejects a reduced manifest rather than hiding unwritten chapters', () => {
    const root = fixture();
    put(root, 'book/series.json', JSON.stringify({ schemaVersion: 1, originalLanguage: 'ko', volumes: [] }));
    const result = verifyBookSeries(root, { locale: 'ko' });
    expect(result.issues.some((issue) => issue.code === 'manifest-shape')).toBe(true);
  });
});
