import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('Terminus Prisma optional-peer discoverability', () => {
  it('keeps provider diagnostics discoverable across governed docs', () => {
    const englishContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const koreanContext = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
    const englishSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const koreanSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
    const englishChapter = readFileSync(join(repoRoot, 'book/beginner/ch18-health.md'), 'utf8');
    const koreanChapter = readFileSync(join(repoRoot, 'book/beginner/ch18-health.ko.md'), 'utf8');
    const englishReadme = readFileSync(join(repoRoot, 'packages/terminus/README.md'), 'utf8');
    const koreanReadme = readFileSync(join(repoRoot, 'packages/terminus/README.ko.md'), 'utf8');

    expect(englishReadme).toContain('optional Prisma peer');
    expect(englishSurface).toContain('optional Redis or Prisma peers');
    expect(englishChapter).toContain('optional Redis or Prisma peers');
    expect(englishContext).toContain('Prisma named service/client provider seams');

    expect(koreanReadme).toContain('optional Prisma peer');
    expect(koreanSurface).toContain('optional Redis 또는 Prisma peer');
    expect(koreanChapter).toContain('선택적 Redis 또는 Prisma peer');
    expect(koreanContext).toContain('Prisma named service/client provider seam');
  });
});
