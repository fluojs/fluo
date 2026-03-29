import { describe, expect, it } from 'vitest';

import { ConfigService } from './service.js';

describe('ConfigService – get() isolation (issue #451)', () => {
  it('returns a copy of nested objects, not the internal reference', () => {
    const service = new ConfigService({ db: { host: 'localhost', port: 5432 } });

    const first = service.get('db') as Record<string, unknown>;
    expect(first).toEqual({ host: 'localhost', port: 5432 });

    // Mutating the returned object must NOT affect subsequent reads
    first['host'] = 'mutated';

    const second = service.get('db') as Record<string, unknown>;
    expect(second).toEqual({ host: 'localhost', port: 5432 });
  });

  it('returns a copy via dot-path traversal', () => {
    const service = new ConfigService({ app: { options: { retries: 3 } } });

    const options = service.get('app.options') as Record<string, unknown>;
    expect(options).toEqual({ retries: 3 });

    options['retries'] = 999;

    expect(service.get('app.options')).toEqual({ retries: 3 });
  });

  it('returns scalar values directly without cloning', () => {
    const service = new ConfigService({ port: 3000, name: 'app' });

    expect(service.get('port')).toBe(3000);
    expect(service.get('name')).toBe('app');
  });

  it('returns undefined for missing keys', () => {
    const service = new ConfigService({ port: 3000 });

    expect(service.get('missing' as never)).toBeUndefined();
    expect(service.get('a.b.c' as never)).toBeUndefined();
  });
});
