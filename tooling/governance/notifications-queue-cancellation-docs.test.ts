import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceNotificationsQueueCancellationDocumentationContract } from './verify-platform-consistency-governance.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('notifications queue cancellation documentation contract', () => {
  it('accepts the context companions and executable cancellation evidence', () => {
    expect(() => enforceNotificationsQueueCancellationDocumentationContract()).not.toThrow();
  });

  it('rejects a context companion that loses its cancellation contract sentinel', () => {
    expect(() =>
      enforceNotificationsQueueCancellationDocumentationContract((path: string) =>
        path === 'docs/CONTEXT.ko.md' ? '' : readFileSync(join(repoRoot, path), 'utf8'),
      ),
    ).toThrow(/docs\/CONTEXT\.ko\.md must preserve/u);
  });
});
