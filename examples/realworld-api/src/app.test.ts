import { describe, expect, it } from 'vitest';

import { createTestApp } from '@konekti/testing';
import { KonektiFactory } from '@konekti/runtime';
import type { FrameworkRequest, FrameworkResponse } from '@konekti/http';

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

function createRequest(method: string, path: string, body?: unknown): FrameworkRequest {
  return {
    body,
    cookies: {},
    headers: {},
    method,
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

describe('AppModule integration', () => {
  it('dispatches /health and /ready', async () => {
    const app = await KonektiFactory.create(AppModule, {});

    const healthRes = createResponse();
    await app.dispatch(createRequest('GET', '/health'), healthRes);
    expect(healthRes.body).toEqual({ status: 'ok' });

    const readyRes = createResponse();
    await app.dispatch(createRequest('GET', '/ready'), readyRes);
    expect(readyRes.body).toEqual({ status: 'ready' });

    await app.close();
  });

  it('dispatches POST /users/ then GET /users/', async () => {
    const app = await KonektiFactory.create(AppModule, {});

    const postRes = createResponse();
    await app.dispatch(createRequest('POST', '/users/', { name: 'Ada', email: 'ada@example.com' }), postRes);
    expect(postRes.statusCode).toBe(201);
    expect(postRes.body).toMatchObject({ name: 'Ada', email: 'ada@example.com' });

    const getRes = createResponse();
    await app.dispatch(createRequest('GET', '/users/'), getRes);
    expect(getRes.body).toEqual([expect.objectContaining({ name: 'Ada' })]);

    await app.close();
  });
});

describe('AppModule e2e', () => {
  it('serves health, ready, and user CRUD through createTestApp', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    await expect(app.dispatch({ method: 'GET', path: '/health' })).resolves.toMatchObject({
      body: { status: 'ok' },
      status: 200,
    });

    await expect(app.dispatch({ method: 'GET', path: '/ready' })).resolves.toMatchObject({
      body: { status: 'ready' },
      status: 200,
    });

    const createResult = await app.dispatch({
      method: 'POST',
      path: '/users/',
      body: { name: 'Grace', email: 'grace@example.com' },
    });
    expect(createResult.status).toBe(201);
    expect(createResult.body).toMatchObject({ name: 'Grace', email: 'grace@example.com' });

    const listResult = await app.dispatch({ method: 'GET', path: '/users/' });
    expect(listResult.status).toBe(200);
    expect(listResult.body).toEqual([expect.objectContaining({ name: 'Grace' })]);

    await app.close();
  });

  it('returns validation errors for invalid input', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    const result = await app.dispatch({
      method: 'POST',
      path: '/users/',
      body: { name: '', email: '' },
    });

    expect(result.status).toBe(400);

    await app.close();
  });
});
