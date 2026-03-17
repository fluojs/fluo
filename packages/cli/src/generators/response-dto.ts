import type { GeneratedFile } from '../types.js';

import { toKebabCase, toPascalCase } from './utils.js';

export function generateResponseDtoFiles(name: string): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}ResponseDto`;
  const field = resource.charAt(0).toLowerCase() + resource.slice(1);

  return [
    {
      content: `export class ${pascal} {
  ${field}!: string;
}
`,
      path: `${kebab}.response.dto.ts`,
    },
  ];
}
