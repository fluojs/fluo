import { FromBody, FromPath, Post, RequestDto, UseGuards, UseInterceptors, ForbiddenException, Optional,
  UnauthorizedException, NotFoundException, type GuardContext, type InterceptorContext, type CallHandler,
  type HttpErrorRepresentationOptions, type RequestContext } from '@fluojs/http';
import type { MiddlewareContext, Next } from '@fluojs/http';
import { PageMetadata, Path, Router, ReactModule } from '@fluojs/react';
import { IsString, MinLength } from '@fluojs/validation';
import type { CatalogPageProps } from './catalog-page';

export type CatalogObservation = {
  readonly phase: 'middleware' | 'guard' | 'interceptor' | 'dto' | 'handler' | 'commit' | 'cleanup';
  readonly scope: string;
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly matched: string;
  readonly name?: string;
  readonly intent?: string;
  readonly tag?: readonly string[];
  readonly dto?: boolean;
};
export type CatalogControl = (event: CatalogObservation, context: RequestContext) => void | Promise<void>;

class CatalogWrite {
  @Optional()
  @FromBody('tag')
  tag?: string[];
  @FromBody('csrf')
  csrf = '';
  @Optional()
  @FromBody('intent')
  intent?: string;
  @FromBody('display_name')
  @IsString()
  @MinLength(3)
  name = '';
}
class CatalogUpdate {
  @Optional()
  @FromBody('tag')
  tag?: string[];
  @FromBody('csrf')
  csrf = '';
  @Optional()
  @FromBody('intent')
  intent?: string;
  @FromBody('display_name')
  @IsString()
  @MinLength(3)
  name = '';
  @FromPath('sku')
  sku = '';
}
class CatalogDelete {
  @FromBody('csrf')
  csrf = '';
  @Optional()
  @FromBody('intent')
  intent?: string;
  @FromPath('sku')
  sku = '';
}

