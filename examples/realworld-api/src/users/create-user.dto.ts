import { IsString, IsNotEmpty } from '@fluojs/validation';
import { FromBody } from '@fluojs/http';

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
