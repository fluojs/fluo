import { Controller, Get } from 'npm:@fluojs/http';
import { defineModule } from 'npm:@fluojs/runtime';
import {
  bootstrapDenoApplication,
  createDenoFetchHandler,
  runDenoApplication,
} from 'npm:@fluojs/platform-deno';

@Controller('/health')
class HealthController {
  @Get('/status')
  status() {
    return { status: 'ok' };
  }
}

class AppModule {}
defineModule(AppModule, { controllers: [HealthController] });

Deno.test('createDenoFetchHandler dispatches a request through the published adapter', async () => {
  // Given: a bootstrapped application and a handler that does not own a listener.
  const app = await bootstrapDenoApplication(AppModule);

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

Deno.test('runDenoApplication serves and closes a native Deno listener', async () => {
  // Given: a Deno listener whose address is reported without signal registration.
  const listening = Promise.withResolvers<{ hostname: string; port: number }>();
  const app = await runDenoApplication(AppModule, {
    hostname: '127.0.0.1',
    onListen: listening.resolve,
    port: 0,
    shutdownSignals: false,
  });

  try {
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
