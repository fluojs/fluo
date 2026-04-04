import { describe, expect, it } from 'vitest';

import * as openApiPublicApi from './index.js';

describe('@konekti/openapi public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(openApiPublicApi).toHaveProperty('ApiTag');
    expect(openApiPublicApi).toHaveProperty('ApiOperation');
    expect(openApiPublicApi).toHaveProperty('ApiResponse');
    expect(openApiPublicApi).toHaveProperty('OpenApiModule');
    expect(openApiPublicApi).toHaveProperty('OpenApiHandlerRegistry');
    expect(openApiPublicApi).toHaveProperty('buildOpenApiDocument');
    expect(openApiPublicApi).toHaveProperty('getControllerTags');
    expect(openApiPublicApi).toHaveProperty('getMethodApiMetadata');
  });
});
