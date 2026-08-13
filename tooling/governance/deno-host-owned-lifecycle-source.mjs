import ts from 'typescript';

import {
  collectCallNames,
  collectLifecycleCalls,
  findCalls,
  findClassMethod,
  findFunction,
  parseDenoSource,
  staticName,
} from './deno-lifecycle-ast.mjs';

const fetchHandlerSourcePath = 'packages/platform-deno/src/fetch-handler.ts';
const adapterSourcePath = 'packages/platform-deno/src/adapter.ts';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Deno host-owned lifecycle contract check failed: ${message}`);
  }
}

function capabilities(node, initialProvenance) {
  return new Set(collectLifecycleCalls(node, initialProvenance).map((call) => call.capability));
}

function requireFunction(sourceFile, relativePath, name) {
  const declaration = findFunction(sourceFile, name);
  assert(declaration?.body, `${relativePath} must declare ${name}(...).`);
  return declaration;
}

function requireMethod(sourceFile, relativePath, name) {
  const method = findClassMethod(sourceFile, 'DenoHttpApplicationAdapter', name);
  assert(method?.body, `${relativePath} must keep managed ${name}() lifecycle ownership.`);
  return method;
}

function enforceHandlerSource(readText) {
  const sourceFile = parseDenoSource(fetchHandlerSourcePath, readText(fetchHandlerSourcePath));
  const options = sourceFile.statements.find(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === 'CreateDenoFetchHandlerOptions',
  );
  assert(options, `${fetchHandlerSourcePath} must declare CreateDenoFetchHandlerOptions.`);
  const optionNames = new Set(options.members.map((member) => staticName(member.name)).filter(Boolean));
  const missingRequestOptions = ['dispatcher', 'maxBodySize', 'multipart', 'rawBody'].filter(
    (name) => !optionNames.has(name),
  );
  assert(
    missingRequestOptions.length === 0,
    `${fetchHandlerSourcePath} must retain dispatcher and shared Web request parsing options; missing ${missingRequestOptions.join(', ')}.`,
  );
  assert(
    ![...optionNames].some((name) => /server|serve|shutdown|signal|websocket|upgrade/iu.test(name)),
    `${fetchHandlerSourcePath} must not expose server, shutdown, signal, or websocket ownership options.`,
  );

  const handler = requireFunction(sourceFile, fetchHandlerSourcePath, 'createDenoFetchHandler');
  assert(
    collectCallNames(handler).has('dispatchWebRequest'),
    'createDenoFetchHandler(...) must dispatch through the shared Web request path.',
  );
  const lifecycleCalls = collectLifecycleCalls(handler);
  assert(
    lifecycleCalls.length === 0,
    `createDenoFetchHandler(...) must not invoke ${lifecycleCalls[0]?.capability ?? 'host lifecycle calls'}.`,
  );
}

function enforceManagedAdapterSource(readText) {
  const sourceFile = parseDenoSource(adapterSourcePath, readText(adapterSourcePath));
  const listen = requireMethod(sourceFile, adapterSourcePath, 'listen');
  const listenCapabilities = capabilities(listen, {
    capabilityFactories: { resolveServe: 'server startup' },
  });
  assert(listenCapabilities.has('server startup'), `${adapterSourcePath} managed listen() must invoke server startup.`);
  assert(
    !listenCapabilities.has('signal registration') && !listenCapabilities.has('signal removal'),
    `${adapterSourcePath} managed listen() must not install shutdown signal handlers.`,
  );

  const close = requireMethod(sourceFile, adapterSourcePath, 'close');
  assert(
    collectCallNames(close).has('closeDenoServerWithDrain'),
    `${adapterSourcePath} close() must delegate to closeDenoServerWithDrain(...).`,
  );
  const closeHelper = requireFunction(sourceFile, adapterSourcePath, 'closeDenoServerWithDrain');
  const shutdownCall = collectLifecycleCalls(closeHelper).find((call) => call.capability === 'server shutdown');
  const drainCall = findCalls(closeHelper, 'waitForDrain')[0];
  assert(shutdownCall, 'closeDenoServerWithDrain(...) must invoke server shutdown.');
  assert(drainCall, 'closeDenoServerWithDrain(...) must await managed request drain.');
  assert(shutdownCall.node.pos < drainCall.pos, 'closeDenoServerWithDrain(...) must stop ingress before request drain.');

  const handle = requireMethod(sourceFile, adapterSourcePath, 'handle');
  assert(
    capabilities(handle, {
      capabilityFactories: { resolveUpgradeWebSocket: 'websocket upgrades' },
    }).has('websocket upgrades'),
    `${adapterSourcePath} managed handle() must invoke websocket upgrades through the resolved upgrade seam.`,
  );

  enforceRunHelperSource(sourceFile);
  const registration = requireFunction(sourceFile, adapterSourcePath, 'createDenoShutdownSignalRegistration');
  assert(
    capabilities(registration, {
      receiverFactories: { resolveDenoSignalGlobal: 'deno' },
    }).has('signal registration'),
    'Deno signal registration must invoke addSignalListener(...).',
  );
  const removal = requireFunction(sourceFile, adapterSourcePath, 'removeDenoSignalBindings');
  assert(
    capabilities(removal, { receivers: { denoGlobal: 'deno' } }).has('signal removal'),
    'Deno signal cleanup must invoke removeSignalListener(...).',
  );
}

function enforceRunHelperSource(sourceFile) {
  const runApplication = requireFunction(sourceFile, adapterSourcePath, 'runDenoApplication');
  const runnerCall = findCalls(runApplication, 'runHttpAdapterApplication')[0];
  assert(runnerCall, 'runDenoApplication(...) must use the managed HTTP adapter runner.');
  const options = runnerCall.arguments[1];
  assert(options && ts.isObjectLiteralExpression(options), 'runDenoApplication(...) must pass managed runner options inline.');
  const shutdownRegistration = options.properties.find(
    (property) => ts.isPropertyAssignment(property) && staticName(property.name) === 'shutdownRegistration',
  );
  assert(
    shutdownRegistration && collectCallNames(shutdownRegistration.initializer).has('createDenoShutdownSignalRegistration'),
    'runDenoApplication(...) must pass Deno signal registration as shutdownRegistration.',
  );
}

export function enforceDenoHostOwnedLifecycleSource(readText) {
  enforceHandlerSource(readText);
  enforceManagedAdapterSource(readText);
}
