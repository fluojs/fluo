import { Inject } from '@fluojs/core';

import { UsersRepo } from './users.repo';
import type { UserResponseDto } from './user-response.dto';

@Inject(UsersRepo)
export class UsersService {
  constructor(private readonly repo: UsersRepo) {}

  createUser(name: string, email: string): UserResponseDto {
    return this.repo.create(name, email);
  }

  listUsers(): UserResponseDto[] {
    return this.repo.findAll();
  }

  getUser(id: string): UserResponseDto | undefined {
    return this.repo.findById(id);
  }
}
