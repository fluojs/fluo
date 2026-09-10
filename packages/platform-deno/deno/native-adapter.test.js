const loadBuiltPackage = async (name) => {
  const manifestUrl = new URL(`../../${name}/package.json`, import.meta.url);
  const manifest = JSON.parse(await Deno.readTextFile(manifestUrl));
  return import(new URL(manifest.exports['.'].import, manifestUrl).href);
};

const [
  { Controller, Get },
  { defineModule, FluoFactory },
  {
    DenoHttpApplicationAdapter,
    createDenoFetchHandler,
  },
] = await Promise.all([
  loadBuiltPackage('http'),
  loadBuiltPackage('runtime'),
  loadBuiltPackage('platform-deno'),
]);

class HealthController {
  status() {
    return { status: 'ok' };
  }
}

Get('/status')(HealthController.prototype, 'status');
Controller('/health')(HealthController);

class AppModule {}
defineModule(AppModule, { controllers: [HealthController] });

Deno.test('createDenoFetchHandler dispatches a request through the published adapter', async () => {
  // Given: a bootstrapped application and a handler that does not own a listener.
  const app = await FluoFactory.create(AppModule, {
    adapter: DenoHttpApplicationAdapter.create(),
  });

  try {
    // When: Deno invokes the handler with a native Request.
    const response = await createDenoFetchHandler({
      dispatcher: app.dispatcher,
    })(new Request('http://fluo.test/health/status'));

    // Then: the framework route returns its public response.
    if (response.status !== 200 || await response.text() !== '{"status":"ok"}') {
      throw new Error('The Deno fetch handler did not dispatch the health route.');
    }
  } finally {
    await app.close();
  }
});

Deno.test('FluoFactory serves and closes a native Deno listener', async () => {
  // Given: a Deno listener whose address is reported without signal registration.
  const listening = Promise.withResolvers();
  const app = await FluoFactory.create(AppModule, {
    adapter: DenoHttpApplicationAdapter.create({
      hostname: '127.0.0.1',
      onListen: listening.resolve,
      port: 0,
    }),
  });

  try {
    await app.listen();
    const address = await listening.promise;

    // When: a real native Deno fetch reaches the managed listener.
    const response = await fetch(`http://${address.hostname}:${address.port}/health/status`);

    // Then: the listener dispatches the route before application-owned shutdown.
    if (response.status !== 200 || await response.text() !== '{"status":"ok"}') {
      throw new Error('The managed Deno listener did not dispatch the health route.');
    }
  } finally {
    await app.close();
  }
});
