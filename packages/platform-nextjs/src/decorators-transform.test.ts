import { describe, expect, it } from 'vitest';

import { transformFluoDecorators } from './decorators-transform.js';

describe('transformFluoDecorators', () => {
  it('compiles standard decorators and TypeScript into JavaScript', async () => {
    const source = `
      function controller(value: Function) {
        return value;
      }

      @controller
      class ApiController {
        health(): { readonly status: string } {
          return { status: 'ok' };
        }
      }

      export { ApiController };
    `;

    const result = await transformFluoDecorators(
      source,
      '/project/src/backend.ts',
    );

    expect(result.code).not.toContain('@controller');
    expect(result.code).not.toContain('readonly status');
    expect(result.code).toContain('class ApiController');
  });
});
