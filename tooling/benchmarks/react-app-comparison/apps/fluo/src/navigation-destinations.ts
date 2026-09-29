import { createElement } from 'react';

import { PageView, type PageData } from './document';

type DestinationProps = { readonly data: PageData; readonly editor: boolean };

export function CatalogDestination({ data, editor }: DestinationProps) {
  return createElement(PageView, { data, editor });
}

export function ProductDestination({ data, editor }: DestinationProps) {
  return createElement(PageView, { data, editor });
}

export function JukeboxDestination({ data, editor }: DestinationProps) {
  return createElement(PageView, { data, editor });
}
