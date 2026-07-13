import { posix } from 'node:path';

import ts from 'typescript';

const stableSurfaceEntrypoints = [
  ['stable root', 'packages/react/src/index.ts'],
  ['stable client', 'packages/react/src/client.ts'],
];
const rscExportNamePattern = /(?:Rsc|RSC|Flight|ServerFunction)/u;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseSource(relativePath, source) {
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert(sourceFile.parseDiagnostics.length === 0, `${relativePath} must be valid TypeScript evidence.`);
  return sourceFile;
}

function sourceModuleSpecifiers(sourceFile) {
  const specifiers = [];

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
}

function resolveSourceModule(importerPath, specifier) {
  if (!specifier.startsWith('.')) {
    return undefined;
  }

  const resolved = posix.normalize(posix.join(posix.dirname(importerPath), specifier));
  if (/\.(?:c|m)?js$/u.test(resolved)) {
    return resolved.replace(/\.(?:c|m)?js$/u, '.ts');
  }
  return posix.extname(resolved) === '' ? `${resolved}.ts` : resolved;
}

function isRscImplementationPath(relativePath) {
  return (
    relativePath === 'packages/react/src/rsc.ts' ||
    relativePath.startsWith('packages/react/src/rsc/') ||
    relativePath === 'packages/react/src/experimental/rsc.ts' ||
    relativePath.startsWith('packages/react/src/experimental/rsc/') ||
    /\/experimental\/(?:rsc-|server-functions-)/u.test(relativePath)
  );
}

function findRscDependency(entrypointPath, readText) {
  const pending = [entrypointPath];
  const visited = new Set();

  while (pending.length > 0) {
    const currentPath = pending.pop();
    if (!currentPath || visited.has(currentPath)) {
      continue;
    }
    visited.add(currentPath);

    const sourceFile = parseSource(currentPath, readText(currentPath));
    for (const specifier of sourceModuleSpecifiers(sourceFile)) {
      const dependencyPath = resolveSourceModule(currentPath, specifier);
      if (!dependencyPath?.startsWith('packages/react/src/')) {
        continue;
      }
      if (isRscImplementationPath(dependencyPath)) {
        return dependencyPath;
      }
      pending.push(dependencyPath);
    }
  }

  return undefined;
}

function exportedNames(sourceFile) {
  const names = [];
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        names.push(element.propertyName?.text ?? element.name.text, element.name.text);
      }
      continue;
    }

    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          names.push(declaration.name.text);
        }
      }
      continue;
    }
    if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) {
      names.push(statement.name.text);
    }
  }
  return names;
}

export function enforceReactRscStableSurfaceIsolation(readText) {
  for (const [surfaceName, entrypointPath] of stableSurfaceEntrypoints) {
    const dependencyPath = findRscDependency(entrypointPath, readText);
    assert(
      dependencyPath === undefined,
      `The React ${surfaceName} must not import or re-export RSC implementation module ${dependencyPath}.`,
    );

    const names = exportedNames(parseSource(entrypointPath, readText(entrypointPath)));
    const rscExportName = names.find((name) => rscExportNamePattern.test(name));
    assert(rscExportName === undefined, `The React ${surfaceName} must not export RSC symbol ${rscExportName}.`);
  }
}
