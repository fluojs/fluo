import { createElement } from 'react';
import type { PageData } from './document';

type DestinationProps = {
  readonly data: Extract<PageData, { readonly kind: 'jukebox' }>;
  readonly editor: boolean;
};

export default function JukeboxDestination({ data }: DestinationProps) {

  return createElement(
    'section',
    { 'data-approved-view': data.view },
    createElement('h1', null, `Jukebox / ${data.view}`),
    createElement('p', null, data.view === 'qr' ? 'QR listening station' :
      data.view === 'queue' ? 'Upcoming queue' : 'Song library'),
    createElement('ul', { className: 'product-list' },
      ...data.songs.map((song) => createElement('li', { key: song.id }, song.title)),
    ),
  );
}
