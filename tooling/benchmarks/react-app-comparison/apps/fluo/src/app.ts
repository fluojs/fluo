import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

import { Inject, Module } from '@fluojs/core';
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  FromBody,
  FromPath,
  Get,
  type Guard,
  type GuardContext,
  NotFoundException,
  Post,
  type RequestContext,
  RequestDto,
  UnauthorizedException,
  UseGuards,
} from '@fluojs/http';
import {
  createReactServerEntry,
  Path,
  type ReactInitialNavigationPage,
  ReactModule,
  ReactNavigationPage,
  Router,
} from '@fluojs/react';
import { createReactViteAssetManifest } from '@fluojs/react/vite';
import { cloneElement, createElement, isValidElement } from 'react';

import {
  authenticate,
  createCatalog,
  isEditor,
  SESSION_COOKIE,
  SESSION_VALUE,
  SONGS,
  validateProduct,
} from '../../../fixture/domain.mjs';
import { BenchmarkDocument, type PageData } from './document';

class ProductInput {
  @FromBody('name')
  name = '';
}

class LoginInput {
  @FromBody('username')
  username = '';

  @FromBody('password')
  password = '';
}

class ProductPath {
  @FromPath('sku')
  sku = '';
}

class ProductUpdate {
  @FromPath('sku')
  sku = '';

  @FromBody('name')
  name = '';
}

class AssetPath {
  @FromPath('file')
  file = '';
}

class CatalogStore {
  readonly catalog = createCatalog();
}

class EditorGuard implements Guard {
  canActivate(context: GuardContext): boolean {
    if (!editor(context.requestContext)) {
      throw new ForbiddenException('Editor access required.');
    }
    return true;
  }
}

function editor(context: RequestContext): boolean {
  const cookie = context.request.headers.cookie;
  return isEditor(Array.isArray(cookie) ? cookie.join(';') : cookie);
}

function privateResponse(context: RequestContext): void {
  context.response.setHeader('Cache-Control', 'no-store');
}

function requireEditor(context: RequestContext): void {
  privateResponse(context);
  if (!editor(context)) throw new ForbiddenException('Editor access required.');
}

function productName(name: unknown): string {
  const result = validateProduct(name);
  if (!result.ok) throw new BadRequestException(result.code);
  return result.name;
}

