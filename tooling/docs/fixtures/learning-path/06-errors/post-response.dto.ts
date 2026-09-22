import { Expose } from '@fluojs/serialization';

@Expose({ excludeExtraneous: true })
export class PostResponseDto {
  @Expose()
  id = '';

  @Expose()
  title = '';

  @Expose()
  content = '';

  internalNotes = '';
}
