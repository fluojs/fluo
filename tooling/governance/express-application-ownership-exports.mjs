import { posix as path } from 'node:path';

import ts from 'typescript';

import { entityName } from './express-application-ownership-ast.mjs';

function relativeModulePath(containingPath, moduleSpecifier) {
  if (!moduleSpecifier.startsWith('.')) {
    return undefined;
  }
  const resolved = path.normalize(path.join(path.dirname(containingPath), moduleSpecifier));
  return /\.(?:c|m)?js$/u.test(resolved)
    ? resolved.replace(/\.(?:c|m)?js$/u, '.ts')
    : `${resolved}.ts`;
}

function collectModule(sourceFile, sourcePath) {
  const declarations = new Map();
  const exports = new Map();
  const imports = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      declarations.set(statement.name.text, statement);
      if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        exports.set(statement.name.text, { name: statement.name.text, sourcePath });
      }
      continue;
    }
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const importedPath = relativeModulePath(sourcePath, statement.moduleSpecifier.text);
      const bindings = statement.importClause?.namedBindings;
      if (importedPath && bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          imports.set(element.name.text, {
            name: element.propertyName?.text ?? element.name.text,
            sourcePath: importedPath,
          });
        }
      }
      continue;
    }
    if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
      continue;
    }
    const reexportPath =
      statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)
        ? relativeModulePath(sourcePath, statement.moduleSpecifier.text)
        : undefined;
    for (const element of statement.exportClause.elements) {
      const localName = element.propertyName?.text ?? element.name.text;
      exports.set(element.name.text, reexportPath
        ? { name: localName, sourcePath: reexportPath }
        : imports.get(localName) ?? { name: localName, sourcePath });
    }
  }
  return { declarations, exports, imports, sourcePath };
}

export function findExportedApplicationOptions({ content, readText, sourcePath }) {
  const rootFile = ts.createSourceFile(sourcePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const modules = new Map([[sourcePath, collectModule(rootFile, sourcePath)]]);

  function loadModule(modulePath) {
    const cached = modules.get(modulePath);
    if (cached) {
      return cached;
    }
    const sourceFile = ts.createSourceFile(
      modulePath,
      readText(modulePath),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const module = collectModule(sourceFile, modulePath);
    modules.set(modulePath, module);
    return module;
  }

  function containsApplication(module, node, visiting) {
    if (ts.isTypeReferenceNode(node)) {
      const name = entityName(node.typeName);
      if (name && referenceContainsApplication(module, name, visiting)) {
        return true;
      }
    }
    let found = false;
    ts.forEachChild(node, (child) => {
      if (!found && containsApplication(module, child, visiting)) {
        found = true;
      }
    });
    return found;
  }

  function declarationContainsApplication(module, declaration, visiting) {
    if (ts.isTypeAliasDeclaration(declaration)) {
      return containsApplication(module, declaration.type, visiting);
    }
    if (declaration.members.some((member) => containsApplication(module, member, visiting))) {
      return true;
    }
    return declaration.heritageClauses?.some((clause) =>
      clause.types.some((type) => {
        const name = ts.isIdentifier(type.expression) ? type.expression.text : undefined;
        return (
          (name !== undefined && referenceContainsApplication(module, name, visiting)) ||
          containsApplication(module, type, visiting)
        );
      }),
    ) ?? false;
  }

  function referenceContainsApplication(module, name, visiting) {
    if (name === 'Express') {
      return true;
    }
    const key = `${module.sourcePath}:${name}`;
    if (visiting.has(key)) {
      return false;
    }
    const nextVisiting = new Set(visiting).add(key);
    const declaration = module.declarations.get(name);
    if (declaration && declarationContainsApplication(module, declaration, nextVisiting)) {
      return true;
    }
    const imported = module.imports.get(name);
    return imported
      ? referenceContainsApplication(loadModule(imported.sourcePath), imported.name, nextVisiting)
      : false;
  }

  const rootModule = modules.get(sourcePath);
  return [...rootModule.exports]
    .filter(([, target]) => referenceContainsApplication(loadModule(target.sourcePath), target.name, new Set()))
    .map(([name]) => name);
}
