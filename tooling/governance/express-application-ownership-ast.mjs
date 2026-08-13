import ts from 'typescript';

export function staticName(node, staticStrings = new Map()) {
  const computed = node && ts.isComputedPropertyName(node);
  const nameNode = computed ? node.expression : node;
  if (nameNode && ts.isStringLiteralLike(nameNode)) {
    return nameNode.text;
  }
  return nameNode && ts.isIdentifier(nameNode)
    ? (computed ? staticStrings.get(nameNode.text) : undefined) ?? nameNode.text
    : undefined;
}

export function collectStaticStrings(sourceFile) {
  const strings = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        ts.isStringLiteralLike(declaration.initializer)
      ) {
        strings.set(declaration.name.text, declaration.initializer.text);
      }
    }
  }
  return strings;
}

export function entityName(node) {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  return ts.isQualifiedName(node) ? node.right.text : undefined;
}

export function unwrapExpression(node) {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

export function isExported(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

export function isThisMember(node, expectedName) {
  node = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(node)) {
    return node.expression.kind === ts.SyntaxKind.ThisKeyword && node.name.text === expectedName;
  }
  return (
    ts.isElementAccessExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ThisKeyword &&
    staticName(node.argumentExpression) === expectedName
  );
}

export function containsSyntax(node, syntaxKind) {
  let found = false;
  function visit(current) {
    if (current.kind === syntaxKind) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

export function containsNamedTypeReference(node, expectedName) {
  let found = false;
  function visit(current) {
    if (ts.isTypeReferenceNode(current) && entityName(current.typeName) === expectedName) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

export function expressionReferences(node, names) {
  let found = false;
  function visit(current) {
    if (ts.isIdentifier(current) && names.has(current.text)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}
