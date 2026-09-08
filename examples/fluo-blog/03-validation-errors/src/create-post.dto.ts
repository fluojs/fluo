import { FromBody } from '@fluojs/http';
import { IsDefined, IsString, MaxLength, MinLength } from '@fluojs/validation';

export class CreatePostDto {
  @FromBody()
  @IsDefined()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title = '';

  @FromBody()
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content = '';
}
