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
const shutdownSourcePath = 'packages/platform-deno/src/shutdown.ts';

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

function containsThrowStatement(node) {
  let found = false;

  const visit = (child) => {
    if (ts.isThrowStatement(child)) {
      found = true;
      return;
    }

    ts.forEachChild(child, visit);
  };

  visit(node);
  return found;
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

  const create = findClassMethod(sourceFile, 'DenoHttpApplicationAdapter', 'create');
  assert(
    create?.body && create.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword),
    `${adapterSourcePath} must expose DenoHttpApplicationAdapter.create(...) as the managed adapter construction path.`,
  );
  assert(
    !capabilities(create, {
      receiverFactories: { resolveSignalHost: 'deno' },
    }).has('signal registration'),
    `${adapterSourcePath} static adapter creation must not install shutdown signal handlers.`,
  );
}

function enforceShutdownSource(readText) {
  const sourceFile = parseDenoSource(shutdownSourcePath, readText(shutdownSourcePath));
  const registration = requireFunction(sourceFile, shutdownSourcePath, 'createDenoShutdownSignalRegistration');
  assert(
    capabilities(registration, {
      receiverFactories: { resolveSignalHost: 'deno' },
    }).has('signal registration'),
    'Deno signal registration must invoke addSignalListener(...).',
  );
  const removal = requireFunction(sourceFile, shutdownSourcePath, 'removeBindings');
  assert(
    capabilities(removal, { receivers: { host: 'deno' } }).has('signal removal'),
    'Deno signal cleanup must invoke removeSignalListener(...).',
  );
  enforceSignalCloseFailureOwnership(sourceFile);
}

function enforceSignalCloseFailureOwnership(sourceFile) {
  const signalClose = requireFunction(sourceFile, shutdownSourcePath, 'closeFromSignal');
  assert(
    !collectCallNames(signalClose).has('exit'),
    'closeFromSignal(...) must not set an exit status.',
  );
  assert(
    findCalls(signalClose, 'error').length > 0 && !containsThrowStatement(signalClose),
    'closeFromSignal(...) must log and swallow signal-triggered application close failures.',
  );
}

export function enforceDenoHostOwnedLifecycleSource(readText) {
  enforceHandlerSource(readText);
  enforceManagedAdapterSource(readText);
  enforceShutdownSource(readText);
}
