import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canHaveDecorators,
  createSourceFile,
  forEachChild,
  getDecorators,
  isCallExpression,
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isNamedExports,
  isNamedImports,
  isStringLiteral,
  ModuleKind,
  ScriptKind,
  ScriptTarget,
  transpileModule,
} from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const guidePaths = [
  'apps/docs/content/docs/guides/http-api.mdx',
  'apps/docs/content/docs/guides/http-api.ko.mdx',
  'apps/docs/content/docs/guides/first-feature.mdx',
  'apps/docs/content/docs/guides/first-feature.ko.mdx',
] as const;

interface Snippet {
  readonly file: string;
  readonly source: string;
}

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function codeSnippets(relativePath: string): readonly Snippet[] {
  return [...read(relativePath).matchAll(/```ts\n([\s\S]*?)```/gu)]
    .map((match) => match[1])
    .filter((source): source is string => source !== undefined)
    .filter((source) => source.includes("from '@fluojs/http'"))
    .map((source) => ({ file: relativePath, source }));
}

function exportedHttpNames(): ReadonlySet<string> {
  const source = createSourceFile(
    'packages/http/src/index.portable.ts',
    read('packages/http/src/index.portable.ts'),
    ScriptTarget.ES2022,
    true,
    ScriptKind.TS,
  );
  const names = new Set<string>();

  for (const statement of source.statements) {
    if (!isExportDeclaration(statement) || !statement.exportClause || !isNamedExports(statement.exportClause)) {
      continue;
    }

    for (const element of statement.exportClause.elements) {
      names.add(element.name.text);
    }
  }

  return names;
}

function importedHttpNames(source: string): readonly string[] {
  const file = createSourceFile('snippet.ts', source, ScriptTarget.ES2022, true, ScriptKind.TS);
  const names: string[] = [];

  for (const statement of file.statements) {
    if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== '@fluojs/http') {
      continue;
    }

    const bindings = statement.importClause?.namedBindings;

    if (!bindings || !isNamedImports(bindings)) {
      continue;
    }

    for (const element of bindings.elements) {
      names.push(element.propertyName?.text ?? element.name.text);
    }
  }

  return names;
}

function decoratorNames(source: string): ReadonlySet<string> {
  const file = createSourceFile('snippet.ts', source, ScriptTarget.ES2022, true, ScriptKind.TS);
  const names = new Set<string>();

  const visit = (node: Parameters<typeof forEachChild>[0]): void => {
    if (canHaveDecorators(node)) {
      for (const decorator of getDecorators(node) ?? []) {
        if (isCallExpression(decorator.expression) && isIdentifier(decorator.expression.expression)) {
          names.add(decorator.expression.expression.text);
        }
      }
    }

    forEachChild(node, visit);
  };

  visit(file);
  return names;
}

function routePaths(source: string): readonly string[] {
  const file = createSourceFile('snippet.ts', source, ScriptTarget.ES2022, true, ScriptKind.TS);
  const paths: string[] = [];

  const visit = (node: Parameters<typeof forEachChild>[0]): void => {
    if (canHaveDecorators(node)) {
      for (const decorator of getDecorators(node) ?? []) {
        if (
          !isCallExpression(decorator.expression) ||
          !isIdentifier(decorator.expression.expression) ||
          !['Get', 'Post'].includes(decorator.expression.expression.text)
        ) {
          continue;
        }

        const [path] = decorator.expression.arguments;
        paths.push(path && isStringLiteral(path) ? path.text : '');
      }
    }

    forEachChild(node, visit);
  };

  visit(file);
  return paths;
}

describe('HTTP website guide snippets', () => {
  it('compile with shipped HTTP exports and explicit DTO route bindings', () => {
    // Given
    const snippets = guidePaths.flatMap(codeSnippets);
    const exportedNames = exportedHttpNames();
    const controllerSnippets = snippets.filter((snippet) => snippet.source.includes('@Controller'));

    // When
    const diagnostics = snippets.flatMap((snippet) =>
      transpileModule(snippet.source, {
        compilerOptions: {
          experimentalDecorators: true,
          module: ModuleKind.ESNext,
          target: ScriptTarget.ES2022,
        },
        reportDiagnostics: true,
      }).diagnostics ?? [],
    );

    // Then
    expect(controllerSnippets).toHaveLength(4);
    expect(diagnostics).toEqual([]);

    for (const snippet of snippets) {
      for (const name of importedHttpNames(snippet.source)) {
        expect(exportedNames, `${snippet.file} imports ${name} from @fluojs/http`).toContain(name);
      }
    }

    for (const snippet of controllerSnippets) {
      const decorators = decoratorNames(snippet.source);
      const paths = routePaths(snippet.source);

      expect([...decorators]).toEqual(expect.arrayContaining(['FromBody', 'FromPath', 'RequestDto']));
      expect(paths).toEqual(expect.arrayContaining(['/']));
      expect(paths.every((path) => path.startsWith('/'))).toBe(true);
    }
  });
});
