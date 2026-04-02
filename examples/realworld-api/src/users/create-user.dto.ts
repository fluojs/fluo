import { IsString, IsNotEmpty } from '@konekti/validation';
import { FromBody } from '@konekti/http';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @FromBody('name')
  name!: string;

  @IsString()
  @IsNotEmpty()
  @FromBody('email')
  email!: string;
}
