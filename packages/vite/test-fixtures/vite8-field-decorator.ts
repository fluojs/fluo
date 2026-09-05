import { getDtoBindingSchema } from '@fluojs/core/request-pipeline';
import { FromBody } from '@fluojs/http';

class RequestDto {
  @FromBody('display_name')
  name = '';
}

export default getDtoBindingSchema(RequestDto);
