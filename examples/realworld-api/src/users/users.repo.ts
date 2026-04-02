import type { UserResponseDto } from './user-response.dto';

export class UsersRepo {
  private readonly store = new Map<string, UserResponseDto>();
  private nextId = 1;

  create(name: string, email: string): UserResponseDto {
    const id = String(this.nextId++);
    const user: UserResponseDto = { id, name, email };
    this.store.set(id, user);
    return user;
  }

  findAll(): UserResponseDto[] {
    return Array.from(this.store.values());
  }

  findById(id: string): UserResponseDto | undefined {
    return this.store.get(id);
  }
}
