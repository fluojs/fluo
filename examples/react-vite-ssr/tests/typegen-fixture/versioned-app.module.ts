import { FromBody, Post, RequestDto, Version, VersioningType } from '@fluojs/http';
import { ReactModule, Router } from '@fluojs/react';
import { defineModule } from '@fluojs/runtime';

class SaveInput {
  @FromBody('display_name')
  name = '';
}

@Router('/v2/mutations')
class SaveRouter {
  @Post('/save')
  @Version('2')
  @RequestDto(SaveInput)
  save(input: SaveInput) {
    return ReactModule.formResult({
      destination: '/catalog',
      followUp: 'refresh',
      data: { name: input.name },
    });
  }
}

export class AppModule {}

defineModule(AppModule, { imports: [ReactModule.forRoot({ controllers: [SaveRouter] })] });

export const headerOptions = { versioning: { type: VersioningType.HEADER, header: 'x-api-version' } };
export const mediaOptions = { versioning: { type: VersioningType.MEDIA_TYPE, key: 'v=' } };
export const customOptions = { versioning: { type: VersioningType.CUSTOM, extractor: () => '2' } };
