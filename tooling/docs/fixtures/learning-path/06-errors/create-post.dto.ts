import { FromBody } from '@fluojs/http';
import { IsString, MaxLength, MinLength } from '@fluojs/validation';

export class CreatePostDto {
  @FromBody()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title = '';

  @FromBody()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content = '';
}
