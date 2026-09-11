import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cookieAuthModulePath = 'packages/passport/src/cookie/cookie-auth-module.ts';

function findCookieAuthForRoot(sourceFile) {
  let forRoot;

  function visit(node) {
    if (
      ts.isClassDeclaration(node)
      && node.name?.text === 'CookieAuthModule'
    ) {
      forRoot = node.members.find((member) =>
        ts.isMethodDeclaration(member)
        && member.name.getText(sourceFile) === 'forRoot'
        && member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword),
      );
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return forRoot;
}

function findPassportRegistration(forRoot, sourceFile) {
  let registration;

  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(sourceFile) === 'PassportModule'
      && node.expression.name.text === 'forRoot'
    ) {
      registration = node;
      return;
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(forRoot, visit);

  return registration;
}

function hasDefaultStrategySpread(options, parameterName) {
  return ts.isObjectLiteralExpression(options)
    && options.properties.some((property) =>
      ts.isPropertyAssignment(property)
      && property.name.getText() === 'defaultStrategy'
      && property.initializer.getText() === 'COOKIE_AUTH_STRATEGY_NAME',
    )
    && options.properties.some((property) =>
      ts.isSpreadAssignment(property)
      && property.expression.getText() === parameterName,
    );
}

function hasCookieRegistration(strategies) {
  return ts.isArrayLiteralExpression(strategies)
    && strategies.elements.some((element) =>
      ts.isObjectLiteralExpression(element)
      && element.properties.some((property) =>
        ts.isPropertyAssignment(property)
        && property.name.getText() === 'name'
        && property.initializer.getText() === 'COOKIE_AUTH_STRATEGY_NAME',
      )
      && element.properties.some((property) =>
        ts.isPropertyAssignment(property)
        && property.name.getText() === 'token'
        && property.initializer.getText() === 'CookieAuthStrategy',
      ),
    );
}

function hasAdditionalStrategiesSpread(strategies, parameterName) {
  return ts.isArrayLiteralExpression(strategies)
    && strategies.elements.some((element) =>
      ts.isSpreadElement(element) && element.expression.getText() === parameterName,
    );
}

/**
 * Enforces the executable cookie preset recipe: `CookieAuthModule.forRoot(...)`
 * owns one Passport registry and structurally composes application-supplied named
 * strategies into it.
 */
export function enforcePassportCookiePresetContract(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  const sourceText = readText(cookieAuthModulePath);
  const sourceFile = ts.createSourceFile(
    cookieAuthModulePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const forRoot = findCookieAuthForRoot(sourceFile);

  if (!forRoot || forRoot.parameters.length !== 3) {
    throw new Error(
      'Passport cookie preset contract failed: CookieAuthModule.forRoot must accept config, passportOptions, and additionalStrategies.',
    );
  }

  const passportOptionsParameter = forRoot.parameters[1]?.name.getText(sourceFile);
  const additionalStrategiesParameter = forRoot.parameters[2]?.name.getText(sourceFile);

  if (!passportOptionsParameter || !additionalStrategiesParameter) {
    throw new Error(
      'Passport cookie preset contract failed: CookieAuthModule.forRoot composition parameters are missing.',
    );
  }

  const registration = findPassportRegistration(forRoot, sourceFile);

  if (!registration || registration.arguments.length !== 2) {
    throw new Error(
      'Passport cookie preset contract failed: CookieAuthModule.forRoot must create one PassportModule registry.',
    );
  }

  const [options, strategies] = registration.arguments;

  if (!hasDefaultStrategySpread(options, passportOptionsParameter)) {
    throw new Error(
      'Passport cookie preset contract failed: Passport defaults must retain cookie fallback and forward passportOptions.',
    );
  }

  if (!hasCookieRegistration(strategies) || !hasAdditionalStrategiesSpread(strategies, additionalStrategiesParameter)) {
    throw new Error(
      'Passport cookie preset contract failed: the cookie strategy and additionalStrategies must share one Passport registry.',
    );
  }
}
