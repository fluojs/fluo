import { describe, expect, it } from 'vitest';

import { Test } from '@fluojs/testing';
import { DefaultValidator } from '@fluojs/validation';

import { withCleanup } from '../../../tooling/testing/with-cleanup.js';
import { AppModule } from './app';
import { CreateUserDto } from './users/create-user.dto';
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
  it.each([
    { field: 'name', value: 'absent', body: { email: 'ada@example.com' } },
    { field: 'name', value: 'null', body: { name: null, email: 'ada@example.com' } },
    { field: 'email', value: 'absent', body: { name: 'Ada' } },
    { field: 'email', value: 'null', body: { name: 'Ada', email: null } },
  ])('POST /users/: $value $field returns 400 without persisting a user', async ({ body }) => {
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());

      const result = await app.request('POST', '/users/').body(body).send();

      expect(result.status).toBe(400);
      const users = await app.request('GET', '/users/').send();
      expect(users.status).toBe(200);
      expect(users.body).toEqual([]);
    });
  });

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

describe('CreateUserDto', () => {
  it.each(['name', 'email'] as const)(
    'materialize: explicit undefined %s rejects with REQUIRED',
    async (field) => {
      const validator = new DefaultValidator();
      const body = { name: 'Ada', email: 'ada@example.com', [field]: undefined };

      const materialization = validator.materialize(body, CreateUserDto);

      await expect(materialization).rejects.toMatchObject({
        issues: [expect.objectContaining({ code: 'REQUIRED', field })],
      });
    },
  );
});
