import { Module } from '@fluojs/core';
import { MetricsModule } from '@fluojs/metrics';
import { MemoryHealthIndicator, TerminusModule } from '@fluojs/terminus';

import { OpsModule } from './ops/ops.module';
import { sharedRegistry } from './ops/metrics-registry';

@Module({
  imports: [
    MetricsModule.forRoot({ registry: sharedRegistry }),
    TerminusModule.forRoot({
      indicators: [new MemoryHealthIndicator({ key: 'memory', rssThresholdBytes: Number.MAX_SAFE_INTEGER })],
    }),
    OpsModule,
  ],
})
export class AppModule {}
