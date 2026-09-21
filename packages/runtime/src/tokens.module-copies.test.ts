import { expect, it } from 'vitest';

const tokensModuleUrl = new URL('./tokens.ts', import.meta.url);

it('shares framework-owned runtime tokens across compatible module copies', async () => {
  const first = await import(`${tokensModuleUrl.href}?module-copy=first`);
  const second = await import(`${tokensModuleUrl.href}?module-copy=second`);

  expect({
    applicationLogger: first.APPLICATION_LOGGER === second.APPLICATION_LOGGER,
    bootstrapProviderTokens: first.BOOTSTRAP_PROVIDER_TOKENS === second.BOOTSTRAP_PROVIDER_TOKENS,
    bootstrapReadySignal: first.BOOTSTRAP_READY_SIGNAL === second.BOOTSTRAP_READY_SIGNAL,
    compiledModules: first.COMPILED_MODULES === second.COMPILED_MODULES,
    httpApplicationAdapter: first.HTTP_APPLICATION_ADAPTER === second.HTTP_APPLICATION_ADAPTER,
    platformShell: first.PLATFORM_SHELL === second.PLATFORM_SHELL,
    runtimeCleanupRegistration: first.RUNTIME_CLEANUP_REGISTRATION === second.RUNTIME_CLEANUP_REGISTRATION,
    runtimeContainer: first.RUNTIME_CONTAINER === second.RUNTIME_CONTAINER,
  }).toEqual({
    applicationLogger: true,
    bootstrapProviderTokens: true,
    bootstrapReadySignal: true,
    compiledModules: true,
    httpApplicationAdapter: true,
    platformShell: true,
    runtimeCleanupRegistration: true,
    runtimeContainer: true,
  });
});
