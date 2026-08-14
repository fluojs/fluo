import ts from 'typescript';

const coreTypesPath = 'packages/core/src/types.ts';
const configModulePath = 'packages/config/src/module.ts';
const jwtModulePath = 'packages/jwt/src/module.ts';

function fail(relativePath, message) {
  throw new Error(`JWT async registration contract check failed: ${relativePath} ${message}.`);
}

function assert(condition, relativePath, message) {
  if (!condition) {
    fail(relativePath, message);
  }
}

function parseSource(relativePath, sourceText) {
  const source = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (source.parseDiagnostics.length > 0) {
    const details = source.parseDiagnostics
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('; ');
    fail(relativePath, `must remain valid TypeScript (${details})`);
  }
  return source;
}

function propertyName(node) {
  if (node === undefined) {
    return undefined;
  }
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return node.getText();
}

function collectDeclarations(sources) {
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

function addMembers(members, surface, relativePath) {
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
  assert(namedDeclarations?.length > 0, jwtModulePath, `must resolve async options type ${name}`);
  for (const declaration of namedDeclarations) {
    if (state.seen.has(declaration)) {
      continue;
    }
    state.seen.add(declaration);
    if (ts.isTypeAliasDeclaration(declaration)) {
      collectTypeSurface(declaration.type, state);
      continue;
    }
    addMembers(declaration.members, state.surface, jwtModulePath);
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
    addMembers(typeNode.members, state.surface, jwtModulePath);
    return;
  }
  assert(ts.isTypeReferenceNode(typeNode), jwtModulePath, 'must use resolvable async options type composition');
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
    return false;
  }
  return referencesNamedJwtAsyncOptions(typeNode.typeName.getText(), typeNode.typeArguments, declarations, seen);
}

function referencesNamedJwtAsyncOptions(name, typeArguments, declarations, seen) {
  if (name === 'AsyncModuleOptions') {
    return typeArguments?.[0]?.getText() === 'JwtVerifierOptions';
  }
  const namedDeclarations = declarations.get(name) ?? [];
  return namedDeclarations.some((declaration) => {
    if (seen.has(declaration)) {
      return false;
    }
    seen.add(declaration);
    if (ts.isTypeAliasDeclaration(declaration)) {
      return referencesJwtAsyncOptions(declaration.type, declarations, seen);
    }
    return (declaration.heritageClauses ?? []).some((clause) => clause.types.some((heritageType) =>
      referencesNamedJwtAsyncOptions(
        heritageType.expression.getText(),
        heritageType.typeArguments,
        declarations,
        seen,
      )));
  });
}

function propertyInitializer(object, name) {
  const property = object.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === name);
  return property && ts.isPropertyAssignment(property) ? property.initializer : undefined;
}

export function enforceJwtAsyncRegistrationSourceContract(readText) {
  const coreTypes = parseSource(coreTypesPath, readText(coreTypesPath));
  const configModuleSource = parseSource(configModulePath, readText(configModulePath));
  const jwtModuleSource = parseSource(jwtModulePath, readText(jwtModulePath));
  const declarations = collectDeclarations([coreTypes, jwtModuleSource]);
  const asyncOptions = declarations.get('AsyncModuleOptions')?.find(ts.isInterfaceDeclaration);
  assert(asyncOptions, coreTypesPath, 'must declare AsyncModuleOptions<T>');
  const useFactoryMember = asyncOptions.members.find((member) => propertyName(member.name) === 'useFactory');
  assert(
    useFactoryMember?.type?.getText().includes('MaybePromise<T>'),
    coreTypesPath,
    'must keep useFactory responsible for returning the final typed module options',
  );

  const configModule = configModuleSource.statements.find((statement) =>
    ts.isClassDeclaration(statement) && statement.name?.text === 'ConfigModule');
  const configForRoot = configModule?.members.find((member) =>
    ts.isMethodDeclaration(member) && propertyName(member.name) === 'forRoot');
  const configMetadataStatement = configForRoot?.body?.statements.find((statement) =>
    ts.isExpressionStatement(statement)
    && ts.isCallExpression(statement.expression)
    && statement.expression.expression.getText() === 'defineModuleMetadata');
  const configMetadata = configMetadataStatement && ts.isExpressionStatement(configMetadataStatement)
    && ts.isCallExpression(configMetadataStatement.expression)
    ? configMetadataStatement.expression.arguments[1]
    : undefined;
  assert(
    configMetadata && ts.isObjectLiteralExpression(configMetadata)
      && propertyInitializer(configMetadata, 'global')?.getText() === 'loadOptions.global ?? true'
      && propertyInitializer(configMetadata, 'exports')?.getText().includes('ConfigService'),
    configModulePath,
    'must export ConfigService globally by default for async module factories',
  );

  const jwtModule = jwtModuleSource.statements.find((statement) =>
    ts.isClassDeclaration(statement) && statement.name?.text === 'JwtModule');
  const forRootAsync = jwtModule?.members.find((member) =>
    ts.isMethodDeclaration(member) && propertyName(member.name) === 'forRootAsync');
  assert(forRootAsync && ts.isMethodDeclaration(forRootAsync), jwtModulePath, 'must declare JwtModule.forRootAsync(...)');
  const optionsType = forRootAsync.parameters[0]?.type;
  assert(optionsType, jwtModulePath, 'must type JwtModule.forRootAsync(...) options');
  assert(
    referencesJwtAsyncOptions(optionsType, declarations),
    jwtModulePath,
    'must keep useFactory returning final JwtVerifierOptions',
  );

  const surface = new Map();
  collectTypeSurface(optionsType, { declarations, seen: new Set(), surface });
  const optionNames = [...surface.keys()].sort();
  assert(
    optionNames.join(',') === 'global,inject,useFactory',
    jwtModulePath,
    `async options must contain exactly global, inject, and useFactory; found ${optionNames.join(', ')}`,
  );
  const globalMembers = surface.get('global') ?? [];
  assert(
    globalMembers.length > 0 && globalMembers.every((member) =>
      member.questionToken !== undefined && member.type?.kind === ts.SyntaxKind.BooleanKeyword),
    jwtModulePath,
    'global must remain an optional top-level boolean',
  );

  const returnStatement = forRootAsync.body?.statements.find(ts.isReturnStatement);
  const createModuleCall = returnStatement?.expression && ts.isCallExpression(returnStatement.expression)
    ? returnStatement.expression
    : undefined;
  const optionsProvider = createModuleCall?.arguments[0];
  assert(
    createModuleCall?.expression.getText() === 'this.createModule' &&
      optionsProvider !== undefined && ts.isObjectLiteralExpression(optionsProvider),
    jwtModulePath,
    'must pass one explicit options provider into createModule(...)',
  );
  const providerNames = optionsProvider.properties.map((property) => propertyName(property.name)).sort();
  assert(
    providerNames.join(',') === 'inject,provide,scope,useFactory',
    jwtModulePath,
    `options provider must contain exactly inject, provide, scope, and useFactory; found ${providerNames.join(', ')}`,
  );
  assert(
    propertyInitializer(optionsProvider, 'inject')?.getText() === 'options.inject' &&
      propertyInitializer(optionsProvider, 'useFactory')?.getText() === 'options.useFactory',
    jwtModulePath,
    'must forward inject and useFactory to the JWT options provider',
  );
  assert(
    createModuleCall.arguments[5]?.getText() === 'options.global ?? false',
    jwtModulePath,
    'must forward top-level global to module visibility',
  );
}
