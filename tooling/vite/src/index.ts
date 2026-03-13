import { transformAsync } from '@babel/core';
import { fileURLToPath } from 'node:url';

const BABEL_CONFIG_FILE = fileURLToPath(new URL('../../babel/babel.config.cjs', import.meta.url));

export function konektiBabelDecoratorsPlugin() {
  return {
    name: 'konekti-babel-decorators',
    async transform(code: string, id: string) {
      if (!id.endsWith('.ts') || id.includes('/node_modules/')) {
        return null;
      }

      const result = await transformAsync(code, {
        babelrc: false,
        configFile: BABEL_CONFIG_FILE,
        filename: id,
        sourceMaps: true,
      });

      if (!result?.code) {
        return null;
      }

      return {
        code: result.code,
        map: result.map ?? null,
      };
    },
  };
}
