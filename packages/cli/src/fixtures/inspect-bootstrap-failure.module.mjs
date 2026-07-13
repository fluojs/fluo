import { appendFileSync } from 'node:fs';

import { defineModule } from '@fluojs/runtime';

let lifecycleLogPath;

export function configureInspectLifecycleLogPath(logPath) {
  lifecycleLogPath = logPath;
}

export function resetInspectLifecycleLogPath() {
  lifecycleLogPath = undefined;
}

class InspectLifecycleRecorder {
  onModuleDestroy() {
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
