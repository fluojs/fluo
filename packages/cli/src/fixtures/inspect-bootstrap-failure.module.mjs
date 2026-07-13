import { appendFileSync } from 'node:fs';

import { defineModule } from '@fluojs/runtime';

class InspectLifecycleRecorder {
  onModuleDestroy() {
    const lifecycleLogPath = process.env.FLUO_INSPECT_LIFECYCLE_LOG;
    if (lifecycleLogPath) {
      appendFileSync(lifecycleLogPath, 'close\n');
    }
  }
}

class FailingBootstrapService {
  onApplicationBootstrap() {
    throw new Error('inspect bootstrap fixture failed');
  }
}

/**
 * Represents an inspect fixture that fails after lifecycle resources are resolved.
 */
export class AppModule {}
defineModule(AppModule, {
  providers: [InspectLifecycleRecorder, FailingBootstrapService],
});
