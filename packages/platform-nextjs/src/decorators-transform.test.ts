import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

      const bindings: string[] = [];
      function Field(_value: undefined, context: ClassFieldDecoratorContext) {
        bindings.push(String(context.name));
      }

      class BaseDto {
        code = 'base';
      }

      class RequestDto extends BaseDto {
        declare readonly code: string;
        @Field
        name = '';
      }

      const dto = new RequestDto();
      export { ApiController, bindings, dto };
    `;

    const result = await transformFluoDecorators(
      source,
      '/project/src/backend.ts',
    );

    expect(result.code).not.toContain('@controller');
    expect(result.code).not.toContain('readonly status');
    expect(result.code).toContain('class ApiController');
    expect(result.code).not.toContain("name = '';");
    const output = await import(`data:text/javascript;base64,${Buffer.from(result.code).toString('base64')}`);
    expect(output.bindings).toEqual(['name']);
    expect(output.dto.code).toBe('base');
  });

  it('compiles decorated fields with isolated Babel 8 dependencies', async () => {
    const babel8Root = process.env.FLUO_BABEL8_ROOT;
    if (!babel8Root) {
      return;
    }

    copyFileSync(
      fileURLToPath(new URL('../dist/decorators-transform.js', import.meta.url)),
      join(babel8Root, 'decorators-transform.mjs'),
    );
    const compiledModule = pathToFileURL(join(babel8Root, 'decorators-transform.mjs')).href;
    const { transformFluoDecorators: transformWithBabel8 } = await import(compiledModule);
    const result: Awaited<ReturnType<typeof transformFluoDecorators>> = await transformWithBabel8(
      `const bindings: string[] = [];
function Field(_value: undefined, context: ClassFieldDecoratorContext) {
  bindings.push(String(context.name));
}
class BaseDto {
  code = 'base';
}
class RequestDto extends BaseDto {
  declare readonly code: string;
  @Field
  name = '';
}
const dto = new RequestDto();
export { bindings, dto };`,
      join(babel8Root, 'src/backend.ts'),
    );
    const output = await import(`data:text/javascript;base64,${Buffer.from(result.code).toString('base64')}`);
    expect(output.bindings).toEqual(['name']);
    expect(output.dto.code).toBe('base');
  });
});
