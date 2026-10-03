import 'reflect-metadata';

import { Body, Controller, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ExpressAdapter } from '@nestjs/platform-express';
import { comparisonHeaders } from '../shared/comparison-headers';
import { readAppShape, type AppShape } from '../shared/app-shape';
import { isStageShape } from '../shared/stage-workloads';
import { resolveNestStageModule } from '../shared/nest-stages';

import { jsonCommandLocal, queryValue, readSearchLocal, restRouteMixLocal, toPreviewBody, toQuoteInput, type QuoteInput } from '../shared/workloads';

class ReadSearchQuery {
  role = '';
  status = '';
  region = '';
  sort = '';
  page = '';
  limit = '';
}

class ProjectQuery {
  include = '';
}

class TaskListQuery {
  state = '';
  priority = '';
}

class PreviewRequest {
  action = '';
  estimateHours = 0;
}

@Injectable()
class UsersReadService {
  search(tenantId: string, query: ReadSearchQuery) {
    return readSearchLocal({
      tenantId,
      role: queryValue(query.role), status: queryValue(query.status),
      region: queryValue(query.region), sort: queryValue(query.sort),
      page: queryValue(query.page), limit: queryValue(query.limit),
    });
  }
}

@Injectable()
class QuoteService {
  quote(input: QuoteInput) {
    return jsonCommandLocal(input);
  }
}

@Injectable()
class ProjectService {
  project(tenantId: string, projectId: string, query: ProjectQuery) {
    return restRouteMixLocal('project', { tenantId, projectId, include: queryValue(query.include) });
  }

  tasks(tenantId: string, projectId: string, query: TaskListQuery) {
    return restRouteMixLocal('task-list', { tenantId, projectId, state: queryValue(query.state), priority: queryValue(query.priority) });
  }

  task(tenantId: string, projectId: string, taskId: string) {
    return restRouteMixLocal('task-detail', { tenantId, projectId, taskId });
  }

  preview(tenantId: string, projectId: string, taskId: string, body: PreviewRequest) {
    return restRouteMixLocal('preview', { tenantId, projectId, taskId, body: toPreviewBody(body) });
  }

  comments(tenantId: string, projectId: string, taskId: string) {
    return restRouteMixLocal('comments', { tenantId, projectId, taskId });
  }
}

@Controller('tenants/:tenantId/users')
class ReadSearchController {
  constructor(private readonly service: UsersReadService) {}

  @Get()
  search(@Param('tenantId') tenantId: string, @Query() query: ReadSearchQuery) {
    return this.service.search(tenantId, query);
  }
}

@Controller('orders/quote')
class QuoteController {
  constructor(private readonly service: QuoteService) {}

  @Post()
  quote(@Body() input: QuoteInput) {
    return this.service.quote(toQuoteInput(input));
  }
}

@Controller('tenants/:tenantId/projects')
class ProjectController {
  constructor(private readonly service: ProjectService) {}

  @Get(':projectId')
  project(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Query() query: ProjectQuery) {
    return this.service.project(tenantId, projectId, query);
  }

  @Get(':projectId/tasks')
  tasks(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Query() query: TaskListQuery) {
    return this.service.tasks(tenantId, projectId, query);
  }

  @Get(':projectId/tasks/:taskId')
  task(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Param('taskId') taskId: string) {
    return this.service.task(tenantId, projectId, taskId);
  }

  @Post(':projectId/tasks/:taskId/preview')
  preview(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() body: PreviewRequest,
  ) {
    return this.service.preview(tenantId, projectId, taskId, body);
  }

  @Get(':projectId/tasks/:taskId/comments')
  comments(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Param('taskId') taskId: string) {
    return this.service.comments(tenantId, projectId, taskId);
  }
}

@Module({ controllers: [ReadSearchController], providers: [UsersReadService] })
class ReadSearchModule {}

@Module({ controllers: [QuoteController], providers: [QuoteService] })
class JsonCommandModule {}

@Module({ controllers: [ProjectController], providers: [ProjectService] })
class RestRouteMixModule {}

function resolveAppModule(shape: AppShape) {
  if (isStageShape(shape)) return resolveNestStageModule(shape);
  switch (shape) {
    case 'read-search-local': return ReadSearchModule;
    case 'json-command-local': return JsonCommandModule;
    case 'rest-route-mix-local': return RestRouteMixModule;
  }
}

async function main(): Promise<void> {
  const port = Number(process.env['PORT'] ?? 3002);
  const app = await NestFactory.create(
    resolveAppModule(readAppShape(process.env.BENCH_APP_SHAPE)),
    process.env['BENCH_TARGET'] === 'nestjs-express' ? new ExpressAdapter() : new FastifyAdapter(),
    { logger: false },
  );

  if (process.env.BENCH_CONFIGURATION === 'equivalent') {
    app.use((_request: unknown, response: { setHeader(name: string, value: string): void }, next: () => void) => {
      for (const [name, value] of Object.entries(comparisonHeaders('equivalent'))) response.setHeader(name, value);
      next();
    });
  }
  await app.listen(port, process.env.BENCH_BIND_HOST ?? '127.0.0.1');
  process.stdout.write(`NestJS listening on :${port}\n`);
}

main().catch((err) => {
  process.stderr.write(`[nestjs] fatal: ${String(err)}\n`);
  process.exit(1);
});
