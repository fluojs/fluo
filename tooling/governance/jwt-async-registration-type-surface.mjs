import ts from 'typescript';

function propertyName(node) {
  if (node === undefined) {
    return undefined;
  }
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return node.getText();
}

export function collectDeclarations(sources) {
  const declarations = new Map();
  for (const source of sources) {
    for (const statement of source.statements) {
      if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) {
        continue;
      }
      const existing = declarations.get(statement.name.text) ?? [];
      existing.push(statement);
      declarations.set(statement.name.text, existing);
    }
  }
  return declarations;
}

function addMembers(members, surface, assert, relativePath) {
  for (const member of members) {
    assert(ts.isPropertySignature(member), relativePath, 'async options must use explicit property signatures only');
    const name = propertyName(member.name);
    assert(name !== undefined, relativePath, 'async options must use named properties');
    const existing = surface.get(name) ?? [];
    existing.push(member);
    surface.set(name, existing);
  }
}

function collectNamedSurface(name, state) {
  const namedDeclarations = state.declarations.get(name);
  state.assert(namedDeclarations?.length > 0, state.relativePath, `must resolve async options type ${name}`);
  for (const declaration of namedDeclarations) {
    if (state.seen.has(declaration)) {
      continue;
    }
    state.seen.add(declaration);
    if (ts.isTypeAliasDeclaration(declaration)) {
      collectTypeSurface(declaration.type, state);
      continue;
    }
    addMembers(declaration.members, state.surface, state.assert, state.relativePath);
    for (const clause of declaration.heritageClauses ?? []) {
      for (const heritageType of clause.types) {
        collectNamedSurface(heritageType.expression.getText(), state);
      }
    }
  }
}

function collectTypeSurface(typeNode, state) {
  if (ts.isParenthesizedTypeNode(typeNode)) {
    collectTypeSurface(typeNode.type, state);
    return;
  }
  if (ts.isIntersectionTypeNode(typeNode)) {
    for (const memberType of typeNode.types) {
      collectTypeSurface(memberType, state);
    }
    return;
  }
  if (ts.isTypeLiteralNode(typeNode)) {
    addMembers(typeNode.members, state.surface, state.assert, state.relativePath);
    return;
  }
  state.assert(ts.isTypeReferenceNode(typeNode), state.relativePath, 'must use resolvable async options type composition');
  collectNamedSurface(typeNode.typeName.getText(), state);
}

function referencesJwtAsyncOptions(typeNode, declarations, seen = new Set()) {
  if (ts.isParenthesizedTypeNode(typeNode)) {
    return referencesJwtAsyncOptions(typeNode.type, declarations, seen);
  }
  if (ts.isIntersectionTypeNode(typeNode)) {
    return typeNode.types.some((memberType) => referencesJwtAsyncOptions(memberType, declarations, seen));
  }
  if (!ts.isTypeReferenceNode(typeNode)) {
    return ts.isExpressionWithTypeArguments(typeNode)
      && referencesNamedJwtAsyncOptions(
        typeNode.expression.getText(),
        typeNode.typeArguments,
        declarations,
        seen,
      );
  }
  return referencesNamedJwtAsyncOptions(typeNode.typeName.getText(), typeNode.typeArguments, declarations, seen);
}

function referencesNamedJwtAsyncOptions(name, typeArguments, declarations, seen) {
  if (name === 'AsyncModuleOptions') {
    return typeArguments?.[0]?.getText() === 'JwtVerifierOptions';
  }
  return (declarations.get(name) ?? []).some((declaration) => {
    if (seen.has(declaration)) {
      return false;
    }
    seen.add(declaration);
    return ts.isTypeAliasDeclaration(declaration)
      ? referencesJwtAsyncOptions(declaration.type, declarations, seen)
      : (declaration.heritageClauses ?? []).some((clause) => clause.types.some((heritageType) =>
        referencesJwtAsyncOptions(heritageType, declarations, seen)));
  });
}

function matchesSupportedMember(name, member) {
  if (name === 'global') {
    return member.questionToken !== undefined && member.type?.kind === ts.SyntaxKind.BooleanKeyword;
  }
  if (name === 'inject') {
    return member.questionToken !== undefined && member.type?.getText() === 'InjectionToken[]';
  }
  if (name !== 'useFactory' || member.questionToken !== undefined || !member.type || !ts.isFunctionTypeNode(member.type)) {
    return false;
  }
  const parameter = member.type.parameters[0];
  return member.type.parameters.length === 1
    && parameter.dotDotDotToken !== undefined
    && parameter.type?.getText() === 'unknown[]'
    && /^(?:MaybePromise<T>|MaybePromise<JwtVerifierOptions>)$/u.test(member.type.type.getText());
}

export function validateJwtAsyncOptions(optionsType, declarations, assert, relativePath) {
  assert(referencesJwtAsyncOptions(optionsType, declarations), relativePath, 'must keep useFactory returning final JwtVerifierOptions');
  const surface = new Map();
  collectTypeSurface(optionsType, { assert, declarations, relativePath, seen: new Set(), surface });
  const optionNames = [...surface.keys()].sort();
  assert(
    optionNames.join(',') === 'global,inject,useFactory',
    relativePath,
    `async options must contain exactly global, inject, and useFactory; found ${optionNames.join(', ')}`,
  );
  for (const [name, members] of surface) {
    assert(
      members.length > 0 && members.every((member) => matchesSupportedMember(name, member)),
      relativePath,
      name === 'global'
        ? 'global must remain an optional top-level boolean'
        : name === 'inject'
          ? 'inject must remain an optional InjectionToken[]'
          : 'useFactory must remain the required (...deps: unknown[]) => MaybePromise<JwtVerifierOptions> signature',
    );
  }
}
