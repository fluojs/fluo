import ts from 'typescript';

import { entityName, staticName } from './express-application-ownership-ast.mjs';

const applicationPropertyNames = new Set([
  'app',
  'application',
  'existingApp',
  'existingApplication',
  'expressApp',
  'expressApplication',
]);

export function createApplicationTypeInspector(sourceFile) {
  const declarations = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      declarations.set(statement.name.text, statement);
    }
  }

  function containsApplicationType(node, visiting = new Set()) {
    if (ts.isTypeReferenceNode(node)) {
      const name = entityName(node.typeName);
      if (name === 'Express') {
        return true;
      }
      const declaration = name ? declarations.get(name) : undefined;
      if (
        declaration &&
        !visiting.has(name) &&
        declarationContainsApplication(declaration, new Set(visiting).add(name))
      ) {
        return true;
      }
    }
    if (ts.isTypeQueryNode(node) && entityName(node.exprName) === 'express') {
      return true;
    }
    let found = false;
    ts.forEachChild(node, (child) => {
      if (!found && containsApplicationType(child, visiting)) {
        found = true;
      }
    });
    return found;
  }

  function declarationContainsApplication(declaration, visiting = new Set()) {
    if (ts.isTypeAliasDeclaration(declaration)) {
      return containsApplicationType(declaration.type, visiting);
    }
    if (
      declaration.members.some((member) => {
        const name = staticName(member.name);
        return (
          (name !== undefined && applicationPropertyNames.has(name)) ||
          containsApplicationType(member, visiting)
        );
      })
    ) {
      return true;
    }
    return declaration.heritageClauses?.some((clause) =>
      clause.types.some((type) => {
        const name = ts.isIdentifier(type.expression) ? type.expression.text : undefined;
        const inheritedDeclaration = name ? declarations.get(name) : undefined;
        return (
          containsApplicationType(type, visiting) ||
          (name !== undefined &&
            inheritedDeclaration !== undefined &&
            !visiting.has(name) &&
            declarationContainsApplication(inheritedDeclaration, new Set(visiting).add(name)))
        );
      }),
    ) ?? false;
  }

  return { containsApplicationType, declarationContainsApplication };
}
