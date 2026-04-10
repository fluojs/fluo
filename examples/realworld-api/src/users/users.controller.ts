import { Inject } from '@fluojs/core';
import { Controller, Get, Post, RequestDto } from '@fluojs/http';

import { CreateUserDto } from './create-user.dto';
import type { UserResponseDto } from './user-response.dto';
import { UsersService } from './users.service';

@Inject(UsersService)
@Controller('/users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get('/')
  list(): UserResponseDto[] {
    return this.service.listUsers();
  }

  @Post('/')
  @RequestDto(CreateUserDto)
  create(dto: CreateUserDto): UserResponseDto {
    return this.service.createUser(dto.name, dto.email);
  }
}
