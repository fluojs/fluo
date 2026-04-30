import 'reflect-metadata';

import { Body, Controller, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

type AppShape = 'baseline' | 'dto-1' | 'dto-20' | 'direct-1' | 'direct-20' | 'query-1' | 'body-1';

@Injectable()
class UsersRepository {
  findOne(id: string): { id: string; name: string; email: string } {
    return { id, name: 'Alice', email: 'alice@example.com' };
  }
}

@Injectable()
class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  getUser(id: string): { id: string; name: string; email: string } {
    return this.repo.findOne(id);
  }

  searchUsers(input: SearchUsersRequest) {
    return {
      limit: input.limit,
      page: input.page,
      region: input.region,
      role: input.role,
      sort: input.sort,
      term: input.term,
    };
  }

  createUser(input: CreateUserRequest) {
    return {
      email: input.email,
      name: input.name,
      role: input.role,
      status: input.status,
      team: input.team,
      title: input.title,
    };
  }
}

class GetUserRequest {
  id = '';
}

class SearchUsersRequest {
  term = '';
  role = '';
  region = '';
  sort = '';
  page = '';
  limit = '';
}

class CreateUserRequest {
  name = '';
  email = '';
  role = '';
  team = '';
  title = '';
  status = '';
}

@Controller('baseline')
class BaselineController {
  @Get()
  health(): { ok: boolean } {
    return { ok: true };
  }
}

@Controller('di-chain-one')
class DiChainOneController {
  constructor(private readonly service: UsersService) {}

  @Get('r01/:id')
  getR01(@Param() input: GetUserRequest): { id: string; name: string; email: string } {
    return this.service.getUser(input.id);
  }
}

@Controller('di-chain')
class DiChainTwentyController {
  constructor(private readonly service: UsersService) {}

  @Get('r01/:id')
  getR01(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r02/:id')
  getR02(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r03/:id')
  getR03(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r04/:id')
  getR04(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r05/:id')
  getR05(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r06/:id')
  getR06(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r07/:id')
  getR07(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r08/:id')
  getR08(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r09/:id')
  getR09(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r10/:id')
  getR10(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r11/:id')
  getR11(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r12/:id')
  getR12(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r13/:id')
  getR13(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r14/:id')
  getR14(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r15/:id')
  getR15(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r16/:id')
  getR16(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r17/:id')
  getR17(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r18/:id')
  getR18(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r19/:id')
  getR19(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
  @Get('r20/:id')
  getR20(@Param() input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
}

@Controller('di-chain-direct-one')
class DirectParamOneController {
  constructor(private readonly service: UsersService) {}

  @Get('r01/:id')
  getR01(@Param('id') id: string): { id: string; name: string; email: string } {
    return this.service.getUser(id);
  }
}

@Controller('di-chain-direct')
class DirectParamTwentyController {
  constructor(private readonly service: UsersService) {}

  @Get('r01/:id')
  getR01(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r02/:id')
  getR02(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r03/:id')
  getR03(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r04/:id')
  getR04(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r05/:id')
  getR05(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r06/:id')
  getR06(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r07/:id')
  getR07(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r08/:id')
  getR08(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r09/:id')
  getR09(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r10/:id')
  getR10(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r11/:id')
  getR11(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r12/:id')
  getR12(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r13/:id')
  getR13(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r14/:id')
  getR14(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r15/:id')
  getR15(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r16/:id')
  getR16(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r17/:id')
  getR17(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r18/:id')
  getR18(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r19/:id')
  getR19(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
  @Get('r20/:id')
  getR20(@Param('id') id: string): { id: string; name: string; email: string } { return this.service.getUser(id); }
}

@Controller('query-dto-one')
class QueryDtoOneController {
  constructor(private readonly service: UsersService) {}

  @Get('r01')
  getR01(@Query() input: SearchUsersRequest) {
    return this.service.searchUsers(input);
  }
}

@Controller('body-dto-one')
class BodyDtoOneController {
  constructor(private readonly service: UsersService) {}

  @Post('r01')
  createR01(@Body() input: CreateUserRequest) {
    return this.service.createUser(input);
  }
}

@Module({ controllers: [BaselineController] })
class BaselineModule {}

@Module({ controllers: [DiChainOneController], providers: [UsersRepository, UsersService] })
class DtoOneModule {}

@Module({ controllers: [DiChainTwentyController], providers: [UsersRepository, UsersService] })
class DtoTwentyModule {}

@Module({ controllers: [DirectParamOneController], providers: [UsersRepository, UsersService] })
class DirectOneModule {}

@Module({ controllers: [DirectParamTwentyController], providers: [UsersRepository, UsersService] })
class DirectTwentyModule {}

@Module({ controllers: [QueryDtoOneController], providers: [UsersRepository, UsersService] })
class QueryOneModule {}

@Module({ controllers: [BodyDtoOneController], providers: [UsersRepository, UsersService] })
class BodyOneModule {}

function resolveAppModule(shape: AppShape) {
  switch (shape) {
    case 'baseline': return BaselineModule;
    case 'dto-1': return DtoOneModule;
    case 'dto-20': return DtoTwentyModule;
    case 'direct-1': return DirectOneModule;
    case 'direct-20': return DirectTwentyModule;
    case 'query-1': return QueryOneModule;
    case 'body-1': return BodyOneModule;
  }
}

function readAppShape(): AppShape {
  const raw = process.env['BENCH_APP_SHAPE'] ?? 'dto-20';
  if (raw === 'baseline' || raw === 'dto-1' || raw === 'dto-20' || raw === 'direct-1' || raw === 'direct-20' || raw === 'query-1' || raw === 'body-1') {
    return raw;
  }
  throw new Error(`Unsupported BENCH_APP_SHAPE: ${raw}`);
}

async function main(): Promise<void> {
  const port = Number(process.env['PORT'] ?? 3002);
  const app = await NestFactory.create<NestFastifyApplication>(
    resolveAppModule(readAppShape()),
    new FastifyAdapter(),
    { logger: false },
  );

  await app.listen(port, '0.0.0.0');
  process.stdout.write(`NestJS listening on :${port}\n`);
}

main().catch((err) => {
  process.stderr.write(`[nestjs] fatal: ${String(err)}\n`);
  process.exit(1);
});
