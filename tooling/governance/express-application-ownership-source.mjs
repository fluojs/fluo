import ts from 'typescript';

import {
  collectStaticStrings,
  containsNamedTypeReference,
  containsSyntax,
  isExported,
  staticName,
  unwrapExpression,
} from './express-application-ownership-ast.mjs';
import { inspectConstructorExecution } from './express-application-ownership-execution.mjs';
import { createApplicationTypeInspector } from './express-application-ownership-types.mjs';

const adapterClassName = 'ExpressHttpApplicationAdapter';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Express application ownership contract check failed: ${message}`);
  }
}

function functionCreatesExpress(node) {
  if (!node.parameters || node.parameters.length > 0 || !node.body) {
    return false;
  }
  const body = ts.isBlock(node.body) ? node.body : undefined;
  if (!body) {
    return isExpressFactoryCall(node.body);
  }
  const statements = body.statements;
  if (statements.length === 1 && ts.isReturnStatement(statements[0])) {
    return statements[0].expression ? isExpressFactoryCall(statements[0].expression) : false;
  }
  if (statements.length !== 2 || !ts.isVariableStatement(statements[0]) || !ts.isReturnStatement(statements[1])) {
    return false;
  }
  const declaration = statements[0].declarationList.declarations[0];
  return (
    statements[0].declarationList.declarations.length === 1 &&
    declaration?.initializer !== undefined &&
    ts.isIdentifier(declaration.name) &&
    isExpressFactoryCall(declaration.initializer) &&
    statements[1].expression !== undefined &&
    ts.isIdentifier(statements[1].expression) &&
    statements[1].expression.text === declaration.name.text
  );
}

function isExpressFactoryCall(node, helperNames = new Set()) {
  node = unwrapExpression(node);
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    (node.expression.text === 'express' || helperNames.has(node.expression.text))
  );
}

function collectOwnedFactoryNames(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && functionCreatesExpress(statement)) {
      names.add(statement.name.text);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) &&
          functionCreatesExpress(declaration.initializer)
        ) {
          names.add(declaration.name.text);
        }
      }
    }
  }
  return names;
}

function isFunctionValuedProperty(member) {
  if (!ts.isPropertyDeclaration(member)) {
    return false;
  }
  return (
    (member.initializer !== undefined &&
      (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))) ||
    (member.type !== undefined && containsSyntax(member.type, ts.SyntaxKind.FunctionType))
  );
}

export function enforceAdapterOwnedApplicationSource(content, adapterSourcePath) {
  const sourceFile = ts.createSourceFile(
    adapterSourcePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  assert(sourceFile.parseDiagnostics.length === 0, `${adapterSourcePath} must remain valid TypeScript.`);

  const typeInspector = createApplicationTypeInspector(sourceFile);
  const exposedOptions = sourceFile.statements
    .filter((statement) =>
      (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && isExported(statement),
    )
    .filter((declaration) => typeInspector.declarationContainsApplication(declaration))
    .map((declaration) => declaration.name.text);
  assert(
    exposedOptions.length === 0,
    `${adapterSourcePath} must not expose existing Express application adoption options; found ${exposedOptions.join(', ')}.`,
  );

  const adapterClass = sourceFile.statements.find(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === adapterClassName,
  );
  assert(adapterClass, `${adapterSourcePath} must define ${adapterClassName}.`);
  const constructor = adapterClass.members.find(ts.isConstructorDeclaration);
  assert(constructor?.body, `${adapterSourcePath} must construct ${adapterClassName} through a constructor.`);

  const injectedApplication = constructor.parameters.some(
    (parameter) => parameter.type && typeInspector.containsApplicationType(parameter.type),
  );
  assert(
    !injectedApplication,
    `${adapterSourcePath} constructor must not accept an existing Express application.`,
  );

  const staticStrings = collectStaticStrings(sourceFile);
  const publicUseSurface = adapterClass.members.some((member) => {
    if (staticName(member.name, staticStrings) !== 'use') {
      return false;
    }
    const isPrivate = member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword) ?? false;
    return !isPrivate && (ts.isMethodDeclaration(member) || ts.isAccessor(member) || isFunctionValuedProperty(member));
  });
  assert(
    !publicUseSurface,
    `${adapterSourcePath} must not expose use(...) as a post-bootstrap native stack mutation surface.`,
  );

  const helperNames = collectOwnedFactoryNames(sourceFile);
  const nativeParameterNames = new Set(
    constructor.parameters
      .filter((parameter) =>
        (parameter.type && containsNamedTypeReference(parameter.type, 'ExpressNativeMiddleware')) ||
        (ts.isIdentifier(parameter.name) && parameter.name.text === 'nativeMiddleware'),
      )
      .flatMap((parameter) => (ts.isIdentifier(parameter.name) ? [parameter.name.text] : [])),
  );
  const { appAssignments, nativeMounts, routerMounts } = inspectConstructorExecution({
    constructor,
    helperNames,
    isOwnedFactoryCall: isExpressFactoryCall,
    nativeParameterNames,
  });
  assert(
    appAssignments.length > 0 && appAssignments.every(Boolean),
    `${adapterSourcePath} must construct its own Express application during adapter initialization.`,
  );

  assert(
    nativeMounts.length > 0 &&
      routerMounts.length > 0 &&
      Math.max(...nativeMounts) < Math.min(...routerMounts),
    `${adapterSourcePath} must mount nativeMiddleware before its router during adapter construction.`,
  );
}
