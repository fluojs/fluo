import { IsDefined, IsString, IsNotEmpty } from '@fluojs/validation';
import { FromBody } from '@fluojs/http';

export class CreateUserDto {
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @FromBody('name')
  name!: string;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @FromBody('email')
  email!: string;
}
