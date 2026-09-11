import { fileURLToPath } from 'node:url';

import { fluoDecoratorsPlugin } from '../../../packages/vite/src/index.ts';

const BABEL_CONFIG_FILE = fileURLToPath(new URL('../../babel/babel.config.cjs', import.meta.url));

export function fluoBabelDecoratorsPlugin() {
  return fluoDecoratorsPlugin({
    babelConfigFile: BABEL_CONFIG_FILE,
    sourceMaps: true,
    transformBoundary: 'test',
  });
}
