import { expect, it } from 'vitest';

import { createPackedEmailConsumer } from './packed-consumer.fixture.js';

it(
  'typechecks the packed Node subpath in a clean consumer installation',
  () => {
    const consumer = createPackedEmailConsumer();

    try {
      expect(consumer.packedManifest.peerDependencies?.['@types/nodemailer']).toBe('^8.0.0');
      expect(consumer.packedManifest.peerDependenciesMeta?.['@types/nodemailer']?.optional).toBe(true);
      expect(consumer.compilerOptions.skipLibCheck).toBe(false);
      expect(consumer.typecheck()).toMatchObject({ status: 0 });
    } finally {
      consumer.cleanup();
    }
  },
  180_000,
);
