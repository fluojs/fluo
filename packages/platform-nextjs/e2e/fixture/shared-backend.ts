import { randomUUID } from 'node:crypto';

import { Inject, Module, publicToken } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';
import { NextHttpApplicationAdapter } from '@fluojs/platform-nextjs';
import { FluoFactory } from '@fluojs/runtime';

import type { PublicBlog } from './shared-application';
import { observe } from './shared-observer';

const token = publicToken<PublicBlog>('fluo-next-e2e/blog/v1');

class BlogService implements PublicBlog {
  readonly instance = randomUUID();

  read(actor: string) {
    return { instance: this.instance, actor };
  }
}

@Module({
  providers: [BlogService, { provide: token, useExisting: BlogService }],
  exports: [token],
})
class BlogModule {}

@Inject(token)
@Controller('/api/shared-closed')
class BlogController {
  constructor(private readonly blog: PublicBlog) {}

  @Get()
  read() {
    return this.blog.read('public');
  }
}

@Module({ imports: [BlogModule], controllers: [BlogController] })
class AppModule {}

export async function loadApplication(key: string) {
  if (process.env.FLUO_E2E_PHASE === 'build') {
    throw new Error('Shared bootstrap ran during Next build');
  }
  await observe('load', key);
  if (key === 'failed') throw new Error('FLUO_E2E_SHARED_BOOTSTRAP_FAILURE');
  const adapter = NextHttpApplicationAdapter.create();
  const app = await FluoFactory.create(AppModule, { adapter });
  try {
    await app.listen();
    return { app, adapter };
  } catch (error) {
    await app.close('bootstrap-failed');
    throw error;
  }
}
