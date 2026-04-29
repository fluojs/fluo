import { Inject, Module } from '@fluojs/core';
import { Controller, FromPath, Get, RequestDto } from '@fluojs/http';
import { createExpressAdapter } from '@fluojs/platform-express';
import { FluoFactory } from '@fluojs/runtime';

@Controller('/baseline')
class BaselineController {
  @Get('/')
  health(): { ok: boolean } {
    return { ok: true };
  }
}

class UsersRepository {
  findOne(id: string): { id: string; name: string; email: string } {
    return { id, name: 'Alice', email: 'alice@example.com' };
  }
}

class GetUserRequest {
  @FromPath('id')
  id = '';
}

@Inject(UsersRepository)
class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  getUser(id: string): { id: string; name: string; email: string } {
    return this.repo.findOne(id);
  }
}

@Inject(UsersService)
@Controller('/di-chain')
class DiChainController {
  constructor(private readonly service: UsersService) {}

  @RequestDto(GetUserRequest)
  @Get('/:id')
  get(input: GetUserRequest): { id: string; name: string; email: string } {
    return this.service.getUser(input.id);
  }

  @RequestDto(GetUserRequest)
  @Get('/users/:id')
  getUser(input: GetUserRequest): { id: string; name: string; email: string } {
    return this.service.getUser(input.id);
  }

  @RequestDto(GetUserRequest)
  @Get('/profiles/:id')
  getProfile(input: GetUserRequest): { id: string; name: string; email: string } {
    return this.service.getUser(input.id);
  }

  @RequestDto(GetUserRequest)
  @Get('/settings/:id')
  getSettings(input: GetUserRequest): { id: string; name: string; email: string } {
    return this.service.getUser(input.id);
  }

  @RequestDto(GetUserRequest)
  @Get('/r01/:id')
  getR01(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r02/:id')
  getR02(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r03/:id')
  getR03(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r04/:id')
  getR04(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r05/:id')
  getR05(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r06/:id')
  getR06(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r07/:id')
  getR07(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r08/:id')
  getR08(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r09/:id')
  getR09(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r10/:id')
  getR10(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r11/:id')
  getR11(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r12/:id')
  getR12(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r13/:id')
  getR13(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r14/:id')
  getR14(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r15/:id')
  getR15(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r16/:id')
  getR16(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r17/:id')
  getR17(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r18/:id')
  getR18(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r19/:id')
  getR19(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }

  @RequestDto(GetUserRequest)
  @Get('/r20/:id')
  getR20(input: GetUserRequest): { id: string; name: string; email: string } { return this.service.getUser(input.id); }
}

@Module({
  controllers: [BaselineController, DiChainController],
  providers: [UsersRepository, UsersService],
})
class AppModule {}

async function main(): Promise<void> {
  const port = Number(process.env['PORT'] ?? 3005);

  const app = await FluoFactory.create(AppModule, {
    adapter: createExpressAdapter({ port }),
    logger: { debug() {}, error() {}, log() {}, warn() {} },
  });

  await app.listen();
  process.stdout.write(`fluo+Express listening on :${port}\n`);
}

main().catch((err) => {
  process.stderr.write(`[fluo-express] fatal: ${String(err)}\n`);
  process.exit(1);
});
