import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

import { resolveBootstrapSchema } from './resolver.js';
import { scaffoldBootstrapApp } from './scaffold.js';

it.each(['application', 'microservice', 'mixed'] as const)(
  'generates %s module visibility through Module metadata rather than a removed decorator',
  async (shape) => {
    const targetDirectory = mkdtempSync(join(process.cwd(), '.canonical-scaffold-'));
    try {
      await scaffoldBootstrapApp({
        ...resolveBootstrapSchema({ shape }),
        packageManager: 'pnpm',
        projectName: 'canonical-starter',
        skipInstall: true,
        targetDirectory,
      });
      const source = ts.createSourceFile(
        'app.ts',
        readFileSync(join(targetDirectory, 'src/app.ts'), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const coreImport = source.statements.find((statement) =>
        ts.isImportDeclaration(statement)
        && ts.isStringLiteral(statement.moduleSpecifier)
        && statement.moduleSpecifier.text === '@fluojs/core');
      expect(coreImport && ts.isImportDeclaration(coreImport)).toBe(true);
      if (!coreImport || !ts.isImportDeclaration(coreImport)) throw new Error('Missing core import');
      const bindings = coreImport.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) throw new Error('Missing named core imports');
      const names = bindings.elements.map((entry) => (entry.propertyName ?? entry.name).text);
      expect(names).toContain('Module');
      expect(names).not.toContain('Global');

      const module = source.statements.find((statement) =>
        ts.isClassDeclaration(statement) && statement.name?.text === 'AppModule');
      if (!module || !ts.isClassDeclaration(module)) throw new Error('Missing AppModule');
      const decorators = ts.getDecorators(module) ?? [];
      expect(decorators).toHaveLength(1);
      const call = decorators[0]?.expression;
      if (!call || !ts.isCallExpression(call)) throw new Error('Missing module decorator call');
      expect(call.expression.getText(source)).toBe('Module');
      const definition = call.arguments[0];
      if (!definition || !ts.isObjectLiteralExpression(definition)) throw new Error('Missing module definition');
      const global = definition.properties.find((property) =>
        ts.isPropertyAssignment(property) && property.name.getText(source) === 'global');
      if (shape === 'microservice') {
        expect(global).toBeUndefined();
      } else {
        if (!global || !ts.isPropertyAssignment(global)) throw new Error('Missing global metadata');
        expect(global.initializer.kind).toBe(ts.SyntaxKind.TrueKeyword);
      }
      expect(definition.properties.some((property) => property.name?.getText(source) === 'imports')).toBe(true);
    } finally {
      rmSync(targetDirectory, { recursive: true, force: true });
    }
  },
);
