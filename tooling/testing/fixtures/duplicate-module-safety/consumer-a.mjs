import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FluoError, getModuleMetadata, isFluoError, Module, publicToken } from '@fluojs/core';
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
import { JwtModule } from '@fluojs/jwt';
import {
  BEARER_JWT_STRATEGY_NAME,
  BearerJwtStrategy,
  createBearerJwtStrategyRegistration,
  PassportModule,
  RequireScopes,
  UseAuth,
} from '@fluojs/passport';
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
const singletonToken = publicToken('fluo.duplicate-module-safety.singleton');
const requestToken = publicToken('fluo.duplicate-module-safety.request');
const container = new Container().register(
  { provide: singletonToken, useFactory: () => ({ kind: 'singleton' }) },
  { provide: requestToken, scope: 'request', useFactory: () => ({ kind: 'request' }) },
);
const firstRequest = container.createRequestScope();
const secondRequest = container.createRequestScope();
const singleton = await container.resolve(singletonToken);
const error = new FluoError('duplicate module safety', { code: 'DUPLICATE_MODULE_SAFETY', details: { artifact: marker.artifact } });

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

async function observeReact() {
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
  const entry = createReactServerEntry(createElement('main', { 'data-artifact': marker.artifact }, 'packed fixture'));
  await renderReactResponse(entry, requestContext(response), {
    renderToReadableStream: async () => new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`<main data-artifact="${marker.artifact}">packed fixture</main>`));
        controller.close();
      },
    }),
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

async function observeJwtPassport() {
  class ProfileController {
    get() {
      return { artifact: marker.artifact, protected: true };
    }
  }
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
    providers: [BearerJwtStrategy],
  })(AuthModule);
  const adapter = FastifyHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
  const app = await FluoFactory.create(AuthModule, { adapter });
  try {
    await app.listen();
    const address = adapter.getServer().address();
    const port = typeof address === 'object' && address !== null ? address.port : undefined;
    if (!Number.isInteger(port) || port <= 0) throw new Error('Packed JWT adapter did not bind an ephemeral port.');
    const origin = `http://127.0.0.1:${port}`;
    const [missing, invalid] = await Promise.all([
      fetch(`${origin}/profile/`),
      fetch(`${origin}/profile/`, { headers: { authorization: 'Bearer invalid-token' } }),
    ]);
    return {
      invalid: { status: invalid.status, wwwAuthenticate: invalid.headers.get('www-authenticate') },
      missing: { status: missing.status, wwwAuthenticate: missing.headers.get('www-authenticate') },
      port,
    };
  } finally {
    await app.close();
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
  integrity: marker.marker,
  manifestName: manifest.name,
  marker: manifest.fluoDuplicateModuleSafety?.marker,
  package: manifest.name,
  realPath: resolvedPath,
  resolvedUrl,
  surfaces: {
    error: {
      code: error.code,
      details: error.details,
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
  },
  version: manifest.version,
};

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  console.log(JSON.stringify(observation));
}
