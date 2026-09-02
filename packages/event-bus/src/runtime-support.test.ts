import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type PackageManifest = {
  readonly engines: {
    readonly node: string;
  };
};

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;
}

describe('@fluojs/event-bus runtime support', () => {
  it('matches the Node.js support range required by @fluojs/runtime', () => {
    const eventBusManifest = readManifest(resolve(import.meta.dirname, '../package.json'));
    const runtimeManifest = readManifest(resolve(import.meta.dirname, '../../runtime/package.json'));

    expect(eventBusManifest.engines.node).toBe(runtimeManifest.engines.node);
  });
});
