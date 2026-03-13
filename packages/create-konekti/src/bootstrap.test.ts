import { describe, expect, it } from 'vitest';

import { createTierNote, getCreateKonektiPrompts, resolveSupportTier } from './bootstrap/prompt.js';

describe('create-konekti prompt flow', () => {
  it('keeps the MVP prompt order', () => {
    expect(getCreateKonektiPrompts().map((prompt) => prompt.label)).toEqual([
      'Project name',
      'ORM',
      'Database',
      'Package manager',
      'Tier note',
      'Target directory',
    ]);
  });

  it('resolves support tiers and tier notes', () => {
    expect(resolveSupportTier('Prisma', 'PostgreSQL')).toBe('recommended');
    expect(resolveSupportTier('Drizzle', 'PostgreSQL')).toBe('official');
    expect(resolveSupportTier('Drizzle', 'MySQL')).toBe('preview');
    expect(createTierNote('Prisma', 'PostgreSQL')).toContain('recommended');
    expect(createTierNote('Drizzle', 'MySQL')).toContain('preview');
  });
});
