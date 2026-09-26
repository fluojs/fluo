import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FluoError, getModuleMetadata, Inject, isFluoError, Module, publicToken, Scope } from '@fluojs/core';
import { Container } from '@fluojs/di';
import {
  assertRequestContext,
  Controller,
  createRequestContext,
  Get,
  getCurrentRequestContext,
  isCompatibleSseResponse,
  runWithRequestContext,
  SseResponse,
  waitForSseResponseCompletion,
} from '@fluojs/http';
import { JwtModule, JwtService } from '@fluojs/jwt';
import {
  BEARER_JWT_STRATEGY_NAME,
  BearerJwtStrategy,
  createBearerJwtStrategyRegistration,
  PassportModule,
  RequireScopes,
  UseAuth,
} from '@fluojs/passport';
import { MongooseConnection } from '@fluojs/mongoose';
import { ExpressHttpApplicationAdapter } from '@fluojs/platform-express';
import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { NodeHttpApplicationAdapter } from '@fluojs/platform-nodejs';
import { createReactServerEntry, renderReactResponse } from '@fluojs/react';
import { FluoFactory } from '@fluojs/runtime';
import { createElement } from 'react';

const resolvedUrl = import.meta.resolve('@fluojs/core');
const resolvedPath = realpathSync(fileURLToPath(resolvedUrl));
let directory = dirname(resolvedPath);
while (!existsSync(join(directory, 'package.json'))) directory = dirname(directory);
const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
const marker = JSON.parse(readFileSync(join(directory, 'fixture-artifact.json'), 'utf8'));
const installedPackages = Object.fromEntries(
  JSON.parse(process.env.FLUO_DUPLICATE_PACKAGE_NAMES ?? '[]').map((packageName) => {
    const entryPath = realpathSync(fileURLToPath(import.meta.resolve(packageName)));
    const packageRoot = dirname(dirname(entryPath));
    const packageManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    const packageMarker = JSON.parse(readFileSync(join(packageRoot, 'fixture-artifact.json'), 'utf8'));
    return [packageName, {
      artifact: packageMarker.artifact,
      entrySha256: packageMarker.entrySha256,
      installedSha256: createHash('sha256').update(readFileSync(entryPath)).digest('hex'),
      marker: packageMarker.marker,
      package: packageManifest.name,
      realPath: entryPath,
      version: packageManifest.version,
    }];
  }),
);
const singletonToken = publicToken('fluo.duplicate-module-safety.singleton');
const requestToken = publicToken('fluo.duplicate-module-safety.request');
const container = new Container().register(
  { provide: singletonToken, useFactory: () => ({ kind: 'singleton' }) },
  { provide: requestToken, scope: 'request', useFactory: () => ({ kind: 'request' }) },
);
const firstRequest = container.createRequestScope();
const secondRequest = container.createRequestScope();
const singleton = await container.resolve(singletonToken);
const error = new FluoError('duplicate module safety', { code: 'DUPLICATE_MODULE_SAFETY', meta: { artifact: marker.artifact } });

function requestContext(response = { committed: false, headers: {}, redirect() {}, send() {}, setHeader() {}, setStatus() {} }) {
  return createRequestContext({
    container,
    metadata: {},
    principal: { claims: { sub: `fixture-${marker.artifact}` }, scopes: ['fixture:read'], subject: `fixture-${marker.artifact}` },
    request: { cookies: {}, headers: {}, method: 'GET', params: {}, path: '/fixture', query: {}, raw: {}, url: '/fixture' },
    requestId: `fixture-${marker.artifact}`,
    response,
  });
}

function observeSse() {
  const frames = [];
  let closed = false;
  const response = {
    committed: false,
    headers: {},
    redirect() {},
    send() {},
    setHeader(name, value) { this.headers[name] = value; },
    setStatus(status) { this.status = status; this.statusSet = true; },
    stream: {
      get closed() { return closed; },
      close() { closed = true; },
      flush() {},
      onClose() { return () => {}; },
      write(frame) { frames.push(frame); return true; },
    },
  };
  const sse = new SseResponse(requestContext(response));
  const accepted = sse.send({ artifact: marker.artifact }, { event: 'fixture', id: '1' });
  const completion = waitForSseResponseCompletion(sse);
  sse.close();
  return completion.then(() => ({ accepted, compatible: isCompatibleSseResponse(sse), closed, frame: frames.join(''), status: response.status }));
}