export function createCatalogRouter(
  render: (props: CatalogPageProps, context: RequestContext) => unknown,
  control?: CatalogControl,
) {
  const products = new Map([['sku-42', 'Seeded product']]);
  let sequence = 0;
  const matchedKey = Symbol('catalog.matched-handler');
  const event = (context: RequestContext, phase: CatalogObservation['phase'], scope: string,
    extra: Pick<CatalogObservation, 'name' | 'intent' | 'tag' | 'dto'> = {}): CatalogObservation => ({
    phase, scope, requestId: context.requestId ?? scope, method: context.request.method,
    path: context.request.path, matched: typeof context.metadata[matchedKey] === 'string'
      ? String(context.metadata[matchedKey]) : '', ...extra,
  });
  class CatalogProbe {
    readonly id = crypto.randomUUID();
    context?: RequestContext;
    async onDestroy(): Promise<void> {
      if (this.context !== undefined) await control?.(event(this.context, 'cleanup', this.id), this.context);
    }
  }
  const observe = async (context: RequestContext, phase: CatalogObservation['phase'],
    extra: Pick<CatalogObservation, 'name' | 'intent' | 'tag' | 'dto'> = {}): Promise<string> => {
    const probe = await context.container.resolve(CatalogProbe);
    probe.context = context;
    await control?.(event(context, phase, probe.id, extra), context);
    return probe.id;
  };
  class CatalogMiddleware {
    async handle({ requestContext }: MiddlewareContext, next: Next): Promise<void> {
      const id = await observe(requestContext, 'middleware');
      requestContext.response.setHeader('X-Catalog-Scope', id);
      await next();
    }
  }
  class CatalogGuard {
    async canActivate({ requestContext, handler }: GuardContext): Promise<boolean> {
      requestContext.metadata[matchedKey] = handler.methodName;
      await observe(requestContext, 'guard');
      const { request } = requestContext;
      if (request.cookies.editor !== 'yes') throw new UnauthorizedException('An editor session is required.');
      const host = request.headers.host;
      if (typeof host !== 'string' || request.headers.origin !== `http://${host}`) throw new ForbiddenException('Origin rejected.');
      const body = request.body;
      if (typeof body !== 'object' || body === null || Reflect.get(body, 'csrf') !== request.cookies.csrf
        || request.cookies.csrf !== 'catalog-demo-token') throw new ForbiddenException('CSRF rejected.');
      return true;
    }
  }
  class CatalogInterceptor {
    readonly id = crypto.randomUUID();
    async intercept(context: InterceptorContext, next: CallHandler): Promise<unknown> {
      context.requestContext.metadata[matchedKey] = context.handler.methodName;
      await observe(context.requestContext, 'interceptor');
      context.requestContext.response.setHeader('X-Catalog-Interceptor', 'approved');
      context.requestContext.response.setHeader('X-Catalog-Request-Scope', this.id);
      return next.handle();
    }
  }
  const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  @Router('/catalog')
  class CatalogRouter {
    @Path('/login')
    login(_input: undefined, context: RequestContext): void {
      context.response.setHeader('Set-Cookie', [
        'editor=yes; Path=/; HttpOnly; SameSite=Lax',
        'csrf=catalog-demo-token; Path=/; SameSite=Lax',
      ]);
      context.response.redirect(303, '/catalog');
    }
    @Path('/')
    list(_input: undefined, context: RequestContext) {
      return render({ products: Array.from(products, ([sku, name]) => ({ sku, name })) }, context);
    }
    @PageMetadata(({ request }) => ({
      title: `Catalog: ${products.get(request.params.sku ?? '') ?? 'Product'}`,
      links: [{ rel: 'canonical', href: request.url }],
    }))
    @Path('/:sku')
    detail(_input: undefined, context: RequestContext) {
      const sku = context.request.params.sku ?? '';
      const name = products.get(sku);
      if (name === undefined) throw new NotFoundException('Product not found.');
      return render({ products: [{ sku, name }], selected: sku }, context);
    }
    @Post('/create')
    @RequestDto(CatalogWrite)
    @UseGuards(CatalogGuard)
    @UseInterceptors(CatalogInterceptor)
    async create(input: CatalogWrite, context: RequestContext) {
      const extra = { name: input.name, intent: input.intent, tag: input.tag, dto: input instanceof CatalogWrite };
      const scope = await observe(context, 'dto', extra);
      await observe(context, 'handler', extra);
      const sku = `item-${++sequence}`;
      products.set(sku, input.name);
      await control?.(event(context, 'commit', scope, extra), context);
      return ReactModule.formResult({ destination: `/catalog/${sku}`, followUp: 'navigate' });
    }
    @Post('/:sku/update')
    @RequestDto(CatalogUpdate)
    @UseGuards(CatalogGuard)
    @UseInterceptors(CatalogInterceptor)
    async update(input: CatalogUpdate, context: RequestContext) {
      const extra = { name: input.name, intent: input.intent, tag: input.tag, dto: input instanceof CatalogUpdate };
      const scope = await observe(context, 'dto', extra);
      await observe(context, 'handler', extra);
      if (!products.has(input.sku)) throw new NotFoundException('Product not found.');
      products.set(input.sku, input.name);
      await control?.(event(context, 'commit', scope, extra), context);
      return ReactModule.formResult({ destination: `/catalog/${input.sku}`, followUp: 'refresh' });
    }
    @Post('/:sku/delete')
    @RequestDto(CatalogDelete)
    @UseGuards(CatalogGuard)
    @UseInterceptors(CatalogInterceptor)
    async delete(input: CatalogDelete, context: RequestContext) {
      const scope = await observe(context, 'dto', { intent: input.intent, dto: input instanceof CatalogDelete });
      await observe(context, 'handler', { intent: input.intent });
      products.delete(input.sku);
      await control?.(event(context, 'commit', scope, { intent: input.intent }), context);
      return ReactModule.formResult({ destination: '/catalog', followUp: 'navigate' });
    }
  }
  const errorRepresentation: HttpErrorRepresentationOptions = {
    form: { project: () => ({ fieldErrors: { name: ['Use at least three characters.'] }, formErrors: [] }) },
    html: {
      canRender: ({ handler }) => handler?.controllerToken === CatalogRouter,
      render: ({ validationOrigin, request, error }) => {
        const name: unknown = typeof request.body === 'object' && request.body !== null
          ? Reflect.get(request.body, 'display_name') : undefined;
        const value = typeof name === 'string' ? escape(name.slice(0, 256)) : '';
        // Only the authored display name is retained; tokens and exceptions are not reflected.
        return '<!doctype html><html lang="en"><head><title>Catalog submission</title></head><body><main>'
          + (validationOrigin === undefined
            ? `<h1>Submission refused (${error.status})</h1><a href="/catalog/login">Sign in as demo editor</a>`
            : `<h1>Correct product input</h1><form method="post" action="${escape(request.path)}" enctype="application/x-www-form-urlencoded">`
              + `<label for="correct-name">Product name</label><input id="correct-name" name="display_name" value="${value}" minlength="3" required aria-describedby="name-errors">`
              + '<p id="name-errors">Use at least three characters.</p><input type="hidden" name="csrf" value="catalog-demo-token"><button>Save product</button></form>')
          + '<a href="/catalog">Catalog</a></main></body></html>';
      },
    },
  };
  return { router: CatalogRouter, middleware: [CatalogMiddleware], providers: [
    CatalogGuard, CatalogMiddleware,
    { provide: CatalogProbe, useClass: CatalogProbe, scope: 'request' as const },
    { provide: CatalogInterceptor, useClass: CatalogInterceptor, scope: 'request' as const },
  ], errorRepresentation };
}
