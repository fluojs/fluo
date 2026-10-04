import { Container } from '@fluojs/di';
import { Controller, FromBody, Post, RequestDto, createDispatcher, createHandlerMapping } from './index.js';
import { MinLength } from '@fluojs/validation';
import { expect, it, vi } from 'vitest';
import { createRequest, createResponse } from './dispatch/error-representation.test-fixture.js';
import { BadRequestException, HttpFormRejection } from './index.js';
import { HTTP_FORM_VALIDATION, parseHttpFormErrors } from './form-representation.js';
import { writeErrorResponse } from './dispatch/dispatch-error-representation.js';

it('projects an actual DTO rejection without changing canonical JSON', async () => {
  class Input {
    @FromBody('display_name')
    @MinLength(3)
    name = '';
  }
  @Controller('/save')
  class Save {
    @Post('/')
    @RequestDto(Input)
    save() { return {}; }
  }
  const project = () => ({ fieldErrors: { name: ['Name must have three characters.'] }, formErrors: [] });
  const container = new Container();
  container.register(Save);
  const app = createDispatcher({
    rootContainer: container,
    handlerMapping: createHandlerMapping([{ controllerToken: Save }]),
    errorRepresentation: {
      html: { render: () => '<main>Correct input</main>' },
      ...{ form: { project } },
    },
  });
  try {
    const request = { ...createRequest('/save', 'application/vnd.fluo.form+json;v=1', 'POST'), body: { display_name: 'x' } };
    // When: an actual DTO rejection negotiates a bounded form projection.
    const enhanced = createResponse();
    await app.dispatch(request, enhanced);
    // Then: the HTTP error status remains, but no submitted value or arbitrary exception is shipped.
    expect(enhanced.statusCode).toBe(400);
    expect(enhanced.body).toEqual({
      version: 1, outcome: 'validation', fieldErrors: { name: ['Name must have three characters.'] }, formErrors: [],
    });
    const json = createResponse();
    await app.dispatch({ ...request, headers: { accept: 'application/json' } }, json);
    expect(json.body).toMatchObject({ error: { status: 400, code: 'BAD_REQUEST' } });
  } finally {
    await container.dispose();
  }
});

it('does not relabel a generic 400 as validated input rejection', async () => {
  const container = new Container();
  let projections = 0;
  const response = createResponse();
  await writeErrorResponse(new BadRequestException('Generic error', {
    details: [{ field: 'name', code: 'GENERIC_ERROR', message: 'Untrusted secret body' }],
  }), {
    container, metadata: {}, request: createRequest('/save', 'application/vnd.fluo.form+json;v=1', 'POST'), response,
  }, { representation: { html: { render: () => '<main>Submission refused</main>' }, form: { project: () => {
    projections++;
    return { fieldErrors: { name: ['Should not project'] }, formErrors: [] };
  } } } });
  expect(projections).toBe(0);
  expect(response.statusCode).toBe(400);
  expect(response.body).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  expect(response.headers['Content-Type']).toBe('application/json; charset=utf-8');
  await container.dispose();
});

it('negotiates an explicit safe domain form rejection through the HTTP error writer', async () => {
  const container = new Container();
  const response = createResponse();
  await writeErrorResponse(HttpFormRejection.create({
    fieldErrors: {}, formErrors: ['The product is already reserved.'],
  }), {
    container, metadata: {}, request: createRequest('/save', 'application/vnd.fluo.form+json;v=1', 'POST'), response,
  });
  expect(response.statusCode).toBe(400);
  expect(response.body).toEqual({
    version: 1, outcome: 'validation', fieldErrors: {}, formErrors: ['The product is already reserved.'],
  });
  expect(response.headers.Vary).toBe('Accept');
  await container.dispose();
});

it('bounds field projections and rejects unknown shapes without copying arbitrary bodies', () => {
  expect(parseHttpFormErrors({ fieldErrors: { name: ['x'.repeat(257)] }, formErrors: [] })).toBeUndefined();
  expect(parseHttpFormErrors({ fieldErrors: { name: ['Safe'] }, formErrors: 'Not an array' })).toBeUndefined();
  expect(parseHttpFormErrors({ fieldErrors: { 'unsafe[secret]': ['Safe'] }, formErrors: [] })).toBeUndefined();
  expect(parseHttpFormErrors({ fieldErrors: { name: ['Safe'] }, formErrors: [], password: 'secret' }))
    .toEqual({ fieldErrors: { name: ['Safe'] }, formErrors: [] });
});

it('does not start form projection after abort or rewrite a committed response', async () => {
  const container = new Container();
  const controller = new AbortController();
  controller.abort();
  const aborted = createResponse();
  const committed = createResponse();
  committed.send('owned');
  const error = HttpFormRejection.create({ fieldErrors: {}, formErrors: ['Safe'] });
  const context = { container, metadata: {}, request: createRequest('/save', 'application/vnd.fluo.form+json;v=1', 'POST') };
  await writeErrorResponse(error, { ...context, request: { ...context.request, signal: controller.signal }, response: aborted });
  await writeErrorResponse(error, { ...context, response: committed });
  expect(aborted.committed).toBe(false);
  expect(committed.body).toBe('owned');
  await container.dispose();
});

it.each(['throws', 'oversized'] as const)('retains canonical status when a safe form projection %s', async (mode) => {
  const container = new Container();
  const response = createResponse();
  const error = new BadRequestException('Rejected DTO', { details: [{ field: 'name', code: 'INVALID', message: 'Safe rejection' }] });
  const logger = { error: vi.fn() };
  await writeErrorResponse(error, {
    container, metadata: { [HTTP_FORM_VALIDATION]: error },
    request: createRequest('/save', 'application/vnd.fluo.form+json;v=1', 'POST'), response,
  }, {
    logger,
    representation: {
      html: { render: () => '<main>Rejected input</main>' },
      form: { project: () => {
        if (mode === 'throws') throw new Error('Projection unavailable');
        return { fieldErrors: { name: ['x'.repeat(257)] }, formErrors: [] };
      } },
    },
  });
  expect(response.statusCode).toBe(400);
  expect(response.headers['Content-Type']).toBe('application/json; charset=utf-8');
  expect(response.body).toMatchObject({ error: { status: 400, code: 'BAD_REQUEST' } });
  if (mode === 'throws') expect(logger.error).toHaveBeenCalledOnce();
  await container.dispose();
});
