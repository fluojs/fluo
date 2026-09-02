import {
  createSourceFile,
  forEachChild,
  isAwaitExpression,
  isCallExpression,
  isClassDeclaration,
  isClassExpression,
  isExportDeclaration,
  isFunctionLike,
  isIdentifier,
  isMethodDeclaration,
  isNamedExports,
  isNewExpression,
  isPropertyAccessExpression,
  isStringLiteral,
  isTemplateExpression,
  isThrowStatement,
  ScriptKind,
  ScriptTarget,
  SyntaxKind,
} from 'typescript';

const transportSubpaths = ['tcp', 'redis', 'nats', 'kafka', 'rabbitmq', 'grpc', 'mqtt'];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Platform consistency governance check failed: ${message}`);
  }
}

function parseSource(source, fileName) {
  return createSourceFile(fileName, source, ScriptTarget.Latest, true, ScriptKind.TS);
}

function isNestedExecutableScope(node) {
  return isClassDeclaration(node) || isClassExpression(node) || isFunctionLike(node);
}

function hasNodeInScope(node, predicate) {
  if (predicate(node)) {
    return true;
  }

  let found = false;
  forEachChild(node, (child) => {
    if (!isNestedExecutableScope(child)) {
      found ||= hasNodeInScope(child, predicate);
    }
  });
  return found;
}

function findClassMethod(source, fileName, className, methodName) {
  const sourceFile = parseSource(source, fileName);
  let method;

  forEachChild(sourceFile, (node) => {
    if (!isClassDeclaration(node) || node.name?.text !== className) {
      return;
    }

    method = node.members.find((member) =>
      isMethodDeclaration(member) && member.name.getText(sourceFile) === methodName);
  });

  return method;
}

function hasExportedNames(source, fileName, requiredNames) {
  const exportedNames = new Set();

  for (const statement of parseSource(source, fileName).statements) {
    if (!isExportDeclaration(statement) || !statement.exportClause || !isNamedExports(statement.exportClause)) {
      continue;
    }

    for (const element of statement.exportClause.elements) {
      exportedNames.add(element.name.text);
    }
  }

  return requiredNames.every((name) => exportedNames.has(name));
}

function hasThrowingError(method, marker) {
  return method !== undefined && hasNodeInScope(method, (node) =>
    isThrowStatement(node) &&
    isNewExpression(node.expression) &&
    isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'Error' &&
    node.expression.arguments?.some((argument) => isStringLiteral(argument) && argument.text.includes(marker)));
}

function hasThrownTemplateError(method, marker) {
  return method !== undefined && hasNodeInScope(method, (node) =>
    isThrowStatement(node) &&
    isNewExpression(node.expression) &&
    isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'Error' &&
    node.expression.arguments?.some((argument) =>
      isTemplateExpression(argument) && argument.head.text.includes(marker)));
}

function hasMethodCall(method, receiver, methodName) {
  return method !== undefined && hasNodeInScope(method, (node) =>
    isCallExpression(node) &&
    isPropertyAccessExpression(node.expression) &&
    (
      receiver === 'this'
        ? node.expression.expression.kind === SyntaxKind.ThisKeyword
        : isIdentifier(node.expression.expression) && node.expression.expression.text === receiver
    ) &&
    node.expression.name.text === methodName);
}

function hasAwaitedGrpcEventCall(method) {
  return method !== undefined && hasNodeInScope(method, (node) =>
    isAwaitExpression(node) &&
    isCallExpression(node.expression) &&
    isPropertyAccessExpression(node.expression.expression) &&
    node.expression.expression.expression.kind === SyntaxKind.ThisKeyword &&
    node.expression.expression.name.text === 'callUnary' &&
    node.expression.arguments.some((argument) =>
      isPropertyAccessExpression(argument) &&
      isIdentifier(argument.expression) &&
      argument.expression.text === 'grpcKinds' &&
      argument.name.text === 'event'));
}

function hasEventFanout(method) {
  return method !== undefined && hasNodeInScope(method, (node) =>
    isCallExpression(node) &&
    isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'allSettled' &&
    node.arguments.some((argument) =>
      isCallExpression(argument) &&
      isPropertyAccessExpression(argument.expression) &&
      argument.expression.name.text === 'map'));
}

export function enforceMicroservicesRuntimeEvidence(readText) {
  const indexSource = readText('packages/microservices/src/index.ts');
  assert(
    hasExportedNames(
      indexSource,
      'packages/microservices/src/index.ts',
      ['BidiStreamPattern', 'ClientStreamPattern', 'ServerStreamPattern', 'RedisPubSubMicroserviceTransport', 'RedisStreamsMicroserviceTransport'],
    ),
    'packages/microservices/src/index.ts must structurally export the documented decorator and Redis transport symbols.',
  );

  const manifest = JSON.parse(readText('packages/microservices/package.json'));
  assert(
    transportSubpaths.every((subpath) => manifest.exports?.[`./${subpath}`] !== undefined),
    'packages/microservices/package.json must expose every documented transport subpath.',
  );

  const redisSend = findClassMethod(
    readText('packages/microservices/src/transports/redis-transport.ts'),
    'packages/microservices/src/transports/redis-transport.ts',
    'RedisPubSubMicroserviceTransport',
    'send',
  );
  assert(
    hasThrowingError(redisSend, 'does not support request/reply send()'),
    'RedisPubSubMicroserviceTransport.send() must structurally reject request/reply use.',
  );

  const serviceSource = readText('packages/microservices/src/service.ts');
  const dispatchPacket = findClassMethod(
    serviceSource,
    'packages/microservices/src/service.ts',
    'MicroserviceLifecycleService',
    'dispatchPacket',
  );
  const dispatchEvents = findClassMethod(
    serviceSource,
    'packages/microservices/src/service.ts',
    'MicroserviceLifecycleService',
    'dispatchEventHandlers',
  );
  const discoverHandlers = findClassMethod(
    serviceSource,
    'packages/microservices/src/service.ts',
    'MicroserviceLifecycleService',
    'discoverHandlerDescriptors',
  );
  assert(
    hasThrownTemplateError(dispatchPacket, 'Multiple message handlers matched pattern'),
    'MicroserviceLifecycleService must reject overlapping message handlers deterministically.',
  );
  assert(
    hasEventFanout(dispatchEvents),
    'MicroserviceLifecycleService must fan out event dispatch through all settled handler invocations.',
  );
  assert(
    hasMethodCall(discoverHandlers, 'this', 'isDuplicate'),
    'MicroserviceLifecycleService must suppress only repeated handler discovery through its route dedupe seam.',
  );

  const grpcEmit = findClassMethod(
    readText('packages/microservices/src/transports/grpc-transport.ts'),
    'packages/microservices/src/transports/grpc-transport.ts',
    'GrpcMicroserviceTransport',
    'emit',
  );
  assert(
    hasAwaitedGrpcEventCall(grpcEmit),
    'GrpcMicroserviceTransport.emit() must await its remote unary event acknowledgement.',
  );
}
