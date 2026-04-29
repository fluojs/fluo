import type { GeneratedFile } from '../types.js';
import ts from 'typescript';

import type { ModuleArrayKey } from './manifest.js';
import { renderTemplate } from './render.js';
import { toKebabCase, toPascalCase } from './utils.js';

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

function parseSource(source: string): ts.SourceFile {
  return ts.createSourceFile('generated.module.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function getPropertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }

  return undefined;
}

function replaceNodeText(source: string, sourceFile: ts.SourceFile, node: ts.Node, replacement: string): string {
  return source.slice(0, node.getStart(sourceFile)) + replacement + source.slice(node.getEnd());
}

function findModuleDecoratorObject(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement)) {
      continue;
    }

    if (!ts.canHaveDecorators(statement)) {
      continue;
    }

    const decorators = ts.getDecorators(statement);
    if (!decorators) {
      continue;
    }

    for (const decorator of decorators) {
      if (!ts.isCallExpression(decorator.expression)) {
        continue;
      }

      if (!ts.isIdentifier(decorator.expression.expression) || decorator.expression.expression.text !== 'Module') {
        continue;
      }

      const [firstArgument] = decorator.expression.arguments;
      if (firstArgument && ts.isObjectLiteralExpression(firstArgument)) {
        return firstArgument;
      }
    }
  }

  return undefined;
}

function findNamedImportSource(sourceFile: ts.SourceFile, className: string): string | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }

    const importClause = statement.importClause;
    if (!importClause?.namedBindings || !ts.isNamedImports(importClause.namedBindings)) {
      continue;
    }

    if (!importClause.namedBindings.elements.some((element) => element.name.text === className)) {
      continue;
    }

    if (ts.isStringLiteral(statement.moduleSpecifier)) {
      return statement.moduleSpecifier.text;
    }
  }

  return undefined;
}

function buildImportDeclaration(className: string, importPath: string): ts.ImportDeclaration {
  return ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      false,
      undefined,
      ts.factory.createNamedImports([
        ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(className)),
      ]),
    ),
    ts.factory.createStringLiteral(`./${importPath}`),
  );
}

/**
 * Ensure module import.
 *
 * @param source The source.
 * @param className The class name.
 * @param importPath The import path.
 * @returns The ensure module import result.
 */
export function ensureModuleImport(source: string, className: string, importPath: string): string {
  const sourceFile = parseSource(source);
  const moduleSpecifier = `./${importPath}`;
  const existingImportSource = findNamedImportSource(sourceFile, className);

  if (existingImportSource) {
    if (existingImportSource === moduleSpecifier) {
      return source;
    }

    throw new Error(
      `Import collision for ${className}: already imported from "${existingImportSource}" but requested from "${moduleSpecifier}".`,
    );
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }

    if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== moduleSpecifier) {
      continue;
    }

    const importClause = statement.importClause;
    if (!importClause?.namedBindings || !ts.isNamedImports(importClause.namedBindings)) {
      continue;
    }

    const updatedImport = ts.factory.updateImportDeclaration(
      statement,
      statement.modifiers,
      ts.factory.updateImportClause(
        importClause,
        importClause.isTypeOnly,
        importClause.name,
        ts.factory.updateNamedImports(importClause.namedBindings, [
          ...importClause.namedBindings.elements,
          ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(className)),
        ]),
      ),
      statement.moduleSpecifier,
      statement.attributes,
    );

    return replaceNodeText(source, sourceFile, statement, printer.printNode(ts.EmitHint.Unspecified, updatedImport, sourceFile));
  }

  const newImportLine = printer.printNode(ts.EmitHint.Unspecified, buildImportDeclaration(className, importPath), sourceFile);
  const imports = sourceFile.statements.filter(ts.isImportDeclaration);

  if (imports.length > 0) {
    const lastImport = imports[imports.length - 1];
    return `${source.slice(0, lastImport.getEnd())}\n${newImportLine}${source.slice(lastImport.getEnd())}`;
  }

  return `${newImportLine}\n${source}`;
}

/**
 * Generate module files.
 *
 * @param name The name.
 * @returns The generate module files result.
 */
export function generateModuleFiles(name: string): GeneratedFile[] {
  const kebab = toKebabCase(name);
  const pascal = `${toPascalCase(name)}Module`;

  return [
    {
      content: renderTemplate('module.ts.ejs', { kebab, pascal }),
      path: `${kebab}.module.ts`,
    },
  ];
}

function insertIntoModuleArray(source: string, arrayKey: 'controllers' | 'providers' | 'middleware', className: string): string {
  const sourceFile = parseSource(source);
  const moduleMetadata = findModuleDecoratorObject(sourceFile);

  if (!moduleMetadata) {
    throw new Error('Unable to locate @Module metadata object in module file.');
  }

  let alreadyPresent = false;
  let hasTargetProperty = false;

  const updatedProperties = moduleMetadata.properties.map((property) => {
    if (!ts.isPropertyAssignment(property) || getPropertyNameText(property.name) !== arrayKey) {
      return property;
    }

    hasTargetProperty = true;

    if (!ts.isArrayLiteralExpression(property.initializer)) {
      throw new Error(`Invalid @Module metadata: "${arrayKey}" must be an array.`);
    }

    if (property.initializer.elements.some((element) => element.getText(sourceFile) === className)) {
      alreadyPresent = true;
      return property;
    }

    return ts.factory.updatePropertyAssignment(
      property,
      property.name,
      ts.factory.updateArrayLiteralExpression(property.initializer, [
        ...property.initializer.elements,
        ts.factory.createIdentifier(className),
      ]),
    );
  });

  if (alreadyPresent) {
    return source;
  }

  if (!hasTargetProperty) {
    updatedProperties.push(
      ts.factory.createPropertyAssignment(
        ts.factory.createIdentifier(arrayKey),
        ts.factory.createArrayLiteralExpression([ts.factory.createIdentifier(className)], true),
      ),
    );
  }

  const updatedModuleMetadata = ts.factory.updateObjectLiteralExpression(moduleMetadata, updatedProperties);
  return replaceNodeText(source, sourceFile, moduleMetadata, printer.printNode(ts.EmitHint.Unspecified, updatedModuleMetadata, sourceFile));
}

/**
 * Register in module.
 *
 * @param source The source.
 * @param arrayKey The array key.
 * @param className The class name.
 * @returns The register in module result.
 */
export function registerInModule(source: string, arrayKey: ModuleArrayKey, className: string): string {
  return insertIntoModuleArray(source, arrayKey, className);
}
