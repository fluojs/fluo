import type { GeneratedFile } from '../types.js';

import { renderTemplate } from './render.js';
import { toKebabCase, toPascalCase } from './utils.js';

export function generateRequestDtoFiles(name: string): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}RequestDto`;
  const bodyField = resource.charAt(0).toLowerCase() + resource.slice(1);

  return [
    {
      content: renderTemplate('request-dto.ts.ejs', { kebab, resource, pascal, bodyField }),
      path: `${kebab}.request.dto.ts`,
    },
  ];
}
