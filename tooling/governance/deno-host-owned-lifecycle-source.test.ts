import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceDenoHostOwnedLifecycleSource } from './deno-host-owned-lifecycle-source.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function overrideFile(
  relativePath: string,
  transform: (content: string) => string,
): (requestedPath: string) => string {
  return (requestedPath) => requestedPath === relativePath ? transform(read(requestedPath)) : read(requestedPath);
}

describe('Deno host-owned lifecycle source contract', () => {
  it('rejects lifecycle ownership options on the host-owned handler', () => {
    // Given
    const readWithSignalOption = overrideFile('packages/platform-deno/src/fetch-handler.ts', (content) =>
      content.replace('  readonly rawBody?: boolean;', '  readonly rawBody?: boolean;\n  readonly shutdownSignals?: boolean;'));

    // When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleSource(readWithSignalOption);

    // Then
    expect(runGovernanceGuard).toThrow(/must not expose server, shutdown, signal, or websocket ownership options/);
  });

  it('rejects server startup from the host-owned handler implementation', () => {
    // Given
    const readWithServeCall = overrideFile('packages/platform-deno/src/fetch-handler.ts', (content) =>
      content.replace(
        '  validateNonNegativeIntegerOption',
        '  globalThis.Deno?.serve({ port: 3000 }, async () => new Response());\n  validateNonNegativeIntegerOption',
      ));

    // When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleSource(readWithServeCall);

    // Then
    expect(runGovernanceGuard).toThrow(/must not invoke server startup/);
  });

  it.each([
    [
      'server startup through call alias',
      'const startServer = globalThis.Deno?.serve;\n  startServer?.call(globalThis.Deno, { port: 3000 }, async () => new Response());',
      'server startup',
    ],
    [
      'signal registration through destructuring',
      "const { addSignalListener: registerSignal } = globalThis.Deno ?? {};\n  registerSignal?.('SIGTERM', () => {});",
      'signal registration',
    ],
    [
      'signal registration through Deno destructuring',
      "const { addSignalListener: registerSignal } = Deno;\n  registerSignal('SIGTERM', () => {});",
      'signal registration',
    ],
    [
      'server shutdown through bound method',
      'function stopController(controller: DenoServeController) {\n    const stopServer = controller.shutdown.bind(controller);\n    stopServer();\n  }',
      'server shutdown',
    ],
    [
      'server shutdown through destructuring',
      'function stopController(controller: DenoServeController) {\n    const { shutdown: stopServer } = controller;\n    stopServer();\n  }',
      'server shutdown',
    ],
    [
      'server shutdown through assignment transfer',
      'function stopController(controller: DenoServeController) {\n    let stopServer = () => undefined;\n    stopServer = controller.shutdown;\n    stopServer();\n  }',
      'server shutdown',
    ],
    [
      'server shutdown through destructuring assignment transfer',
      'function stopController(controller: DenoServeController) {\n    let stopServer = () => undefined;\n    ({ shutdown: stopServer } = controller);\n    stopServer();\n  }',
      'server shutdown',
    ],
    [
      'application close through identifier alias',
      'function closeManagedApplication(application: Application) {\n    const closeApplication = application.close;\n    closeApplication();\n  }',
      'server shutdown',
    ],
    [
      'websocket upgrade through identifier alias',
      "const upgradeSocket = globalThis.Deno?.upgradeWebSocket;\n  upgradeSocket?.(new Request('http://localhost'));",
      'websocket upgrades',
    ],
  ] as const)('rejects %s in the host-owned handler', (_caseName, sourceSnippet, ownership) => {
    // Given
    const readWithLifecycleAlias = overrideFile('packages/platform-deno/src/fetch-handler.ts', (content) =>
      content.replace(
        "  validateNonNegativeIntegerOption('maxBodySize', maxBodySize);",
        `  ${sourceSnippet}\n  validateNonNegativeIntegerOption('maxBodySize', maxBodySize);`,
      ));

    // When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleSource(readWithLifecycleAlias);

    // Then
    expect(runGovernanceGuard).toThrow(new RegExp(`must not invoke ${ownership}`));
  });

  it.each([
    [
      'unrelated receiver methods',
      'const utility = { close() {}, serve() {}, shutdown() {}, upgradeWebSocket() {} };\n  utility.close();\n  utility.serve();\n  utility.shutdown();\n  utility.upgradeWebSocket();',
    ],
    [
      'a local object shadowing the Deno global',
      'const Deno = { serve() {} };\n  Deno.serve();',
    ],
    [
      'signal-like destructuring from an unrelated object',
      "function registerSignal(signalRegistry: { addSignalListener: (signal: string, handler: () => void) => void }) {\n    const { addSignalListener } = signalRegistry;\n    addSignalListener('SIGTERM', () => {});\n  }",
    ],
    [
      'a stale shutdown alias after direct reassignment',
      'function invokeCallback(server: DenoServeController) {\n    let stop = server.shutdown;\n    stop = () => undefined;\n    stop();\n  }',
    ],
    [
      'a stale shutdown alias after destructuring reassignment',
      'function invokeCallback(server: DenoServeController) {\n    let { shutdown: stop } = server;\n    ({ shutdown: stop } = { shutdown: () => undefined });\n    stop();\n  }',
    ],
  ] as const)('accepts %s in the host-owned handler', (_caseName, sourceSnippet) => {
    // Given
    const readWithUnrelatedCall = overrideFile('packages/platform-deno/src/fetch-handler.ts', (content) =>
      content.replace(
        "  validateNonNegativeIntegerOption('maxBodySize', maxBodySize);",
        `  ${sourceSnippet}\n  validateNonNegativeIntegerOption('maxBodySize', maxBodySize);`,
      ));

    // When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleSource(readWithUnrelatedCall);

    // Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it('rejects a retained shutdown alias from a proven server controller', () => {
    // Given
    const readWithRetainedAlias = overrideFile('packages/platform-deno/src/fetch-handler.ts', (content) =>
      content.replace(
        "  validateNonNegativeIntegerOption('maxBodySize', maxBodySize);",
        '  function stopController(server: DenoServeController) {\n    let stop = server.shutdown;\n    const retainedStop = stop;\n    stop = () => undefined;\n    retainedStop();\n  }\n  validateNonNegativeIntegerOption(\'maxBodySize\', maxBodySize);',
      ));

    // When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleSource(readWithRetainedAlias);

    // Then
    expect(runGovernanceGuard).toThrow(/must not invoke server shutdown/);
  });

  it('rejects shutdown signal registration from managed app.listen', () => {
    // Given
    const readWithListenSignalAlias = overrideFile('packages/platform-deno/src/adapter.ts', (content) =>
      content.replace(
        '    try {\n      const serve = resolveServe(this.options.serve);',
        "    try {\n      const { addSignalListener: registerSignal } = globalThis.Deno ?? {};\n      registerSignal?.('SIGTERM', () => {});\n      const serve = resolveServe(this.options.serve);",
      ));

    // When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleSource(readWithListenSignalAlias);

    // Then
    expect(runGovernanceGuard).toThrow(/managed listen\(\) must not install shutdown signal handlers/);
  });

  it('requires runDenoApplication to pass signal registration through the runtime shutdownRegistration seam', () => {
    // Given
    const readWithoutShutdownRegistrationProperty = overrideFile('packages/platform-deno/src/adapter.ts', (content) =>
      content.replace('    shutdownRegistration: options.shutdownSignals === false', '    ignoredRegistration: options.shutdownSignals === false'));

    // When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleSource(readWithoutShutdownRegistrationProperty);

    // Then
    expect(runGovernanceGuard).toThrow(/runDenoApplication\(\.\.\.\) must pass Deno signal registration as shutdownRegistration/);
  });

  it('requires the managed close helper to invoke server shutdown before drain', () => {
    // Given
    const readWithoutServerShutdown = overrideFile('packages/platform-deno/src/adapter.ts', (content) =>
      content.replace('      await server.shutdown();', '      await server.finished;'));

    // When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleSource(readWithoutServerShutdown);

    // Then
    expect(runGovernanceGuard).toThrow(/closeDenoServerWithDrain\(\.\.\.\) must invoke server shutdown/);
  });

  it('requires the managed websocket path to invoke the resolved upgrade function', () => {
    // Given
    const readWithoutWebSocketUpgrade = overrideFile('packages/platform-deno/src/adapter.ts', (content) =>
      content.replace(
        '          upgrade: (upgradeRequest) => upgradeWebSocket(upgradeRequest),',
        '          upgrade: () => new Response(null, { status: 501 }),',
      ));

    // When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleSource(readWithoutWebSocketUpgrade);

    // Then
    expect(runGovernanceGuard).toThrow(/managed handle\(\) must invoke websocket upgrades/);
  });
});
