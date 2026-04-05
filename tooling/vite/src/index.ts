import { fileURLToPath } from 'node:url';

import { createKonektiBabelDecoratorsPlugin } from '../../../packages/testing/src/babel-decorators-plugin.js';

const BABEL_CONFIG_FILE = fileURLToPath(new URL('../../babel/babel.config.cjs', import.meta.url));

export function konektiBabelDecoratorsPlugin() {
  return createKonektiBabelDecoratorsPlugin(() => BABEL_CONFIG_FILE);
}
