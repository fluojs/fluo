import { Inject, Module } from '@fluojs/core';
import type { OnModuleDestroy } from '@fluojs/runtime';

const EXPORT_PREFIX = Symbol('EXPORT_PREFIX');

export class JobResources implements OnModuleDestroy {
  closed = false;

  onModuleDestroy(): void {
    this.closed = true;
  }
}

@Inject(EXPORT_PREFIX, JobResources)
export class ExportJob {
  constructor(
    private readonly prefix: string,
    private readonly resources: JobResources,
  ) {}

  async run(): Promise<readonly string[]> {
    if (this.resources.closed) throw new Error('The export job is closed.');
    return ['first', 'second'].map((name) => `${this.prefix}: ${name}`);
  }
}

@Module({
  providers: [
    { provide: EXPORT_PREFIX, useValue: 'exported' },
    JobResources,
    ExportJob,
  ],
})
export class AppModule {}
