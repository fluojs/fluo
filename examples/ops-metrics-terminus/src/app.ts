import { Module } from '@fluojs/core';
import { MetricsModule } from '@fluojs/metrics';
import { TerminusModule } from '@fluojs/terminus';
import { MemoryHealthIndicator } from '@fluojs/terminus/node';

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
