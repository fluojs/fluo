import {
  createReactRouteSnapshot,
  Link,
  ReactClientRouterProvider,
  type ReactNavigationModules,
  useNavigation,
} from '@fluojs/react/client';
import type { ReactInitialNavigationPage } from '@fluojs/react';
import { createElement, type ReactNode, useEffect, useRef, useState } from 'react';

import { createToneUrl } from '../../../fixture/audio.mjs';
import type { Product, Song } from '../../../fixture/domain.mjs';

export type PageData =
  | { readonly kind: 'catalog'; readonly products: readonly Product[]; readonly title: string }
  | { readonly kind: 'admin'; readonly products: readonly Product[] }
  | { readonly kind: 'login' }
  | { readonly kind: 'product'; readonly product: Product }
  | {
      readonly kind: 'jukebox';
      readonly view: 'songs' | 'qr' | 'queue';
      readonly songs: readonly Song[];
    };

type DocumentProps = {
  readonly data: PageData;
  readonly editor: boolean;
  readonly initialPage?: ReactInitialNavigationPage;
  readonly navigationModules?: ReactNavigationModules;
  readonly navigationBuildId: string;
  readonly routeParams: Readonly<Record<string, string>>;
  readonly routeUrl: string;
  readonly stylesheets: readonly string[];
};

function JukeboxResource() {
  const navigation = useNavigation();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [resourceId, setResourceId] = useState('');
  const [ack, setAck] = useState('0');
  const count = useRef(0);

  useEffect(() => {
    const url = createToneUrl();
    const instance = new Audio(url);
    instance.loop = true;
    const acknowledge = () => {
      count.current += 1;
      setAck(String(count.current));
    };
    instance.addEventListener('playing', acknowledge);
    instance.addEventListener('pause', acknowledge);
    audio.current = instance;
    setResourceId(crypto.randomUUID());
    return () => {
      instance.pause();
      instance.removeEventListener('playing', acknowledge);
      instance.removeEventListener('pause', acknowledge);
      instance.removeAttribute('src');
      instance.load();
      URL.revokeObjectURL(url);
      audio.current = null;
    };
  }, []);

  return createElement(
    'section',
    {
      'aria-label': 'Persistent jukebox resource',
      'data-instance': resourceId,
      'data-benchmark-hydrated': Boolean(resourceId),
      'data-resource-id': resourceId,
      'data-testid': 'jukebox-resource',
    },
    createElement('p', null, 'A browser audio resource stays mounted while jukebox views change.'),
    createElement('button', {
      'data-testid': 'jukebox-operation',
      onClick: async () => {
        const instance = audio.current;
        if (!instance) return;
        if (!instance.paused) instance.pause();
        else await instance.play();
      },
      type: 'button',
    }, 'Operate resource'),
    createElement('output', {
      'aria-live': 'polite',
      'data-operation-ack': ack,
      'data-testid': 'jukebox-ack',
    }, ack),
    navigation.status === 'navigating'
      ? createElement('output', { 'data-navigation-pending': true, role: 'status' }, 'Opening view')
      : null,
  );
}

