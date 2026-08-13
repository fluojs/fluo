import ts from 'typescript';

function collectBindingNames(name, names) {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, names);
  }
}

function collectImportNames(statement, names) {
  const clause = statement.importClause;
  if (!clause) return;
  if (clause.name) names.add(clause.name.text);
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) names.add(element.name.text);
  }
}

export function shadowLifecycleScopeDeclarations(statements, scope) {
  const names = new Set();
  for (const statement of statements) {
    if (ts.isImportDeclaration(statement)) {
      collectImportNames(statement, names);
    } else if (ts.isImportEqualsDeclaration(statement)) {
      names.add(statement.name.text);
    } else if (ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) {
      if (statement.name) names.add(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, names);
      }
    }
  }
  for (const name of names) scope.set(name, null);
}
