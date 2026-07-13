import ts from 'typescript';

const executableEvidenceContracts = [
  {
    assertion: 'expect',
    imports: ['@fluojs/react/rsc', '@fluojs/react/experimental/rsc'],
    path: 'packages/react/src/rsc-dual-import.test.ts',
  },
  {
    assertion: 'expectTypeOf',
    imports: ['@fluojs/react/rsc', '@fluojs/react/experimental/rsc'],
    path: 'packages/react/src/rsc-dual-import.types.test.ts',
  },
  {
    assertion: 'expect',
    imports: ['@fluojs/react/rsc'],
    path: 'packages/react/src/rsc-hydration.test.ts',
  },
  {
    assertion: 'expect',
    imports: ['@fluojs/react/rsc'],
    path: 'packages/react/src/rsc-data-safety.test.ts',
  },
  {
    assertion: 'expect',
    imports: ['@fluojs/react/rsc'],
    path: 'packages/react/src/rsc-runtime-bundler-matrix.test.ts',
  },
];

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

function importBindingGroups(sourceFile, requiredImports) {
  return requiredImports.map((requiredImport) => {
    const bindings = new Set();
    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== requiredImport
      ) {
        continue;
      }

      const importClause = statement.importClause;
      if (importClause?.name) {
        bindings.add(importClause.name.text);
      }
      if (importClause?.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
        bindings.add(importClause.namedBindings.name.text);
      }
      if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          bindings.add(element.name.text);
        }
      }
    }
    assert(bindings.size > 0, `${sourceFile.fileName} must import ${requiredImport} as executable evidence.`);
    return bindings;
  });
}

function assertionRootName(expression) {
  if (ts.isCallExpression(expression)) {
    if (ts.isIdentifier(expression.expression)) {
      return expression.expression.text;
    }
    return assertionRootName(expression.expression);
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return assertionRootName(expression.expression);
  }
  return undefined;
}

function referencedIdentifiers(node) {
  const identifiers = new Set();
  function visit(child) {
    if (ts.isIdentifier(child)) {
      identifiers.add(child.text);
    }
    ts.forEachChild(child, visit);
  }
  visit(node);
  return identifiers;
}

function containsObservedAssertion(node, assertionName, bindingGroups) {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    assertionRootName(node.expression.expression) === assertionName
  ) {
    const identifiers = referencedIdentifiers(node);
    if (bindingGroups.every((bindings) => [...bindings].some((binding) => identifiers.has(binding)))) {
      return true;
    }
  }

  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && containsObservedAssertion(child, assertionName, bindingGroups)) {
      found = true;
    }
  });
  return found;
}

function isEachTestFactory(expression) {
  return (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === 'each' &&
    ts.isIdentifier(expression.expression.expression) &&
    (expression.expression.expression.text === 'it' || expression.expression.expression.text === 'test')
  );
}

function testCallback(call) {
  const expression = call.expression;
  const isDirectTest = ts.isIdentifier(expression) && (expression.text === 'it' || expression.text === 'test');
  if (!isDirectTest && !isEachTestFactory(expression)) {
    return undefined;
  }
  const callback = call.arguments[1];
  return callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ? callback : undefined;
}

function isDisabledTest(call) {
  return (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    (call.expression.expression.text === 'it' || call.expression.expression.text === 'test') &&
    ['only', 'skip', 'todo'].includes(call.expression.name.text)
  );
}

function enforceExecutableEvidenceContract(contract, readText) {
  const sourceFile = parseSource(contract.path, readText(contract.path));
  const bindingGroups = importBindingGroups(sourceFile, contract.imports);
  let disabledTests = 0;
  let executableTests = 0;

  function visit(node) {
    if (ts.isCallExpression(node)) {
      if (isDisabledTest(node)) {
        disabledTests += 1;
      }
      const callback = testCallback(node);
      if (callback && containsObservedAssertion(callback, contract.assertion, bindingGroups)) {
        executableTests += 1;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  assert(disabledTests === 0, `${contract.path} must not use skipped, todo, or focused graduation tests.`);
  assert(
    executableTests > 0,
    `${contract.path} must contain at least one executable discovered test with an assertion that observes every required RSC import.`,
  );
}

export function enforceReactRscExecutableEvidence(readText) {
  for (const contract of executableEvidenceContracts) {
    enforceExecutableEvidenceContract(contract, readText);
  }
}
