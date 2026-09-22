/**
 * Bun native composition fixture app.
 *
 * Runs the managed Bun adapter path end to end on a real `Bun.serve()`:
 * FluoFactory bootstrap, an ephemeral-port listener, a real HTTP request, and
 * SIGTERM-driven graceful shutdown observed by a DI lifecycle hook.
 *
 * The app imports built public entrypoints from this worktree. Build the
 * packages before running the fixture; source and dist identities must not mix.
 */
import { writeFileSync } from 'node:fs';

import { Controller, Get } from '../../../../../../packages/http/dist/index.js';
import { Inject, Module } from '../../../../../../packages/core/dist/index.js';
import {
  BunHttpApplicationAdapter,
  createBunShutdownSignalRegistration,
} from '../../../../../../packages/platform-bun/dist/index.js';
import {
  FluoFactory,
  defineModule,
  type OnApplicationShutdown,
} from '../../../../../../packages/runtime/dist/index.js';

const sentinelPath = process.argv[2];
if (!sentinelPath) {
  throw new Error('Usage: bun bun-server-app.ts <sentinel-path>');
}

class ShutdownProbe implements OnApplicationShutdown {
  onApplicationShutdown(signal?: string): void {
    writeFileSync(sentinelPath, `shutdown signal=${signal ?? 'none'}`);
  }
}

@Inject(ShutdownProbe)
@Controller('/health')
class HealthController {
  constructor(private readonly probe: ShutdownProbe) {}

  @Get('/status')
  status(): { status: string; runtime: string } {
    // Touches the injected dependency so the assertion proves DI wiring, not
    // just route matching.
    void this.probe;
    return { status: 'ok', runtime: 'bun' };
  }
}

@Module({
  controllers: [HealthController],
  providers: [ShutdownProbe],
})
class AppModule {}

defineModule(AppModule, {
  controllers: [HealthController],
  providers: [ShutdownProbe],
});

const adapter = BunHttpApplicationAdapter.create({ port: 0 });
const app = await FluoFactory.create(AppModule, {
  adapter,
  shutdownRegistration: createBunShutdownSignalRegistration(['SIGTERM']),
});

await app.listen();
console.log(`FLUO_LISTENING ${adapter.getListenTarget().url}`);

const response = await fetch(`${adapter.getListenTarget().url}/health/status`);
console.log(`FLUO_SELF_CHECK ${response.status} ${await response.text()}`);