async function observeReact(
  entry = createReactServerEntry(createElement('main', { 'data-artifact': marker.artifact }, 'packed fixture')),
) {
  const chunks = [];
  let closed = false;
  const response = {
    committed: false,
    headers: {},
    redirect() {},
    send(body) { chunks.push(String(body)); },
    setHeader(name, value) { this.headers[name] = value; },
    setStatus(status) { this.status = status; this.statusSet = true; },
    stream: {
      get closed() { return closed; },
      close() { closed = true; },
      flush() {},
      write(chunk) { chunks.push(new TextDecoder().decode(chunk)); return true; },
    },
  };
  await renderReactResponse(entry, requestContext(response), {
    renderToReadableStream: async (node) => {
      const artifact = node?.props?.['data-artifact'];
      if (typeof artifact !== 'string' || node.props.children !== 'packed fixture') {
        throw new Error('React renderer did not receive the packed server entry node.');
      }
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`<main data-artifact="${artifact}">packed fixture</main>`));
          controller.close();
        },
      });
    },
  });
  return { body: chunks.join(''), contentType: response.headers['Content-Type'], status: response.status };
}

async function observeAdapter(kind) {
  class PackedController {
    get() {
      return { artifact: marker.artifact, kind, request: 'served-by-packed-adapter' };
    }
  }
  Controller('/fixture')(PackedController);
  Get('/')(PackedController.prototype, 'get');
  class PackedModule {}
  Module({ controllers: [PackedController] })(PackedModule);
  const adapter = {
    express: ExpressHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 }),
    fastify: FastifyHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 }),
    node: NodeHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 }),
  }[kind];
  const app = await FluoFactory.create(PackedModule, { adapter });
  try {
    await app.listen();
    const address = adapter.getServer().address();
    const port = typeof address === 'object' && address !== null ? address.port : undefined;
    if (!Number.isInteger(port) || port <= 0) throw new Error(`Packed ${kind} adapter did not bind an ephemeral port.`);
    const response = await fetch(`http://127.0.0.1:${port}/fixture/`);
    return { body: await response.json(), kind, port, status: response.status };
  } finally {
    await app.close();
  }
}

async function observeJwtPassport(externalToken) {
  class PrincipalProvider {
    current() {
      const principal = assertRequestContext().principal;
      return { scopes: principal?.scopes, subject: principal?.subject };
    }
  }
  Scope('request')(PrincipalProvider);
  class ProfileController {
    constructor(principalProvider) {
      this.principalProvider = principalProvider;
    }
    get() {
      return { artifact: marker.artifact, principal: this.principalProvider.current(), protected: true };
    }
  }
  Inject(PrincipalProvider)(ProfileController);
  Scope('request')(ProfileController);
  const metadata = {};
  const classContext = { kind: 'class', metadata, name: 'ProfileController' };
  const methodContext = { kind: 'method', metadata, name: 'get' };
  Controller('/profile')(ProfileController, classContext);
  Get('/')(ProfileController.prototype.get, methodContext);
  UseAuth(BEARER_JWT_STRATEGY_NAME)(ProfileController.prototype.get, methodContext);
  RequireScopes('fixture:read')(ProfileController.prototype.get, methodContext);
  Object.defineProperty(ProfileController, Symbol.metadata, { value: metadata });
  class AuthModule {}
  Module({
    controllers: [ProfileController],
    imports: [
      JwtModule.forRoot({
        algorithms: ['HS256'],
        audience: 'duplicate-module-safety',
        global: true,
        issuer: 'duplicate-module-safety',
        secret: 'duplicate-module-safety-secret',
      }),
      PassportModule.forRoot(
        { defaultStrategy: BEARER_JWT_STRATEGY_NAME },
        [createBearerJwtStrategyRegistration()],
      ),
    ],
    providers: [BearerJwtStrategy, PrincipalProvider],
  })(AuthModule);
  const adapter = FastifyHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
  const app = await FluoFactory.create(AuthModule, { adapter });
  try {
    await app.listen();
    const address = adapter.getServer().address();
    const port = typeof address === 'object' && address !== null ? address.port : undefined;
    if (!Number.isInteger(port) || port <= 0) throw new Error('Packed JWT adapter did not bind an ephemeral port.');
    const origin = `http://127.0.0.1:${port}`;
    const jwt = await app.get(JwtService);
    const token = await jwt.sign({ scopes: ['fixture:read'] }, { subject: `fixture-${marker.artifact}` });
    const [missing, invalid, valid] = await Promise.all([
      fetch(`${origin}/profile/`),
      fetch(`${origin}/profile/`, { headers: { authorization: 'Bearer invalid-token' } }),
      fetch(`${origin}/profile/`, { headers: { authorization: `Bearer ${externalToken ?? token}` } }),
    ]);
    return {
      invalid: { status: invalid.status, wwwAuthenticate: invalid.headers.get('www-authenticate') },
      missing: { status: missing.status, wwwAuthenticate: missing.headers.get('www-authenticate') },
      port,
      token,
      valid: { body: await valid.json(), status: valid.status },
    };
  } finally {
    await app.close();
  }
}

