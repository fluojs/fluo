import { Module } from '@fluojs/core';
import { TerminusModule } from '@fluojs/terminus';
import { MemoryHealthIndicator } from '@fluojs/terminus/node';

import { OpsModule } from './ops/ops.module';
import { opsMetricsModule } from './ops/metrics-registry';

@Module({
  imports: [
    opsMetricsModule,
    TerminusModule.forRoot({
      indicators: [new MemoryHealthIndicator({ key: 'memory', rssThresholdBytes: Number.MAX_SAFE_INTEGER })],
    }),
    OpsModule,
  ],
})
export class AppModule {}
