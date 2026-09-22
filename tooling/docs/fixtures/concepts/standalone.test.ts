import { FluoFactory } from '@fluojs/runtime';
import { expect, it } from 'vitest';
import { AppModule, ExportJob, JobResources } from './standalone-app';

it('runs injected work without HTTP and closes application resources', async () => {
  const context = await FluoFactory.createApplicationContext(AppModule);
  const resources = await context.get(JobResources);
  try {
    const job = await context.get(ExportJob);
    expect(await job.run()).toEqual(['exported: first', 'exported: second']);
    expect(resources.closed).toBe(false);
  } finally {
    await context.close();
  }
  expect(resources.closed).toBe(true);
});
