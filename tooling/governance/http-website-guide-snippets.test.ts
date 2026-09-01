import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSourceFile,
  isImportDeclaration,
  isNamedImports,
  isStringLiteral,
  ScriptKind,
  ScriptTarget,
} from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  classDecoratorArguments,
  exportedHttpNames,
  routeBindings,
  semanticDiagnostics,
} from './http-website-guide-snippets.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const guidePaths = [
  'apps/docs/content/docs/guides/http-api.mdx',
  'apps/docs/content/docs/guides/http-api.ko.mdx',
  'apps/docs/content/docs/guides/first-feature.mdx',
  'apps/docs/content/docs/guides/first-feature.ko.mdx',
] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function codeSnippets(relativePath: string): readonly string[] {
  return [...read(relativePath).matchAll(/```ts\n([\s\S]*?)```/gu)]
    .map((match) => match[1])
    .filter((source): source is string => source !== undefined)
    .filter((source) => source.includes("from '@fluojs/http'"));
}

function importedHttpNames(source: string): readonly string[] {
  const file = createSourceFile('snippet.ts', source, ScriptTarget.ES2022, true, ScriptKind.TS);

  return file.statements
    .filter(isImportDeclaration)
    .filter((statement) => isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === '@fluojs/http')
    .flatMap((statement) => {
      const bindings = statement.importClause?.namedBindings;

      return bindings && isNamedImports(bindings)
        ? bindings.elements.map((element) => element.propertyName?.text ?? element.name.text)
        : [];
    });
}

describe('HTTP website guide snippets', () => {
  it.each(guidePaths)('%s compiles against real public package types', (relativePath) => {
    // Given
    const snippets = codeSnippets(relativePath);

    // When
    const diagnostics = snippets.flatMap((source) => semanticDiagnostics(relativePath, source));

    // Then
    expect(diagnostics).toEqual([]);
  });

  it.each([
    ['unresolved HTTP imports', "import { Missing } from '@fluojs/http';\nMissing;\n"],
    ['invalid route decorator arguments', "import { Controller, Get } from '@fluojs/http';\n@Controller('/')\nclass Example { @Get() handler() {} }\n"],
    ['invalid DTO member access', "import { Controller, FromBody, Post, RequestDto } from '@fluojs/http';\nclass Input { @FromBody() name!: string; }\n@Controller('/')\nclass Example { @Post('/') @RequestDto(Input) create(input: Input) { return input.missing; } }\n"],
  ])('%s produce semantic diagnostics', (relativePath, source) => {
    // Given
    const fixturePath = `tooling/governance/fixtures/${relativePath}.ts`;

    // When
    const diagnostics = semanticDiagnostics(fixturePath, source);

    // Then
    expect(diagnostics).not.toEqual([]);
  });

  it('imports only symbols resolved from the public HTTP entry point', () => {
    // Given
    const exportedNames = exportedHttpNames();
    const snippets = guidePaths.flatMap((relativePath) => codeSnippets(relativePath));

    // When
    const importedNames = snippets.flatMap(importedHttpNames);

    // Then
    for (const name of importedNames) {
      expect(exportedNames).toContain(name);
    }
  });

  it('declares the First Feature controller injection token explicitly', () => {
    // Given
    const firstFeatureGuides = guidePaths.filter((path) => path.includes('first-feature'));

    // When
    const injectionArguments = firstFeatureGuides.map((relativePath) =>
      classDecoratorArguments(codeSnippets(relativePath)[0] ?? '', 'UsersController', 'Inject'),
    );

    // Then
    expect(injectionArguments).toEqual([['UsersService'], ['UsersService']]);
  });

  it('binds every Get and Post handler to its own request DTO source', () => {
    // Given
    const routes = guidePaths.flatMap((relativePath) =>
      codeSnippets(relativePath).flatMap((source) => routeBindings(source)),
    );

    // When
    const expectedSources = new Map([
      ['Get', 'FromPath'],
      ['Post', 'FromBody'],
    ]);

    // Then
    expect(routes).toHaveLength(8);

    for (const route of routes) {
      expect(route.requestDto).toBe(route.parameterDto);
      expect(route.bindings.length).toBeGreaterThan(0);

      for (const binding of route.bindings) {
        expect(binding.source, `${route.method} ${route.name} binds ${binding.member}`).toBe(expectedSources.get(route.method));
      }
    }
  });
});
