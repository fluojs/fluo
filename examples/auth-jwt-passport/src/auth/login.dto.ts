import { FromBody } from '@fluojs/http';
import { IsNotEmpty, IsString } from '@fluojs/validation';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @FromBody('username')
  username!: string;
}
