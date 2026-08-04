import { existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ParsedTypegenArgs } from './typegen-options.js';
import { TypegenCommandError } from './typegen-options.js';
import {
  createTypegenSource,
  generateTypegenSource,
  loadReactTypegenModules,
  type ReactTypegenModules,
} from './typegen-source.js';

const TYPESCRIPT_MODULE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const TYPEGEN_MODULE_IDS = ['@fluojs/react', '@fluojs/react/typegen', '@fluojs/runtime'] as const;

function isModuleNotFoundError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error.code === 'MODULE_NOT_FOUND' || error.code === 'ERR_MODULE_NOT_FOUND');
}

function resolveProjectModuleUrl(moduleId: string, cwd: string): string {
  const parentUrls = [pathToFileURL(resolve(cwd, 'package.json')).href, import.meta.url];
  for (const parentUrl of parentUrls) {
    try {
      return import.meta.resolve(moduleId, parentUrl);
    } catch (error: unknown) {
      if (!isModuleNotFoundError(error)) {
        throw error;
      }
    }
  }
  throw new TypegenCommandError(`Unable to resolve ${moduleId} from the inspected project.`);
}

function requireNamespace(owner: object, name: string): object {
  const value = Reflect.get(owner, name);
  if (typeof value !== 'object' || value === null) {
    throw new TypegenCommandError(`Required typegen namespace ${name} is unavailable.`);
  }
  return value;
}

async function importNativeTypegenGraph(modulePath: string, cwd: string): Promise<{
  readonly application: object;
  readonly modules: ReactTypegenModules;
}> {
  const imports = {
    application: pathToFileURL(modulePath).href,
    react: resolveProjectModuleUrl(TYPEGEN_MODULE_IDS[0], cwd),
    typegen: resolveProjectModuleUrl(TYPEGEN_MODULE_IDS[1], cwd),
    runtime: resolveProjectModuleUrl(TYPEGEN_MODULE_IDS[2], cwd),
  } as const;
  const source = `${Object.entries(imports)
    .map(([name, url]) => `import * as ${name} from ${JSON.stringify(url)};`)
    .join('\n')}\nexport { application, react, runtime, typegen };\n`;
  const graphUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
  const graph = await import(graphUrl);
  return {
    application: requireNamespace(graph, 'application'),
    modules: {
      react: requireNamespace(graph, 'react'),
      runtime: requireNamespace(graph, 'runtime'),
      typegen: requireNamespace(graph, 'typegen'),
    },
  };
}

/**
 * Generates source inside the default short-lived process while preserving one native module graph.
 *
 * @param parsed Parsed typegen command options.
 * @param cwd Consumer project directory.
 * @returns Complete deterministic generated source.
 */
export async function createProcessIsolatedTypegenSource(
  parsed: ParsedTypegenArgs,
  cwd: string,
): Promise<string> {
  const modulePath = resolve(cwd, parsed.modulePath);
  if (TYPESCRIPT_MODULE_EXTENSIONS.has(extname(modulePath))) {
    const tsconfigPath = resolve(dirname(modulePath), 'tsconfig.json');
    const modules = await loadReactTypegenModules(cwd, existsSync(tsconfigPath) ? tsconfigPath : false);
    return createTypegenSource({ cwd, modules, parsed });
  }

  const imported = await importNativeTypegenGraph(modulePath, cwd);
  return generateTypegenSource({
    application: imported.application,
    modules: imported.modules,
    parsed,
  });
}
