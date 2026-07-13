import { appendFileSync } from 'node:fs';

import { defineModule } from '@fluojs/runtime';

class SharedService {}

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

/**
 * Represents the shared module.
 */
export class SharedModule {}
defineModule(SharedModule, {
  exports: [SharedService],
  providers: [SharedService],
});

/**
 * Represents the app module.
 */
export class AppModule {}
defineModule(AppModule, {
  imports: [SharedModule],
  providers: [InspectLifecycleRecorder],
});
