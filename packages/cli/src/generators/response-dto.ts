import type { GeneratedFile } from '../types.js';

import { renderTemplate } from './render.js';
import { toKebabCase, toPascalCase } from './utils.js';

/**
 * Generate response dto files.
 *
 * @param name The name.
 * @returns The generate response dto files result.
 */
export function generateResponseDtoFiles(name: string): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}ResponseDto`;
  const field = resource.charAt(0).toLowerCase() + resource.slice(1);

  return [
    {
      content: renderTemplate('response-dto.ts.ejs', { kebab, resource, pascal, field }),
      path: `${kebab}.response.dto.ts`,
    },
  ];
}