export function createBenchmarkModule(manifest: unknown, clientDirectory: URL) {
  const result = createReactViteAssetManifest({
    base: '/assets/',
    entries: { client: 'src/entry-client.ts', server: 'src/entry-server.ts' },
    identifierPrefix: 'benchmark-fluo-',
    manifest,
  });
  if (!result.ok) {
    throw new TypeError(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }
  const assets = result.manifest;
  const destinationFiles = [
    'src/navigation-catalog.ts',
    'src/navigation-product.ts',
    'src/navigation-jukebox.ts',
  ];
  for (const file of destinationFiles) {
    if (!assets.assetMap[file]) throw new TypeError(`Missing browser destination: ${file}`);
  }

  function page(data: PageData, context: RequestContext) {
    privateResponse(context);
    if (data.kind === 'jukebox') {
      context.response.setHeader('Content-Security-Policy', "default-src 'self'; media-src 'self' blob:");
    }
    const module = data.kind === 'catalog'
      ? './navigation-catalog.ts'
      : data.kind === 'product' ? './navigation-product.ts'
      : data.kind === 'jukebox' ? './navigation-jukebox.ts' : './navigation-catalog.ts';
    return ReactNavigationPage.create(
      createElement(BenchmarkDocument, {
        data,
        editor: editor(context),
        routeParams: context.request.params,
        routeUrl: context.request.url,
        navigationBuildId: assets.buildId,
        stylesheets: assets.css,
      }),
      { module, props: { data, editor: editor(context) } },
    );
  }

  @Inject(CatalogStore)
  @Router('/')
  class CatalogPages {
    constructor(private readonly store: CatalogStore) {}

    @Path('/')
    index(_input: undefined, context: RequestContext) {
      return page({ kind: 'catalog', title: 'Product catalog', products: this.store.catalog.list() }, context);
    }

    @Path('/products')
    products(_input: undefined, context: RequestContext) {
      return this.index(undefined, context);
    }

    @Path('/products/:sku')
    @RequestDto(ProductPath)
    detail(input: ProductPath, context: RequestContext) {
      const product = this.store.catalog.detail(input.sku);
      if (!product) throw new NotFoundException('Product not found.');
      return page({ kind: 'product', product }, context);
    }

    @Path('/login')
    login(_input: undefined, context: RequestContext) {
      return page({ kind: 'login' }, context);
    }

    @Path('/jukebox/songs')
    songs(_input: undefined, context: RequestContext) {
      return page({ kind: 'jukebox', view: 'songs', songs: SONGS }, context);
    }

    @Path('/jukebox/qr')
    qr(_input: undefined, context: RequestContext) {
      return page({ kind: 'jukebox', view: 'qr', songs: SONGS }, context);
    }

    @Path('/jukebox/queue')
    queue(_input: undefined, context: RequestContext) {
      return page({ kind: 'jukebox', view: 'queue', songs: SONGS }, context);
    }
  }

  @Inject(CatalogStore)
  @Router('/admin')
  class AdminPages {
    constructor(private readonly store: CatalogStore) {}

    @Path('/products')
    @UseGuards(EditorGuard)
    list(_input: undefined, context: RequestContext) {
      return page({ kind: 'admin', products: this.store.catalog.list() }, context);
    }
  }

  @Inject(CatalogStore)
  @Controller('/')
  class CatalogActions {
    constructor(private readonly store: CatalogStore) {}

    @Post('/login')
    @RequestDto(LoginInput)
    login(input: LoginInput, context: RequestContext) {
      privateResponse(context);
      if (!authenticate(input.username, input.password)) {
        throw new UnauthorizedException('Invalid credentials.');
      }
      context.response.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${SESSION_VALUE}; Path=/; HttpOnly; SameSite=Lax`,
      );
      context.response.redirect(303, '/admin/products');
    }

    @Post('/logout')
    logout(_input: undefined, context: RequestContext) {
      privateResponse(context);
      context.response.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      );
      context.response.redirect(303, '/products');
    }

    @Post('/products')
    @RequestDto(ProductInput)
    @UseGuards(EditorGuard)
    create(input: ProductInput, context: RequestContext) {
      requireEditor(context);
      const created = this.store.catalog.create(productName(input.name));
      context.response.redirect(303, `/products/${encodeURIComponent(created.sku)}`);
    }

    @Post('/products/:sku')
    @RequestDto(ProductUpdate)
    @UseGuards(EditorGuard)
    update(input: ProductUpdate, context: RequestContext) {
      requireEditor(context);
      const name = productName(input.name);
      if (!this.store.catalog.update(input.sku, name)) {
        throw new NotFoundException('Product not found.');
      }
      context.response.redirect(303, `/products/${encodeURIComponent(input.sku)}`);
    }

    @Post('/products/:sku/delete')
    @RequestDto(ProductPath)
    @UseGuards(EditorGuard)
    remove(input: ProductPath, context: RequestContext) {
      requireEditor(context);
      if (!this.store.catalog.delete(input.sku)) {
        throw new NotFoundException('Product not found.');
      }
      context.response.redirect(303, '/');
    }
  }

  @Controller('/assets')
  class Assets {
    readonly #gzipAssets = new Map<string, { readonly body: Buffer; readonly compressed: Buffer }>();

    @Get('/:file')
    @RequestDto(AssetPath)
    async serve(input: AssetPath, context: RequestContext) {
      if (!/^[a-zA-Z0-9._-]+\.(?:js|css)$/u.test(input.file)) {
        throw new NotFoundException('Asset not found.');
      }
      try {
        const body = await readFile(new URL(input.file, clientDirectory));
        context.response.setHeader(
          'Content-Type',
          input.file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
        );
        context.response.setHeader('Vary', 'Accept-Encoding');
        const accepted = context.request.headers['accept-encoding'];
        if (typeof accepted === 'string' && /\bgzip\b/u.test(accepted)) {
          let asset = this.#gzipAssets.get(input.file);
          if (!asset?.body.equals(body)) {
            asset = { body, compressed: gzipSync(body) };
            this.#gzipAssets.set(input.file, asset);
          }
          context.response.setHeader('Content-Encoding', 'gzip');
          return Buffer.from(asset.compressed);
        }
        return body;
      } catch (error) {
        this.#gzipAssets.delete(input.file);
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          throw new NotFoundException('Asset not found.', { cause: error });
        }
        throw error;
      }
    }
  }

  @Module({
    controllers: [Assets],
    imports: [
      ReactModule.forRoot({
        navigationBuildId: assets.buildId,
        controllers: [CatalogPages, AdminPages, CatalogActions],
        providers: [CatalogStore, EditorGuard],
        renderPage: (element, _context, _policies, initialPage) => {
          if (!isValidElement<{ readonly initialPage?: ReactInitialNavigationPage }>(element)
            || element.type !== BenchmarkDocument) {
            throw new TypeError('The benchmark page must render with BenchmarkDocument.');
          }
          return createReactServerEntry(cloneElement(element, { initialPage }), assets.hydrationOptions);
        },
      }),
    ],
  })
  class BenchmarkModule {}

  return BenchmarkModule;
}