export function PageView({ data, editor }: { readonly data: PageData; readonly editor: boolean }) {
  if (data.kind === 'login') {
    return createElement('section', null,
      createElement('h1', null, 'Editor login'),
      createElement('form', { action: '/login', method: 'post' },
        createElement('label', { htmlFor: 'username' }, 'Username'),
        createElement('input', { id: 'username', name: 'username', required: true }),
        createElement('label', { htmlFor: 'password' }, 'Password'),
        createElement('input', { id: 'password', name: 'password', required: true, type: 'password' }),
        createElement('button', { type: 'submit' }, 'Log in')));
  }

  if (data.kind === 'admin') {
    return createElement('section', null,
      createElement('h1', null, 'Manage products'),
      createElement('ul', { className: 'product-list' },
        ...data.products.map((product) => createElement('li', { key: product.sku },
          createElement(Link, { href: `/products/${encodeURIComponent(product.sku)}` }, product.name))),
      ),
      createElement('form', { action: '/products', method: 'post' },
        createElement('label', { htmlFor: 'new-name' }, 'New product name'),
        createElement('input', { id: 'new-name', minLength: 3, name: 'name', required: true }),
        createElement('button', { type: 'submit' }, 'Create product')));
  }

  if (data.kind === 'catalog') {
    return createElement(
      'section',
      null,
      createElement('h1', null, data.title),
      createElement('ul', { className: 'product-list' },
        ...data.products.map((product) => createElement('li', { key: product.sku },
          createElement(Link, { href: `/products/${encodeURIComponent(product.sku)}` }, product.name),
          createElement('small', null, product.sku),
        )),
      ),
      editor
        ? createElement('form', { action: '/products', method: 'post' },
          createElement('label', { htmlFor: 'new-name' }, 'New product name'),
          createElement('input', { id: 'new-name', minLength: 3, name: 'name', required: true }),
          createElement('button', { type: 'submit' }, 'Create product'),
        )
        : createElement('form', { action: '/login', method: 'post' },
          createElement('label', { htmlFor: 'username' }, 'Username'),
          createElement('input', { id: 'username', name: 'username', required: true }),
          createElement('label', { htmlFor: 'password' }, 'Password'),
          createElement('input', { id: 'password', name: 'password', required: true, type: 'password' }),
          createElement('button', { type: 'submit' }, 'Log in'),
        ),
    );
  }

  if (data.kind === 'product') {
    const { product } = data;
    return createElement(
      'section',
      null,
      createElement('p', null, createElement(Link, { href: '/' }, 'All products')),
      createElement('h1', null, product.name),
      createElement('p', null, `SKU ${product.sku}`),
      editor ? createElement('div', null,
        createElement('form', { action: `/products/${encodeURIComponent(product.sku)}`, method: 'post' },
          createElement('label', { htmlFor: 'edit-name' }, 'Product name'),
          createElement('input', {
            defaultValue: product.name,
            id: 'edit-name',
            minLength: 3,
            name: 'name',
            required: true,
          }),
          createElement('button', { type: 'submit' }, 'Save product'),
        ),
        createElement('form', { action: `/products/${encodeURIComponent(product.sku)}/delete`, method: 'post' },
          createElement('button', { type: 'submit' }, 'Delete product'),
        ),
      ) : null,
    );
  }

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

export function BenchmarkDocument({
  data,
  editor,
  initialPage,
  navigationModules,
  navigationBuildId,
  routeParams,
  routeUrl,
  stylesheets,
}: DocumentProps) {
  const snapshot = createReactRouteSnapshot({ params: routeParams, url: routeUrl });
  const renderDocument = (destination: ReactNode | null): ReactNode => createElement(
    'html',
    { 'data-benchmark-page': JSON.stringify({ data, editor }), 'data-build-id': navigationBuildId, lang: 'en' },
    createElement('head', null,
      createElement('meta', { charSet: 'utf-8' }),
      createElement('meta', { content: 'width=device-width, initial-scale=1', name: 'viewport' }),
      createElement('title', null, 'Catalog and jukebox benchmark'),
      ...stylesheets.map((href) => createElement('link', {
        'data-vite-style': true,
        href,
        key: href,
        rel: 'stylesheet',
      })),
    ),
    createElement('body', null,
      createElement('div', { className: 'shell' },
        createElement('header', null,
          createElement('a', { className: 'brand', href: '/' }, 'Fluo / catalog'),
          createElement('nav', { 'aria-label': 'Main navigation' },
            createElement(Link, { href: '/' }, 'Products'),
            createElement(Link, { href: '/jukebox/songs' }, 'Songs'),
            createElement(Link, { href: '/jukebox/qr' }, 'QR'),
            createElement(Link, { href: '/jukebox/queue' }, 'Queue'),
          ),
          editor ? createElement('form', { action: '/logout', method: 'post' },
            createElement('button', { type: 'submit' }, 'Log out'),
          ) : null,
        ),
        createElement('main', null, destination ?? createElement(PageView, { data, editor })),
        createElement(JukeboxResource),
      ),
      initialPage === undefined ? null : createElement('script', {
        id: 'fluo-initial-page',
        type: 'application/json',
      }, initialPage.json),
    ),
  );
  const providerProps = {
    children: renderDocument,
    initialSnapshot: snapshot,
    navigationBuildId,
    navigationModules,
    prefetchScope: editor ? 'catalog:editor' : 'catalog:anonymous',
  };
  return createElement(ReactClientRouterProvider, providerProps);
}
