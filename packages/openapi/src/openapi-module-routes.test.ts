import {
  type FrameworkRequest,
  type FrameworkResponse,
  RouteConflictError,
} from '@fluojs/http';
import { bootstrapApplication, defineModule, type ModuleType } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { OpenApiModule } from './openapi-module.js';

type TestFrameworkResponse = FrameworkResponse & { body?: unknown };

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): TestFrameworkResponse {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('location', location);
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

async function captureBootstrapError(imports: readonly ModuleType[]): Promise<unknown> {
  class AppModule {}

  defineModule(AppModule, { imports: [...imports] });

  try {
    const app = await bootstrapApplication({ rootModule: AppModule });
    await app.close();
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

describe('OpenApiModule routes', () => {
  it('keeps the default JSON and Swagger UI routes unchanged', async () => {
    // Given
    class AppModule {}

    defineModule(AppModule, {
      imports: [
        OpenApiModule.forRoot({
          title: 'Default API',
          ui: true,
          version: '1.0.0',
        }),
      ],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const documentResponse = createResponse();
      const uiResponse = createResponse();

      // When
      await app.dispatch(createRequest('/openapi.json'), documentResponse);
      await app.dispatch(createRequest('/docs'), uiResponse);

      // Then
      expect(documentResponse.statusCode).toBe(200);
      expect(documentResponse.body).toMatchObject({
        info: { title: 'Default API', version: '1.0.0' },
      });
      expect(uiResponse.statusCode).toBe(200);
      expect(uiResponse.body).toEqual(expect.stringContaining('/openapi.json'));
    } finally {
      await app.close();
    }
  });

  it('serves multiple documents and UIs at distinct configured routes', async () => {
    // Given
    const publicOpenApiModule = OpenApiModule.forRoot({
      documentPath: '/openapi/public-$&.json',
      title: 'Public API',
      ui: true,
      uiPath: '/docs/public',
      version: '1.0.0',
    });
    const adminOpenApiModule = OpenApiModule.forRootAsync({
      documentPath: '/openapi/admin.json',
      uiPath: '/docs/admin',
      useFactory: async () => ({
        title: 'Admin API',
        ui: true,
        version: '2.0.0',
      }),
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [publicOpenApiModule, adminOpenApiModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const publicDocumentResponse = createResponse();
      const publicUiResponse = createResponse();
      const adminDocumentResponse = createResponse();
      const adminUiResponse = createResponse();

      // When
      await app.dispatch(createRequest('/openapi/public-$&.json'), publicDocumentResponse);
      await app.dispatch(createRequest('/docs/public'), publicUiResponse);
      await app.dispatch(createRequest('/openapi/admin.json'), adminDocumentResponse);
      await app.dispatch(createRequest('/docs/admin'), adminUiResponse);

      // Then
      expect(publicDocumentResponse.body).toMatchObject({
        info: { title: 'Public API', version: '1.0.0' },
      });
      expect(adminDocumentResponse.body).toMatchObject({
        info: { title: 'Admin API', version: '2.0.0' },
      });
      expect(publicUiResponse.body).toEqual(expect.stringContaining('() => "/openapi/public-$\\u0026.json"'));
      expect(publicUiResponse.body).not.toEqual(expect.stringContaining('/openapi/admin.json'));
      expect(adminUiResponse.body).toEqual(expect.stringContaining('/openapi/admin.json'));
      expect(adminUiResponse.body).not.toEqual(expect.stringContaining('/openapi/public-$'));
    } finally {
      await app.close();
    }
  });

  it('fails bootstrap when one module normalizes its JSON and UI paths to the same route', async () => {
    // Given
    const openApiModule = OpenApiModule.forRoot({
      documentPath: '/reference',
      title: 'Colliding API',
      ui: true,
      uiPath: '//reference/',
      version: '1.0.0',
    });

    // When
    const error = await captureBootstrapError([openApiModule]);

    // Then
    expect(error).toBeInstanceOf(RouteConflictError);
    expect(error).toMatchObject({
      message: 'Duplicate route registration detected for GET:/reference:<none>.',
    });
  });

  it('fails bootstrap when separate module instances normalize to the same GET route', async () => {
    // Given
    const publicOpenApiModule = OpenApiModule.forRoot({
      documentPath: '/openapi/shared.json',
      title: 'Public API',
      uiPath: '/docs/public',
      version: '1.0.0',
    });
    const adminOpenApiModule = OpenApiModule.forRoot({
      documentPath: '//openapi//shared.json/',
      title: 'Admin API',
      uiPath: '/docs/admin',
      version: '1.0.0',
    });

    // When
    const error = await captureBootstrapError([publicOpenApiModule, adminOpenApiModule]);

    // Then
    expect(error).toBeInstanceOf(RouteConflictError);
    expect(error).toMatchObject({
      message: 'Duplicate route registration detected for GET:/openapi/shared.json:<none>.',
    });
  });
});
