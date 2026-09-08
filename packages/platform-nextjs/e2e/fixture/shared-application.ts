import { randomUUID } from 'node:crypto';

import { publicToken } from '@fluojs/core';
import { defineNextApplication } from '@fluojs/platform-nextjs';

import { observe } from './shared-observer';

export interface PublicBlog {
  readonly instance: string;
  read(actor: string): { readonly instance: string; readonly actor: string };
}

export const blogToken = publicToken<PublicBlog>('fluo-next-e2e/blog/v1');
export const evaluation = randomUUID();

function define(key: string) {
  return defineNextApplication({
    key: `fluo-next-e2e/${key}/v1`,
    load: () => import('./shared-backend').then(({ loadApplication }) => loadApplication(key)),
  });
}

export const getApplication = define('shared');
export const getOtherApplication = define('other');
export const getFailedApplication = define('failed');

export async function readBlog(path: string, actor: string) {
  const pending = getApplication();
  await observe(`joined:${path}`);
  const { app } = await pending;
  const blog = await app.container.resolve(blogToken);
  return { ...blog.read(actor), pid: process.pid, evaluation };
}
