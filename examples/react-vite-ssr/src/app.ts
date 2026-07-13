import { readFile } from 'node:fs/promises';

import { Module } from '@fluojs/core';
import {
  Controller,
  FromPath,
  FromQuery,
  Get,
  NotFoundException,
  Optional,
  RequestDto,
  type RequestContext,
} from '@fluojs/http';
import { Path, ReactModule, Router, createReactServerEntry } from '@fluojs/react';
import { createReactViteAssetManifest } from '@fluojs/react/vite';
import { IsIn, IsString, MinLength } from '@fluojs/validation';
import { createElement } from 'react';

import { REACT_IDENTIFIER_PREFIX } from './hydration';
import { ProductDocument } from './page';

const ASSET_FILE_PATTERN = /^[a-zA-Z0-9._-]+\.(?:css|js)$/u;

export type ReactViteExampleModuleOptions = {
  readonly clientDirectory: URL;
  readonly manifest: unknown;
};

class ReactViteExampleManifestError extends Error {
  readonly name = 'ReactViteExampleManifestError';
}

class ProductPageRequest {
  @MinLength(3)
  @IsString()
  @FromPath('sku')
  sku = '';

  @IsIn(['true', 'false'])
  @Optional()
  @FromQuery('preview')
  preview?: string;
}

class AssetRequest {
  @FromPath('file')
  file = '';
}

export function createReactViteExampleModule(options: ReactViteExampleModuleOptions) {
  const result = createReactViteAssetManifest({
    base: '/assets/',
    entries: {
      client: 'src/entry-client.ts',
      server: 'src/entry-server.ts',
    },
    identifierPrefix: REACT_IDENTIFIER_PREFIX,
    manifest: options.manifest,
  });

  if (!result.ok) {
    throw new ReactViteExampleManifestError(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }

  const assets = result.manifest;

  @Router('/products')
  class ProductPageRouter {
    @Path('/:sku')
    @RequestDto(ProductPageRequest)
    show(input: ProductPageRequest, context: RequestContext) {
      return createReactServerEntry(
        createElement(ProductDocument, {
          preview: input.preview === 'true',
          routeParams: context.request.params,
          routeUrl: context.request.url,
          sku: input.sku,
          stylesheets: assets.css,
        }),
        assets.hydrationOptions,
      );
    }
  }

  @Controller('/assets')
  class ViteAssetController {
    @Get('/:file')
    @RequestDto(AssetRequest)
    async serve(input: AssetRequest, context: RequestContext) {
      if (!ASSET_FILE_PATTERN.test(input.file)) {
        throw new NotFoundException('Vite asset not found.');
      }

      try {
        const body = await readFile(new URL(input.file, options.clientDirectory));
        context.response.setHeader(
          'Content-Type',
          input.file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
        );
        return body;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          throw new NotFoundException('Vite asset not found.', { cause: error });
        }
        throw error;
      }
    }
  }

  @Module({
    controllers: [ViteAssetController],
    imports: [ReactModule.forRoot({ controllers: [ProductPageRouter] })],
  })
  class ReactViteExampleModule {}

  return ReactViteExampleModule;
}
