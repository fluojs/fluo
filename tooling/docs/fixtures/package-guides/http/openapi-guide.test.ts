import { OpenApiDocumentBuilder } from '@fluojs/openapi';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { OpenApiAppModule, OpenApiUsersController, UserResponseDto } from './openapi-guide-app';

/**
 * Composition fixture for the OpenAPI package guide
 * (apps/docs/content/docs/packages/openapi.mdx).
 *
 * Two seams: the served document through Test.createApp (the module registers a
 * real route at /openapi.json) and the offline OpenApiDocumentBuilder. Asserts
 * machine-consumed document structure only.
 */

interface OpenApiDocument {
  paths: Record<string, Record<string, { responses?: Record<string, unknown>; requestBody?: { content?: Record<string, unknown> } } | undefined>>;
  components?: { schemas?: Record<string, unknown> };
}

describe('package-guides openapi served document', () => {
  it('serves a 3.1 document derived from controller and DTO metadata', async () => {
    const app = await Test.createApp({ rootModule: OpenApiAppModule });
    try {
      const response = await app.request('GET', '/openapi.json').send();

      expect(response.status).toBe(200);
      const document = response.body as OpenApiDocument;
      const create = document.paths['/users']?.post;
      expect(create).toBeDefined();
      expect(create?.requestBody?.content?.['application/json']).toBeDefined();
      expect(Object.keys(create?.responses ?? {})).toEqual(expect.arrayContaining(['201', '400']));
      expect(Object.keys(document.components?.schemas ?? {})).toContain('UserResponseDto');
    } finally {
      await app.close();
    }
  });

  it('keeps the documented controller routable next to the document route', async () => {
    const app = await Test.createApp({ rootModule: OpenApiAppModule });
    try {
      const response = await app
        .request('POST', '/users')
        .body({ email: 'grace@example.com', name: 'Grace' })
        .send();

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ id: '2', email: 'grace@example.com', name: 'Grace' });
    } finally {
      await app.close();
    }
  });
});

describe('package-guides openapi offline builder', () => {
  it('builds the same document without a running server', () => {
    const document = OpenApiDocumentBuilder.build({
      title: 'Users API',
      version: '1.0.0',
      sources: [{ controllerToken: OpenApiUsersController }],
    }) as unknown as OpenApiDocument;

    expect(document.paths['/users']?.get?.responses?.['200']).toBeDefined();
    expect(document.components?.schemas?.[UserResponseDto.name]).toBeDefined();
  });
});
