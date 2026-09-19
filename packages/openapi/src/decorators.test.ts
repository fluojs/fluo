import { describe, expect, it } from 'vitest';

import {
  ApiBearerAuth,
  ApiBody,
  ApiCookie,
  ApiExcludeEndpoint,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTag,
  getControllerTags,
  getMethodApiMetadata,
} from './decorators.js';
import type { OpenApiSchemaObject } from './schema-builder.js';

describe('OpenAPI decorator metadata readers', () => {
  it('returns defensive copies and preserves write-time snapshots', () => {
    const responseSchema: OpenApiSchemaObject = {
      allOf: [
        {
          properties: {
            id: { type: 'string' },
          },
          type: 'object',
        },
      ],
      discriminator: {
        propertyName: 'kind',
      },
    };

    @ApiTag('users')
    class UsersController {
      @ApiOperation({ deprecated: true, summary: 'List users' })
      @ApiParam('id', { description: 'User identifier', schema: { type: 'integer' } })
      @ApiQuery('expand', { schema: { enum: ['profile'], type: 'string' } })
      @ApiHeader('x-request-id', { required: true, schema: { type: 'string' } })
      @ApiCookie('session', { schema: { type: 'string' } })
      @ApiBody({
        content: {
          'application/json': {
            schema: {
              oneOf: [
                {
                  properties: { name: { type: 'string' } },
                  type: 'object',
                },
                {
                  properties: { email: { format: 'email', type: 'string' } },
                  type: 'object',
                },
              ],
            },
          },
        },
        description: 'Explicit body',
        required: true,
      })
      @ApiBearerAuth()
      @ApiSecurity('oauth2Auth', ['read:users'])
      @ApiExcludeEndpoint()
      @ApiResponse({ status: 200, description: 'OK', schema: responseSchema })
      list() {
        return [{ id: '1' }];
      }
    }

    responseSchema.allOf = [{ type: 'array' }];
    responseSchema.discriminator = { propertyName: 'mutatedKind' };

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
      allOf: [
        {
          properties: {
            id: { type: 'string' },
          },
          type: 'object',
        },
      ],
      discriminator: {
        propertyName: 'kind',
      },
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

    if (firstMeta.securityRequirements) {
      firstMeta.securityRequirements.push({ apiKeyAuth: [] });
    }

    if (firstMeta.parameters) {
      firstMeta.parameters[0] = {
        ...firstMeta.parameters[0],
        name: 'mutated',
      };
    }

    firstMeta.requestBody = {
      content: {
        'application/json': {
          schema: {
            type: 'string',
          },
        },
      },
    };

    const secondMeta = getMethodApiMetadata(UsersController, 'list');

    expect(secondMeta).toEqual(
      expect.objectContaining({
        excludeEndpoint: true,
        operation: { deprecated: true, description: undefined, summary: 'List users' },
        responses: [
          {
            description: 'OK',
            schema: {
              allOf: [
                {
                  properties: {
                    id: { type: 'string' },
                  },
                  type: 'object',
                },
              ],
              discriminator: {
                propertyName: 'kind',
              },
            },
            status: 200,
            type: undefined,
          },
        ],
        security: ['oauth2Auth', 'bearerAuth'],
        securityRequirements: [{ oauth2Auth: ['read:users'] }, { bearerAuth: [] }],
        requestBody: {
          description: 'Explicit body',
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  {
                    properties: {
                      name: {
                        type: 'string',
                      },
                    },
                    type: 'object',
                  },
                  {
                    properties: {
                      email: {
                        format: 'email',
                        type: 'string',
                      },
                    },
                    type: 'object',
                  },
                ],
              },
            },
          },
        },
      }),
    );

    expect(secondMeta?.parameters).toEqual(
      expect.arrayContaining([
        {
          description: 'User identifier',
          in: 'path',
          name: 'id',
          required: true,
          schema: { type: 'integer' },
        },
        {
          description: undefined,
          in: 'query',
          name: 'expand',
          required: undefined,
          schema: { enum: ['profile'], type: 'string' },
        },
        {
          description: undefined,
          in: 'header',
          name: 'x-request-id',
          required: true,
          schema: { type: 'string' },
        },
        {
          description: undefined,
          in: 'cookie',
          name: 'session',
          required: undefined,
          schema: { type: 'string' },
        },
      ]),
    );
  });
});
