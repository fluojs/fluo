import { Convert, FromBody, FromPath, FromQuery, type HttpWire, Optional, Post, RequestDto } from '@fluojs/http';
import { createReactServerEntry, Path, ReactModule, ReactNavigationPage, Router } from '@fluojs/react';
import { defineModule } from '@fluojs/runtime';
import { IsNumber, IsString, MinLength } from '@fluojs/validation';
import { createElement } from 'react';

import ProjectedPage from './typegen-projected-page.js';
import EmptyProjectedPage from './typegen-empty-page.js';

class SearchInput {
  @FromPath('sku')
  product = '';

  @FromQuery('q')
  term = '';

  @Convert({ convert(value: unknown) { return Number(value); } })
  @IsNumber()
  @FromQuery('page')
  page: HttpWire<number, string> = 1;

  @Optional()
  @FromQuery('tag')
  tags: string | readonly string[] = [];
}

class SaveInput {
  @FromPath('sku')
  product = '';

  @FromBody('display_name')
  @IsString()
  @MinLength(2)
  name = '';

  @FromBody('csrf')
  csrf = '';
}

function createRouter() {
  @Router('/search')
  class SearchRouter {
    @Path('/empty')
    empty() {
      return ReactNavigationPage.create(createElement(EmptyProjectedPage), {
        module: './typegen-empty-page.ts', props: {},
      });
    }

    @RequestDto(SearchInput)
    @Path('/:sku')
    show(input: SearchInput) {
      const props = { page: input.page, product: input.product, tags: input.tags, term: input.term };
      return ReactNavigationPage.create(createElement(ProjectedPage, props), {
        module: './typegen-projected-page.ts', props,
      });
    }

    @Post('/:sku')
    @RequestDto(SaveInput)
    save(input: SaveInput) {
      return ReactModule.formResult({
        destination: `/search/${input.product}?q=saved&page=1`,
        followUp: 'navigate',
        data: { status: 'saved', name: input.name, revision: 1 },
      });
    }
  }
  return SearchRouter;
}

/** Root module fixture retaining a non-exported DTO and a factory-local router. */
export class AppModule {}

defineModule(AppModule, { imports: [ReactModule.forRoot({
  controllers: [createRouter()],
  navigationBuildId: 'typegen-fixture',
  renderPage: (page) => createReactServerEntry(page),
})] });
