import { describe, expect, it } from 'vitest';

import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTag, getControllerTags, getMethodApiMetadata } from './decorators.js';

describe('OpenAPI decorator metadata readers', () => {
  it('returns defensive copies and preserves write-time snapshots', () => {
    const responseSchema: Record<string, unknown> = {
      properties: {
        id: { type: 'string' },
      },
      type: 'object',
    };

    @ApiTag('users')
    class UsersController {
      @ApiOperation({ summary: 'List users' })
      @ApiBearerAuth()
      @ApiResponse(200, { description: 'OK', schema: responseSchema })
      list() {
        return [{ id: '1' }];
      }
    }

    responseSchema.type = 'array';
    responseSchema.properties = {
      id: { type: 'number' },
    };

    const firstTags = getControllerTags(UsersController);
    expect(firstTags).toEqual(['users']);

    if (!firstTags) {
      throw new Error('Expected controller tags to be present.');
    }

    firstTags.push('mutated');
    expect(getControllerTags(UsersController)).toEqual(['users']);

    const firstMeta = getMethodApiMetadata(UsersController, 'list');

    if (!firstMeta) {
      throw new Error('Expected method metadata to be present.');
    }

    expect(firstMeta.responses[0]?.schema).toEqual({
      properties: {
        id: { type: 'string' },
      },
      type: 'object',
    });

    firstMeta.operation = { summary: 'Mutated summary' };
    firstMeta.responses[0] = {
      ...firstMeta.responses[0],
      description: 'Mutated description',
      schema: { type: 'boolean' },
      status: 500,
    };

    if (firstMeta.security) {
      firstMeta.security.push('mutatedSecurity');
    }

    const secondMeta = getMethodApiMetadata(UsersController, 'list');

    expect(secondMeta).toEqual({
      operation: { summary: 'List users' },
      responses: [
        {
          description: 'OK',
          schema: {
            properties: {
              id: { type: 'string' },
            },
            type: 'object',
          },
          status: 200,
          type: undefined,
        },
      ],
      security: ['bearerAuth'],
    });
  });
});
