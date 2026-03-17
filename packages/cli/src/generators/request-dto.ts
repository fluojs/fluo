import type { GeneratedFile } from '../types.js';

import { toKebabCase, toPascalCase } from './utils.js';

export function generateRequestDtoFiles(name: string): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const resource = toPascalCase(name);
  const pascal = `${resource}RequestDto`;
  const bodyField = resource.charAt(0).toLowerCase() + resource.slice(1);

  return [
    {
      content: `import { IsString, MinLength } from '@konekti/dto-validator';
import { FromBody } from '@konekti/http';

export class ${pascal} {
  @FromBody('${bodyField}')
  @IsString()
  @MinLength(1, { message: '${bodyField} is required' })
  ${bodyField} = '';
}
`,
      path: `${kebab}.request.dto.ts`,
    },
  ];
}
