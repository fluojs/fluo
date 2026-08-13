import { All, Controller, createHandlerMapping } from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import { ApiExcludeEndpoint } from './decorators.js';
import { buildOpenApiDocument } from './schema-builder.js';

describe('OpenAPI Path Item exclusion', () => {
  it('omits excluded ALL descriptors before validating their operation method', () => {
    // Given
    @Controller('/fallback')
    class FallbackController {
      @ApiExcludeEndpoint()
      @All('/') handle() { return undefined; }
    }
    const descriptors = createHandlerMapping([{ controllerToken: FallbackController }]).descriptors;

    // When
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Excluded Path Item API',
      version: '1.0.0',
    });

    // Then
    expect(document.paths).toEqual({});
  });
});
