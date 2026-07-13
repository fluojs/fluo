import ts from 'typescript';

const executableEvidenceContracts = [
  {
    assertion: 'expect',
    expectedImport: '@fluojs/react/experimental/rsc',
    kind: 'runtime-parity',
    matcher: 'toEqual',
    path: 'packages/react/src/rsc-dual-import.test.ts',
    stableImport: '@fluojs/react/rsc',
  },
  {
    assertion: 'expectTypeOf',
    expectedImport: '@fluojs/react/experimental/rsc',
    kind: 'type-parity',
    matcher: 'toEqualTypeOf',
    path: 'packages/react/src/rsc-dual-import.types.test.ts',
    stableImport: '@fluojs/react/rsc',
  },
  {
    assertion: 'expect',
    inputs: ['hydration mismatch', 'recovery'],
    kind: 'runtime-result',
    matcher: 'toMatchObject',
    operation: 'verifyHydrationContract',
    path: 'packages/react/src/rsc-hydration.test.ts',
    resultProperty: 'recovered',
    stableImport: '@fluojs/react/rsc',
    suite: 'hydration',
  },
  {
    assertion: 'expect',
    inputs: ['private', 'no-store', 'cookie'],
    kind: 'runtime-result',
    matcher: 'toEqual',
    operation: 'verifyDataSafety',
    path: 'packages/react/src/rsc-data-safety.test.ts',
    resultProperty: 'safe',
    stableImport: '@fluojs/react/rsc',
    suite: 'data-safety',
  },
  {
    assertion: 'expect',
    inputs: ['node', 'vite'],
    kind: 'runtime-result',
    matcher: 'toMatchObject',
    operation: 'verifyRuntimeBundler',
    path: 'packages/react/src/rsc-runtime-bundler-matrix.test.ts',
    resultProperty: 'supported',
    stableImport: '@fluojs/react/rsc',
    suite: 'runtime/bundler',
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

function importBindings(sourceFile, requiredImport) {
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
}

function isBindingIdentifier(expression, bindings) {
  return ts.isIdentifier(expression) && bindings.has(expression.text);
}

function isContractRuntimeCall(expression, contract, stableBindings) {
  if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) {
    return false;
  }
  return (
    isBindingIdentifier(expression.expression.expression, stableBindings) &&
    expression.expression.name.text === contract.operation &&
    expression.arguments.length === contract.inputs.length &&
    expression.arguments.every(
      (argument, index) => ts.isStringLiteral(argument) && argument.text === contract.inputs[index],
    )
  );
}

function isExpectedRuntimeResult(expression, resultProperty) {
  if (!ts.isObjectLiteralExpression(expression) || expression.properties.length !== 1) {
    return false;
  }
  const property = expression.properties[0];
  return (
    ts.isPropertyAssignment(property) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
    property.name.text === resultProperty &&
    property.initializer.kind === ts.SyntaxKind.TrueKeyword
  );
}

function observedAssertion(call, assertionName) {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return undefined;
  }
  const assertionCall = call.expression.expression;
  if (
    !ts.isCallExpression(assertionCall) ||
    !ts.isIdentifier(assertionCall.expression) ||
    assertionCall.expression.text !== assertionName ||
    assertionCall.arguments.length !== 1
  ) {
    return undefined;
  }
  return {
    actual: assertionCall.arguments[0],
    expected: call.arguments,
    matcher: call.expression.name.text,
  };
}

function assertionSatisfiesContract(assertion, contract, stableBindings, expectedBindings) {
  switch (contract.kind) {
    case 'runtime-parity':
    case 'type-parity':
      return (
        assertion.matcher === contract.matcher &&
        assertion.expected.length === 1 &&
        isBindingIdentifier(assertion.actual, stableBindings) &&
        isBindingIdentifier(assertion.expected[0], expectedBindings)
      );
    case 'runtime-result': {
      return (
        assertion.matcher === contract.matcher &&
        assertion.expected.length === 1 &&
        isContractRuntimeCall(assertion.actual, contract, stableBindings) &&
        isExpectedRuntimeResult(assertion.expected[0], contract.resultProperty)
      );
    }
    default:
      throw new Error(`Unsupported React RSC executable evidence contract: ${contract.kind}`);
  }
}

function containsSemanticAssertion(node, contract, stableBindings, expectedBindings) {
  if (ts.isCallExpression(node)) {
    const assertion = observedAssertion(node, contract.assertion);
    if (assertion && assertionSatisfiesContract(assertion, contract, stableBindings, expectedBindings)) {
      return true;
    }
  }
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && containsSemanticAssertion(child, contract, stableBindings, expectedBindings)) {
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

function failureMessage(contract) {
  switch (contract.kind) {
    case 'runtime-parity':
      return `${contract.path} must contain at least one executable discovered test with an assertion that observes every required RSC import and compare stable runtime exports with experimental runtime exports.`;
    case 'type-parity':
      return `${contract.path} must contain at least one executable discovered test that compares stable declaration exports with experimental declaration exports.`;
    case 'runtime-result':
      return `${contract.path} must contain at least one executable discovered test with an assertion over an observable ${contract.suite} runtime result.`;
    default:
      throw new Error(`Unsupported React RSC executable evidence contract: ${contract.kind}`);
  }
}

function enforceExecutableEvidenceContract(contract, readText) {
  const sourceFile = parseSource(contract.path, readText(contract.path));
  const stableBindings = importBindings(sourceFile, contract.stableImport);
  const expectedBindings = contract.expectedImport ? importBindings(sourceFile, contract.expectedImport) : new Set();
  let disabledTests = 0;
  let executableTests = 0;

  function visit(node) {
    if (ts.isCallExpression(node)) {
      if (isDisabledTest(node)) {
        disabledTests += 1;
      }
      const callback = testCallback(node);
      if (callback && containsSemanticAssertion(callback, contract, stableBindings, expectedBindings)) {
        executableTests += 1;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  assert(disabledTests === 0, `${contract.path} must not use skipped, todo, or focused graduation tests.`);
  assert(executableTests > 0, failureMessage(contract));
}

export function enforceReactRscExecutableEvidence(readText) {
  for (const contract of executableEvidenceContracts) {
    enforceExecutableEvidenceContract(contract, readText);
  }
}
