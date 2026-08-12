import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readDocument(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function requireMarkdownSection(path: string, markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const matchingHeadings = lines.filter((line) => line === heading);
  const start = lines.indexOf(heading);
  const headingLevel = /^(#{1,6})\s/u.exec(heading)?.[1]?.length ?? 0;

  expect(matchingHeadings, `${path} [${heading}] section must exist exactly once`).toHaveLength(1);
  expect(headingLevel, `${path} [${heading}] must be a Markdown heading`).toBeGreaterThan(0);

  const followingLines = lines.slice(start + 1);
  let relativeEnd = followingLines.length;
  let insideCodeFence = false;

  for (const [index, line] of followingLines.entries()) {
    if (/^\s*```/u.test(line)) {
      insideCodeFence = !insideCodeFence;
      continue;
    }

    const level = /^(#{1,6})\s/u.exec(line)?.[1]?.length;
    if (!insideCodeFence && level !== undefined && level <= headingLevel) {
      relativeEnd = index;
      break;
    }
  }

  return followingLines.slice(0, relativeEnd).join('\n');
}

function requireTableRow(path: string, markdown: string, firstCell: string): string {
  const prefix = `| ${firstCell} |`;
  const matches = markdown.split('\n').filter((line) => line.startsWith(prefix));

  expect(matches, `${path} [table row: ${firstCell}] must exist exactly once`).toHaveLength(1);
  return matches.at(0) ?? '';
}

function requireListItem(path: string, markdown: string, prefix: string): string {
  const matches = markdown.split('\n').filter((line) => line.startsWith(prefix));

  expect(matches, `${path} [list item: ${prefix}] must exist exactly once`).toHaveLength(1);
  return matches.at(0) ?? '';
}

function requireParagraph(path: string, markdown: string, prefix: string): string {
  const matches = markdown.split(/\n{2,}/u).filter((paragraph) => paragraph.startsWith(prefix));

  expect(matches, `${path} [paragraph: ${prefix}] must exist exactly once`).toHaveLength(1);
  return matches.at(0) ?? '';
}

function assertMarkers(path: string, context: string, content: string, markers: readonly string[]): void {
  for (const marker of markers) {
    expect(content, `${path} [${context}] must contain semantic anchor ${marker}`).toContain(marker);
  }
}

function readProperty(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

describe('Event Bus Redis documentation', () => {
  it('rejects semantic anchors that appear outside the governed Redis section', () => {
    // Given
    const path = 'fixture.md';
    const heading = '### Distributed Fan-out (Redis)';
    const markdown = `## Common Patterns

${heading}

Redis transport guidance is missing.

### Unrelated Example

ioredis publishClient subscribeClient
`;

    // When / Then
    expect(() => {
      const section = requireMarkdownSection(path, markdown, heading);
      assertMarkers(path, heading, section, ['ioredis', 'publishClient', 'subscribeClient']);
    }).toThrowError(/fixture\.md.*Distributed Fan-out \(Redis\).*ioredis/u);
  });

  it('rejects semantic anchors that appear outside the governed chooser row', () => {
    // Given
    const path = 'chooser.md';
    const firstCell = 'Need in-process domain events';
    const markdown = `| condition | package choice | notes |
| --- | --- | --- |
| ${firstCell} | @fluojs/event-bus | Local only. |
| Unrelated Redis tool | ioredis | publishClient subscribeClient |
`;

    // When / Then
    expect(() => {
      const row = requireTableRow(path, markdown, firstCell);
      assertMarkers(path, `table row: ${firstCell}`, row, ['ioredis', 'publishClient', 'subscribeClient']);
    }).toThrowError(/chooser\.md.*table row: Need in-process domain events.*ioredis/u);
  });

  it('documents the optional peer at its package manifest keys', () => {
    // Given
    const path = 'packages/event-bus/package.json';
    const manifest: unknown = JSON.parse(readDocument(path));
    const peerDependencies = readProperty(manifest, 'peerDependencies');
    const peerDependenciesMeta = readProperty(manifest, 'peerDependenciesMeta');

    // When / Then
    expect(readProperty(peerDependencies, 'ioredis'), `${path} [peerDependencies.ioredis]`).toBe('^5.0.0');
    expect(
      readProperty(readProperty(peerDependenciesMeta, 'ioredis'), 'optional'),
      `${path} [peerDependenciesMeta.ioredis.optional]`,
    ).toBe(true);
  });

  it('keeps installation and client ownership guidance in package and book Redis sections', () => {
    const guides = [
      ['packages/event-bus/README.md', '## Installation', '### Distributed Fan-out (Redis)'],
      ['packages/event-bus/README.ko.md', '## 설치', '### 분산 팬아웃 (Redis)'],
      ['book/intermediate/ch09-event-bus.md', '### 9.2.2 Module wiring with Redis fan-out', undefined],
      ['book/intermediate/ch09-event-bus.ko.md', '### 9.2.2 Module wiring with Redis fan-out', undefined],
    ] as const;

    for (const [path, primaryHeading, redisHeading] of guides) {
      // Given
      const markdown = readDocument(path);
      const installationSection = requireMarkdownSection(path, markdown, primaryHeading);
      const redisSection = redisHeading
        ? requireMarkdownSection(path, markdown, redisHeading)
        : installationSection;

      // When / Then
      assertMarkers(path, primaryHeading, installationSection, ['npm install @fluojs/event-bus ioredis']);
      assertMarkers(path, redisHeading ?? primaryHeading, redisSection, [
        '@fluojs/event-bus/redis',
        "from 'ioredis'",
        'const publishClient = new Redis(',
        'const subscribeClient = new Redis(',
        'close()',
      ]);
    }
  });

  it('keeps peer and client anchors in each canonical Event Bus Redis reference location', () => {
    const contextDocuments = [
      ['docs/CONTEXT.md', 'Event-bus package-surface discoverability'],
      ['docs/CONTEXT.ko.md', 'Event-bus package-surface discoverability'],
    ] as const;
    const chooserRows = [
      ['docs/reference/package-chooser.md', 'Need in-process domain events with optional cross-process fan-out'],
      ['docs/reference/package-chooser.ko.md', 'optional cross-process fan-out이 있는 in-process domain event가 필요함'],
    ] as const;
    const surfaceDocuments = ['docs/reference/package-surface.md', 'docs/reference/package-surface.ko.md'] as const;
    const markers = ['@fluojs/event-bus/redis', 'ioredis', 'publishClient', 'subscribeClient'] as const;

    for (const [path, prefix] of contextDocuments) {
      const paragraph = requireParagraph(path, readDocument(path), prefix);
      assertMarkers(path, `paragraph: ${prefix}`, paragraph, markers);
    }
    for (const [path, firstCell] of chooserRows) {
      const row = requireTableRow(path, readDocument(path), firstCell);
      assertMarkers(path, `table row: ${firstCell}`, row, markers);
    }
    for (const path of surfaceDocuments) {
      const prefix = '- **`@fluojs/event-bus/redis`**:';
      const item = requireListItem(path, readDocument(path), prefix);
      assertMarkers(path, `list item: ${prefix}`, item, markers);
    }
  });
});
