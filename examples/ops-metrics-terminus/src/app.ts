import { Module } from '@konekti/core';
import { MetricsModule } from '@konekti/metrics';
import { MemoryHealthIndicator, TerminusModule } from '@konekti/terminus';

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