async function observeRollback(original = new Error(`original-${marker.artifact}`)) {
  const events = [];
  const cleanup = new Error(`cleanup-${marker.artifact}`);
  const session = {
    async abortTransaction() {
      events.push('abort');
      throw cleanup;
    },
    async commitTransaction() {
      events.push('commit');
    },
    async endSession() {
      events.push('end');
    },
    async startTransaction() {
      events.push('start');
    },
  };
  const connection = new MongooseConnection({
    async startSession() {
      return session;
    },
  }, undefined, {
    rollbackObserver: {
      beginAttempt() {
        return { confirmRollback: () => true };
      },
      run(callback) {
        return callback();
      },
    },
    strictTransactions: true,
  });
  try {
    await connection.transaction(async () => {
      throw original;
    }, { shouldRollback: () => true });
    throw new Error('Expected transaction rollback to reject.');
  } catch (error) {
    const errors = error instanceof AggregateError ? error.errors : [];
    return {
      cleanupPreserved: errors.includes(cleanup),
      events,
      originalPreserved: errors.includes(original),
    };
  }
}

class FixtureProvider {}
class FixtureModule {}
Module({ controllers: [FixtureProvider], providers: [FixtureProvider] })(FixtureModule);
const moduleMetadata = getModuleMetadata(FixtureModule);
const scopedContext = await runWithRequestContext(requestContext(), async () => {
  await Promise.resolve();
  return {
    current: getCurrentRequestContext()?.requestId,
    principal: assertRequestContext().principal?.subject,
  };
});

export const observation = {
  artifact: marker.artifact,
  integrity: installedPackages['@fluojs/core']?.installedSha256,
  manifestName: manifest.name,
  marker: manifest.fluoDuplicateModuleSafety?.marker,
  package: manifest.name,
  packages: installedPackages,
  realPath: resolvedPath,
  resolvedUrl,
  surfaces: {
    error: {
      code: error.code,
      meta: error.meta,
      recognized: isFluoError(error, '@fluojs/core'),
    },
    metadata: moduleMetadata?.controllers?.includes(FixtureProvider) && moduleMetadata.providers?.includes(FixtureProvider),
    react: await observeReact(),
    requestContext: scopedContext,
    requestScope: (await firstRequest.resolve(requestToken)) !== (await secondRequest.resolve(requestToken)),
    singleton: singleton === await container.resolve(singletonToken),
    sse: await observeSse(),
    transports: await Promise.all(['node', 'fastify', 'express'].map(observeAdapter)),
    jwtPassport: await observeJwtPassport(),
    rollback: await observeRollback(),
  },
  version: manifest.version,
};

export const interop = {
  authenticateToken: async (token) => (await observeJwtPassport(token)).valid,
  container,
  createReactEntry: () => createReactServerEntry(createElement('main', { 'data-artifact': marker.artifact }, 'packed fixture')),
  createSse() {
    const frames = [];
    const sse = new SseResponse(requestContext({
      committed: false,
      headers: {},
      redirect() {},
      send() {},
      setHeader() {},
      setStatus() {},
      stream: { closed: false, close() { this.closed = true; }, write(frame) { frames.push(frame); return true; } },
    }));
    return { frames, sse };
  },
  error,
  getCurrentRequestContext,
  getModuleMetadata,
  isCompatibleSseResponse,
  isFluoError,
  module: FixtureModule,
  requestContext,
  requestToken,
  renderForeignReact: observeReact,
  rollbackForeignError: observeRollback,
  runWithRequestContext,
  singletonToken,
  waitForSseResponseCompletion,
};

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  console.log(JSON.stringify(observation));
}
