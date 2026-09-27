import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineControllerMetadata, defineRouteMetadata } from '../../packages/core/dist/internal.js';
import { Inject } from '../../packages/core/dist/index.js';
import { DrizzleDatabase, DrizzleModule } from '../../packages/drizzle/dist/index.js';
import { BunHttpApplicationAdapter } from '../../packages/platform-bun/dist/index.js';
import { FluoFactory, defineModule } from '../../packages/runtime/dist/index.js';

const requireDrizzlePeer = createRequire(new URL('../../packages/drizzle/package.json', import.meta.url));
const { createClient } = requireDrizzlePeer('@libsql/client');
const { drizzle: drizzleSqlite } = requireDrizzlePeer('drizzle-orm/bun-sqlite');
const { drizzle: drizzleLibsql } = requireDrizzlePeer('drizzle-orm/libsql');
const { sql } = requireDrizzlePeer('drizzle-orm');

test('async libsql awaits a transaction callback through commit and forced-throw rollback', async () => {
  // Given: a local file-backed SQLite database uses libsql's asynchronous transaction runner.
  const directory = mkdtempSync(join(tmpdir(), 'fluo-drizzle-bun-'));
  const client = createClient({ url: `file:${join(directory, 'database.sqlite')}` });
  try {
    await client.execute('CREATE TABLE entries (name TEXT NOT NULL)');
    const database = drizzleLibsql(client);
    const wrapper = new DrizzleDatabase(database, undefined, { strictTransactions: true });

    // When: the first callback commits, then a separate callback writes and throws after await.
    let commitHandleObserved = false;
    await wrapper.transaction(async () => {
      commitHandleObserved = wrapper.current() !== database;
      await wrapper.current().run(sql`INSERT INTO entries (name) VALUES ('committed')`);
    });
    expect(Number((await client.execute('SELECT count(*) AS count FROM entries')).rows[0].count)).toBe(1);
    await client.execute('DELETE FROM entries');

    let rollbackHandleObserved = false;
    await expect(wrapper.transaction(async () => {
      rollbackHandleObserved = wrapper.current() !== database;
      await wrapper.current().run(sql`INSERT INTO entries (name) VALUES ('rolled-back')`);
      await Promise.resolve();
      throw new Error('forced rollback');
    })).rejects.toThrow('forced rollback');

    // Then: both callbacks used ALS's transaction handle, and the failed write left zero rows.
    expect(commitHandleObserved).toBe(true);
    expect(rollbackHandleObserved).toBe(true);
    expect(wrapper.current()).toBe(database);
    expect(Number((await client.execute('SELECT count(*) AS count FROM entries')).rows[0].count)).toBe(0);
  } finally {
    client.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test('synchronous bun:sqlite cannot roll back a callback that throws after await', async () => {
  // Given: a real synchronous SQLite driver advertises a transaction method.
  const connection = new Database(':memory:');
  try {
    connection.run('CREATE TABLE entries (name TEXT NOT NULL)');
    const database = drizzleSqlite(connection);
    const wrapper = new DrizzleDatabase(database, undefined, { strictTransactions: true });
    let transactionHandleObserved = false;

    // When: the callback writes and later throws after an asynchronous boundary.
    await expect(wrapper.transaction(async () => {
      transactionHandleObserved = wrapper.current() !== database;
      wrapper.current().run(sql`INSERT INTO entries (name) VALUES ('sync')`);
      await Promise.resolve();
      throw new Error('forced rollback');
    })).rejects.toThrow('forced rollback');

    // Then: ALS selection alone cannot establish rollback by the synchronous driver.
    expect(transactionHandleObserved).toBe(true);
    expect(connection.query('SELECT count(*) AS count FROM entries').get().count).toBe(1);
  } finally {
    connection.close();
  }
});

test('DrizzleModule dispatches a real Bun route and drains callbacks before disposal', async () => {
  // Given: the module owns a libsql wrapper and a live Bun HTTP listener.
  const directory = mkdtempSync(join(tmpdir(), 'fluo-drizzle-bun-route-'));
  const client = createClient({ url: `file:${join(directory, 'database.sqlite')}` });
  const events = [];
  let app;
  let releaseCallback;
  try {
    await client.execute('CREATE TABLE entries (name TEXT NOT NULL)');
    const database = drizzleLibsql(client);
    let resolveEntered;
    const entered = new Promise((resolve) => { resolveEntered = resolve; });
    const released = new Promise((resolve) => { releaseCallback = resolve; });

    class RouteController {
      constructor(wrapper) {
        this.wrapper = wrapper;
      }

      async write() {
        await this.wrapper.transaction(async () => {
          expect(this.wrapper.current()).not.toBe(database);
          await this.wrapper.current().run(sql`INSERT INTO entries (name) VALUES ('route')`);
          events.push('callback:entered');
          resolveEntered();
          await released;
          events.push('callback:settled');
        });
        return { committed: true };
      }

      async fail() {
        await this.wrapper.transaction(async () => {
          await this.wrapper.current().run(sql`INSERT INTO entries (name) VALUES ('failed-route')`);
          await Promise.resolve();
          throw new Error('forced route rollback');
        });
      }
    }
    Inject(DrizzleDatabase)(RouteController);
    defineControllerMetadata(RouteController, { basePath: '/drizzle' });
    defineRouteMetadata(RouteController.prototype, 'write', { method: 'POST', path: '/write' });
    defineRouteMetadata(RouteController.prototype, 'fail', { method: 'POST', path: '/fail' });

    class AppModule {}
    defineModule(AppModule, {
      controllers: [RouteController],
      imports: [DrizzleModule.forRoot({
        database,
        dispose() {
          events.push('dispose');
          client.close();
        },
        strictTransactions: true,
      })],
    });
    const adapter = new BunHttpApplicationAdapter({ hostname: '127.0.0.1', port: 0 });
    app = await FluoFactory.create(AppModule, { adapter });
    const wrapper = await app.container.resolve(DrizzleDatabase);
    expect(wrapper.current()).toBe(database);
    await app.listen();
    const port = adapter.getServer().port;

    // When: a routed failure rolls back, then a second route remains open during shutdown.
    const failedResponse = await fetch(`http://127.0.0.1:${port}/drizzle/fail`, { method: 'POST' });
    expect(failedResponse.status).toBe(500);
    expect(Number((await client.execute('SELECT count(*) AS count FROM entries')).rows[0].count)).toBe(0);
    const responsePromise = fetch(`http://127.0.0.1:${port}/drizzle/write`, { method: 'POST' });
    await entered;
    const closePromise = app.close();
    expect(events).toEqual(['callback:entered']);
    releaseCallback();
    const response = await responsePromise;
    await closePromise;

    // Then: the route committed before disposal, and shutdown waited for the callback.
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ committed: true });
    expect(events).toEqual(['callback:entered', 'callback:settled', 'dispose']);
    const inspector = createClient({ url: `file:${join(directory, 'database.sqlite')}` });
    try {
      expect(Number((await inspector.execute('SELECT count(*) AS count FROM entries')).rows[0].count)).toBe(1);
    } finally {
      inspector.close();
    }
  } finally {
    releaseCallback?.();
    await app?.close();
    client.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
