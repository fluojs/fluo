import { Module } from '@fluojs/core';
import {
  Controller,
  FromBody,
  FromPath,
  Get,
  type Guard,
  type GuardContext,
  InputPolicy,
  NotFoundException,
  Post,
  RequestDto,
  UseGuards,
} from '@fluojs/http';
import { IsDefined, IsString, MinLength } from '@fluojs/validation';

/**
 * Runnable application for the package guides of this workstream
 * (apps/docs/content/docs/packages/http.mdx and validation.mdx).
 *
 * It composes @fluojs/http with @fluojs/validation: DTO binding, InputPolicy
 * strip/reject behavior, guards, and the canonical error envelope.
 */

class CreateUserDto {
  @FromBody()
  @IsDefined()
  @IsString()
  @MinLength(3)
  name = '';
}

class FindUserParamsDto {
  @FromPath('id')
  id = '';
}

@Controller('/users')
export class UserController {
  private readonly users = [{ id: '1', name: 'Ada' }];

  @Get()
  list() {
    return this.users;
  }

  @Get('/:id')
  @RequestDto(FindUserParamsDto)
  get(input: FindUserParamsDto) {
    const user = this.users.find((candidate) => candidate.id === input.id);
    if (!user) {
      throw new NotFoundException(`User ${input.id} was not found.`);
    }
    return user;
  }

  @Post()
  @RequestDto(CreateUserDto)
  create(input: CreateUserDto) {
    const user = { id: '2', name: input.name };
    this.users.push(user);
    return user;
  }
}

@InputPolicy({ unknownFields: 'strip' })
class DraftInput {
  @FromBody('post_title')
  @IsDefined()
  @IsString()
  title = '';
}

@Controller('/drafts')
export class DraftController {
  @Post()
  @RequestDto(DraftInput)
  create(input: DraftInput) {
    return { title: input.title };
  }

  @Post('/strict')
  @RequestDto(DraftInput)
  @InputPolicy({ unknownFields: 'reject' })
  strict(input: DraftInput) {
    return { title: input.title };
  }
}

export class AdminHeaderGuard implements Guard {
  canActivate(context: GuardContext): boolean {
    const header = context.requestContext.request.headers['x-admin-token'];
    return header === 'admin-secret';
  }
}

@Controller('/admin')
@UseGuards(AdminHeaderGuard)
export class AdminController {
  @Get()
  dashboard() {
    return { data: 'secret' };
  }
}

@Module({
  controllers: [UserController, DraftController, AdminController],
  providers: [AdminHeaderGuard],
})
export class AppModule {}
