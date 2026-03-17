import type { GeneratedFile } from '../types.js';

import { toKebabCase, toPascalCase } from './utils.js';

export function generateModuleFiles(name: string): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const pascal = `${toPascalCase(name)}Module`;

  return [
    {
      content: `import { Module } from '@konekti/core';

@Module({
  controllers: [],
  providers: [],
})
class ${pascal} {}

export { ${pascal} };
`,
      path: `${kebab}.module.ts`,
    },
  ];
}

function insertIntoModuleArray(source: string, arrayKey: 'controllers' | 'providers' | 'middleware', className: string): string {
  const alreadyPresent = new RegExp(`\\b${className}\\b`).test(source);
  if (alreadyPresent) {
    return source;
  }

  const emptyArrayPattern = new RegExp(`(${arrayKey}:\\s*\\[)(\\s*)(\\])`);
  if (emptyArrayPattern.test(source)) {
    return source.replace(emptyArrayPattern, `$1$2  ${className},$2$3`);
  }

  const nonEmptyArrayPattern = new RegExp(`(${arrayKey}:\\s*\\[)((?:[^\\]])*)(\\])`);
  return source.replace(nonEmptyArrayPattern, (_, open, items, close) => {
    const trimmed = items.trimEnd();
    const separator = trimmed.endsWith(',') ? '' : ',';
    return `${open}${trimmed}${separator}\n    ${className},\n  ${close}`;
  });
}

export function registerInModule(source: string, arrayKey: 'controllers' | 'providers' | 'middleware', className: string): string {
  let result = insertIntoModuleArray(source, arrayKey, className);
  
  if (arrayKey === 'middleware' && !new RegExp(`${arrayKey}:\\s*\\[`).test(result)) {
    result = result.replace(/\}\)\nclass/, `})\n  middleware: [${className}],\nclass`);
  }
  
  return result;
}
