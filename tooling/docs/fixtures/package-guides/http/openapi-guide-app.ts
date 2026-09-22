import { Module } from '@fluojs/core';
import { Controller, FromBody, Get, Post, Produces, RequestDto } from '@fluojs/http';
import { ApiOperation, ApiResponse, ApiTag, OpenApiModule } from '@fluojs/openapi';
import { IsEmail, IsString, MinLength } from '@fluojs/validation';

/**
 * Runnable application for the OpenAPI package guide
 * (apps/docs/content/docs/packages/openapi.mdx).
 *
 * Composes @fluojs/openapi with @fluojs/http routes and @fluojs/validation DTO
 * metadata: request schemas are derived from binding + validation decorators,
 * response components are declared explicitly.
 */

class CreateUserDto {
  @FromBody()
  @IsEmail()
  email = '';

  @FromBody()
  @IsString()
  @MinLength(2)
  name = '';
}

export class UserResponseDto {
  id = '';
  email = '';
  name = '';
}

@ApiTag('Users')
@Controller('/users')
export class OpenApiUsersController {
  @ApiOperation({ summary: 'List users' })
  @ApiResponse({ status: 200, description: 'The user list', type: UserResponseDto })
  @Get()
  list(): UserResponseDto[] {
    return [{ id: '1', email: 'ada@example.com', name: 'Ada' }];
  }

  @ApiOperation({ summary: 'Create a user' })
  @ApiResponse({ status: 201, description: 'Created user', type: UserResponseDto })
  @Produces('application/json')
  @Post()
  @RequestDto(CreateUserDto)
  create(input: CreateUserDto): UserResponseDto {
    return { id: '2', email: input.email, name: input.name };
  }
}

@Module({
  imports: [
    OpenApiModule.forRoot({
      title: 'Users API',
      version: '1.0.0',
      sources: [{ controllerToken: OpenApiUsersController }],
      ui: false,
    }),
  ],
  controllers: [OpenApiUsersController],
})
export class OpenApiAppModule {}
