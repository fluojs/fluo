import { ensureMetadataSymbol, Inject, Module } from '@fluojs/core';
import { Controller, Get, Post, type RequestContext } from '@fluojs/http';
import { createFastifyAdapter } from '@fluojs/platform-fastify';
import { FluoFactory } from '@fluojs/runtime';

import { jsonCommandLocal, QUOTE_REQUEST, readSearchLocal, restRouteMixLocal, type QuoteInput, type QuoteItem } from '../shared/workloads.js';

ensureMetadataSymbol();

type AppShape = 'read-search-local' | 'json-command-local' | 'rest-route-mix-local';

class UsersReadService {
  search(context: RequestContext) {
    return readSearchLocal({
      tenantId: param(context, 'tenantId'),
      role: query(context, 'role'),
      status: query(context, 'status'),
      region: query(context, 'region'),
      sort: query(context, 'sort'),
      page: query(context, 'page'),
      limit: query(context, 'limit'),
    });
  }
}

class QuoteService {
  quote(input: QuoteInput) {
    return jsonCommandLocal(input);
  }
}

class ProjectService {
  project(context: RequestContext) {
    return restRouteMixLocal('project', { tenantId: param(context, 'tenantId'), projectId: param(context, 'projectId'), include: query(context, 'include') });
  }
  tasks(context: RequestContext) {
    return restRouteMixLocal('task-list', { tenantId: param(context, 'tenantId'), projectId: param(context, 'projectId'), state: query(context, 'state'), priority: query(context, 'priority') });
  }
  task(context: RequestContext) {
    return restRouteMixLocal('task-detail', { tenantId: param(context, 'tenantId'), projectId: param(context, 'projectId'), taskId: param(context, 'taskId') });
  }
  preview(context: RequestContext) {
    return restRouteMixLocal('preview', { tenantId: param(context, 'tenantId'), projectId: param(context, 'projectId'), taskId: param(context, 'taskId'), body: toPreviewBody(context.request.body) });
  }
  comments(context: RequestContext) {
    return restRouteMixLocal('comments', { tenantId: param(context, 'tenantId'), projectId: param(context, 'projectId'), taskId: param(context, 'taskId') });
  }
}

@Inject(UsersReadService)
@Controller('/tenants/:tenantId/users')
class ReadSearchController {
  constructor(private readonly service: UsersReadService) {}

  @Get('/')
  search(_input: undefined, context: RequestContext) {
    return this.service.search(context);
  }
}

@Inject(QuoteService)
@Controller('/orders/quote')
class QuoteController {
  constructor(private readonly service: QuoteService) {}

  @Post('/')
  quote(_input: undefined, context: RequestContext) {
    return this.service.quote(toQuoteInput(context.request.body));
  }
}

@Inject(ProjectService)
@Controller('/tenants/:tenantId/projects')
class ProjectController {
  constructor(private readonly service: ProjectService) {}

  @Get('/:projectId')
  project(_input: undefined, context: RequestContext) { return this.service.project(context); }
  @Get('/:projectId/tasks')
  tasks(_input: undefined, context: RequestContext) { return this.service.tasks(context); }
  @Get('/:projectId/tasks/:taskId')
  task(_input: undefined, context: RequestContext) { return this.service.task(context); }
  @Post('/:projectId/tasks/:taskId/preview')
  preview(_input: undefined, context: RequestContext) { return this.service.preview(context); }
  @Get('/:projectId/tasks/:taskId/comments')
  comments(_input: undefined, context: RequestContext) { return this.service.comments(context); }
}

function param(context: RequestContext, name: string): string {
  return context.request.params[name] ?? '';
}

function query(context: RequestContext, name: string): string {
  const value = context.request.query[name];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toQuoteInput(value: unknown): QuoteInput {
  if (!isRecord(value)) return QUOTE_REQUEST;
  const itemsValue = value.items;
  const items: QuoteItem[] = Array.isArray(itemsValue)
    ? itemsValue.filter(isRecord).map((item) => ({
        sku: typeof item.sku === 'string' ? item.sku : '',
        quantity: typeof item.quantity === 'number' ? item.quantity : 0,
        unitPriceCents: typeof item.unitPriceCents === 'number' ? item.unitPriceCents : 0,
      }))
    : [];
  return {
    customerId: typeof value.customerId === 'string' ? value.customerId : '',
    coupon: typeof value.coupon === 'string' ? value.coupon : '',
    shippingRegion: typeof value.shippingRegion === 'string' ? value.shippingRegion : '',
    items,
  };
}

function toPreviewBody(value: unknown): { action: string; estimateHours: number } {
  if (!isRecord(value)) return { action: '', estimateHours: 0 };
  return {
    action: typeof value.action === 'string' ? value.action : '',
    estimateHours: typeof value.estimateHours === 'number' ? value.estimateHours : 0,
  };
}

@Module({ controllers: [ReadSearchController], providers: [UsersReadService] })
class ReadSearchModule {}
@Module({ controllers: [QuoteController], providers: [QuoteService] })
class JsonCommandModule {}
@Module({ controllers: [ProjectController], providers: [ProjectService] })
class RestRouteMixModule {}

function resolveAppModule(shape: AppShape) {
  switch (shape) {
    case 'read-search-local': return ReadSearchModule;
    case 'json-command-local': return JsonCommandModule;
    case 'rest-route-mix-local': return RestRouteMixModule;
  }
}

function readAppShape(): AppShape {
  const raw = process.env['BENCH_APP_SHAPE'] ?? 'read-search-local';
  if (raw === 'read-search-local' || raw === 'json-command-local' || raw === 'rest-route-mix-local') return raw;
  throw new Error(`Unsupported BENCH_APP_SHAPE: ${raw}`);
}

async function main(): Promise<void> {
  const port = Number(process.env['PORT'] ?? 3001);
  const app = await FluoFactory.create(resolveAppModule(readAppShape()), {
    adapter: createFastifyAdapter({ port }),
    logger: { debug() {}, error() {}, log() {}, warn() {} },
  });

  await app.listen();
  process.stdout.write(`fluo listening on :${port}\n`);
}

main().catch((err) => {
  process.stderr.write(`[fluo] fatal: ${String(err)}\n`);
  process.exit(1);
});
