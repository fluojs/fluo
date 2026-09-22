import { FromPath } from '@fluojs/http';

export class PostParamsDto {
  @FromPath('id')
  id = '';
}
