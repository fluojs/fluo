import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type PackageManifest = {
  readonly engines?: {
    readonly node?: string;
  };
};

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('@fluojs/event-bus runtime support', () => {
  it('omits an Event Bus Node installation gate while the Node listener retains its support range', () => {
    const eventBusManifest = readManifest(resolve(import.meta.dirname, '../package.json'));
    const nodePlatformManifest = readManifest(resolve(import.meta.dirname, '../../platform-nodejs/package.json'));

    expect(eventBusManifest.engines?.node).toBeUndefined();
    expect(nodePlatformManifest.engines?.node).toBe('>=24.0.0 <27');
  });
});
