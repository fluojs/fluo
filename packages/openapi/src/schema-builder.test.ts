import { describe, expect, it } from 'vitest';

import { IsArray, IsOptional, IsString, MinLength, ValidateNested } from '@konekti/dto-validator';
import { Controller, FromBody, Post, RequestDto, createHandlerMapping } from '@konekti/http';

import { buildOpenApiDocument } from './schema-builder.js';

describe('buildOpenApiDocument', () => {
  it('keeps nested request-body schemas stable', () => {
    class AuthorDto {
      @IsString()
      name = '';
    }

    class CreatePostRequest {
      @FromBody('title')
      @IsString()
      @MinLength(3)
      title = '';

      @FromBody('author')
      @ValidateNested(() => AuthorDto)
      author = new AuthorDto();

      @FromBody('tags')
      @IsOptional()
      @IsArray()
      @IsString({ each: true })
      tags: string[] = [];
    }

    @Controller('/posts')
    class PostsController {
      @RequestDto(CreatePostRequest)
      @Post('/')
      create() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: PostsController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Snapshot API',
      version: '1.0.0',
    });

    expect(document.components?.schemas).toMatchInlineSnapshot(`
      {
        "AuthorDto": {
          "additionalProperties": false,
          "properties": {
            "name": {
              "type": "string",
            },
          },
          "required": [
            "name",
          ],
          "type": "object",
        },
        "CreatePostRequest": {
          "additionalProperties": false,
          "properties": {
            "author": {
              "$ref": "#/components/schemas/AuthorDto",
            },
            "tags": {
              "items": {
                "type": "string",
              },
              "type": "array",
            },
            "title": {
              "minLength": 3,
              "type": "string",
            },
          },
          "required": [
            "title",
            "author",
          ],
          "type": "object",
        },
      }
    `);

    expect(document.paths['/posts']?.post?.requestBody).toMatchInlineSnapshot(`
      {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/CreatePostRequest",
            },
          },
        },
        "required": true,
      }
    `);
  });
});
