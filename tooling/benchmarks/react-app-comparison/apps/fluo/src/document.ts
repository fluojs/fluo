import {
  createReactRouteSnapshot,
  Link,
  ReactClientRouterProvider,
  type ReactNavigationModules,
  useNavigation,
  usePathname,
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
  readonly initialElement: ReactNode;
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

function JukeboxResourceBoundary() {
  const pathname = usePathname();
  return pathname.startsWith('/jukebox/') ? createElement(JukeboxResource) : null;
}

export function BenchmarkDocument({
  data,
  editor,
  initialElement,
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
        createElement('main', null, destination ?? initialElement),
        createElement(JukeboxResourceBoundary),
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
