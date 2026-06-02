import 'reflect-metadata';

import { Body, Controller, Get, Injectable, Module, Param, Post, Query, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

import { jsonCommandLocal, readSearchLocal, restRouteMixLocal, type QuoteInput } from '../shared/workloads';

type AppShape = 'read-search-local' | 'json-command-local' | 'rest-route-mix-local';
type NodeAdapter = 'fastify' | 'express';

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
    return readSearchLocal({ tenantId, ...query });
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
    return restRouteMixLocal('project', { tenantId, projectId, include: query.include });
  }

  tasks(tenantId: string, projectId: string, query: TaskListQuery) {
    return restRouteMixLocal('task-list', { tenantId, projectId, state: query.state, priority: query.priority });
  }

  task(tenantId: string, projectId: string, taskId: string) {
    return restRouteMixLocal('task-detail', { tenantId, projectId, taskId });
  }

  preview(tenantId: string, projectId: string, taskId: string, body: PreviewRequest) {
    return restRouteMixLocal('preview', { tenantId, projectId, taskId, body });
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
    return this.service.quote(input);
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
  switch (shape) {
    case 'read-search-local': return ReadSearchModule;
    case 'json-command-local': return JsonCommandModule;
    case 'rest-route-mix-local': return RestRouteMixModule;
  }
}

function readAppShape(): AppShape {
  const raw = process.env['BENCH_APP_SHAPE'] ?? 'read-search-local';
  if (raw === 'read-search-local' || raw === 'json-command-local' || raw === 'rest-route-mix-local') {
    return raw;
  }

  throw new Error(`Unsupported BENCH_APP_SHAPE: ${raw}`);
}

function readNodeAdapter(): NodeAdapter {
  const raw = process.env['BENCH_NODE_ADAPTER'] ?? 'fastify';
  if (raw === 'fastify' || raw === 'express') {
    return raw;
  }

  throw new Error(`Unsupported BENCH_NODE_ADAPTER: ${raw}`);
}

function createNestApplication(adapter: NodeAdapter, moduleType: Type<unknown>) {
  switch (adapter) {
    case 'fastify':
      return NestFactory.create<NestFastifyApplication>(
        moduleType,
        new FastifyAdapter(),
        { logger: false },
      );
    case 'express':
      return NestFactory.create<NestExpressApplication>(
        moduleType,
        new ExpressAdapter(),
        { logger: false },
      );
  }
}

async function main(): Promise<void> {
  const port = Number(process.env['PORT'] ?? 3002);
  const adapterName = readNodeAdapter();
  const app = await createNestApplication(adapterName, resolveAppModule(readAppShape()));

  await app.listen(port, '0.0.0.0');
  process.stdout.write(`NestJS ${adapterName} listening on :${port}\n`);
}

main().catch((err) => {
  process.stderr.write(`[nestjs] fatal: ${String(err)}\n`);
  process.exit(1);
});
