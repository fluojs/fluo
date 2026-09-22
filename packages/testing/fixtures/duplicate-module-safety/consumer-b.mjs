import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FluoError, isFluoError, publicToken } from '@fluojs/core';
import { Container } from '@fluojs/di';

const resolvedUrl = import.meta.resolve('@fluojs/core');
const resolvedPath = realpathSync(fileURLToPath(resolvedUrl));
let directory = dirname(resolvedPath);
while (!existsSync(join(directory, 'package.json'))) directory = dirname(directory);
const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
const singletonToken = publicToken('fluo.duplicate-module-safety.singleton');
const requestToken = publicToken('fluo.duplicate-module-safety.request');
const container = new Container().register(
  { provide: singletonToken, useFactory: () => ({ kind: 'singleton' }) },
  { provide: requestToken, scope: 'request', useFactory: () => ({ kind: 'request' }) },
);
const firstRequest = container.createRequestScope();
const secondRequest = container.createRequestScope();
const singleton = await container.resolve(singletonToken);
const error = new FluoError('duplicate module safety', { code: 'DUPLICATE_MODULE_SAFETY' });

console.log(JSON.stringify({
  artifact: 'B',
  manifestName: manifest.name,
  package: manifest.name,
  realPath: resolvedPath,
  resolvedUrl,
  surfaces: {
    error: isFluoError(error, '@fluojs/core') && error.code,
    requestScope: (await firstRequest.resolve(requestToken)) !== (await secondRequest.resolve(requestToken)),
    singleton: singleton === await container.resolve(singletonToken),
  },
  version: manifest.version,
}));
