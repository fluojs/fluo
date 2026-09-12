import { describe, expect, it } from 'vitest';

import { Test } from '@fluojs/testing';

import { withCleanup } from '../../../tooling/testing/with-cleanup.js';
import { AppModule } from './app';
import { UsersRepo } from './users/users.repo';
import { UsersService } from './users/users.service';

describe('UsersRepo', () => {
  it('creates and retrieves users', () => {
    const repo = new UsersRepo();
    const user = repo.create('Ada', 'ada@example.com');

    expect(user).toEqual({ id: '1', name: 'Ada', email: 'ada@example.com' });
    expect(repo.findAll()).toHaveLength(1);
    expect(repo.findById('1')).toEqual(user);
    expect(repo.findById('999')).toBeUndefined();
  });
});

describe('UsersService', () => {
  it('delegates to UsersRepo', () => {
    const repo = new UsersRepo();
    const service = new UsersService(repo);

    const user = service.createUser('Ada', 'ada@example.com');
    expect(user.name).toBe('Ada');
    expect(service.listUsers()).toHaveLength(1);
    expect(service.getUser(user.id)).toEqual(user);
  });
});

describe('AppModule e2e', () => {
  it('serves health, ready, and user CRUD through Test.createApp request helpers', async () => {
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      await expect(app.request('GET', '/health').send()).resolves.toMatchObject({
        body: { status: 'ok' },
        status: 200,
      });

      await expect(app.request('GET', '/ready').send()).resolves.toMatchObject({
        body: { status: 'ready' },
        status: 200,
      });

      const createResult = await app
        .request('POST', '/users/')
        .body({ name: 'Grace', email: 'grace@example.com' })
        .send();
      expect(createResult.status).toBe(201);
      expect(createResult.body).toMatchObject({ name: 'Grace', email: 'grace@example.com' });

      const listResult = await app.request('GET', '/users/').send();
      expect(listResult.status).toBe(200);
      expect(listResult.body).toEqual([expect.objectContaining({ name: 'Grace' })]);
    });
  });

  it('returns validation errors for invalid input', async () => {
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      const result = await app
        .request('POST', '/users/')
        .body({ name: '', email: '' })
        .send();

      expect(result.status).toBe(400);
    });
  });
});
