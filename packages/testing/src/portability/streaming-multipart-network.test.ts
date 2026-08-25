import { describe, it } from 'vitest';

import {
  bootstrapExpressApplication,
  runExpressApplication,
} from '@fluojs/platform-express';
import {
  bootstrapFastifyApplication,
  runFastifyApplication,
} from '@fluojs/platform-fastify';
import {
  bootstrapNodejsApplication,
  runNodejsApplication,
} from '@fluojs/platform-nodejs';

import { createHttpAdapterPortabilityHarness } from './http-adapter-portability.js';

const networkHarnesses = [
  [
    'Node.js',
    createHttpAdapterPortabilityHarness({
      bootstrap: bootstrapNodejsApplication,
      name: 'nodejs',
      run: runNodejsApplication,
    }),
  ],
  [
    'Express',
    createHttpAdapterPortabilityHarness({
      bootstrap: bootstrapExpressApplication,
      name: 'express',
      run: runExpressApplication,
    }),
  ],
  [
    'Fastify',
    createHttpAdapterPortabilityHarness({
      bootstrap: bootstrapFastifyApplication,
      name: 'fastify',
      run: runFastifyApplication,
    }),
  ],
] as const;

describe.each(networkHarnesses)('%s streaming multipart network conformance', (_name, harness) => {
  it('streams equivalent portable field and file parts', async () => {
    await harness.assertStreamsPortableMultipartParts();
  });
});
