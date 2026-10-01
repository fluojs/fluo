import { createElement, useState } from 'react';

declare const __FLUO_BUILD_VARIANT__: string;

export default function ProductDestination(props: {
  readonly sku: string;
  readonly productName: string;
  readonly preview: boolean;
}) {
  const { sku, productName, preview } = props;
  const [count, setCount] = useState(0);
  if (sku === 'render-error' && Reflect.get(window, '__allowRenderRetry') !== true) {
    throw new Error('Example destination render failed');
  }

  return createElement(
    'section',
    { 'aria-label': 'Loaded product destination' },
    createElement('h2', null, `Browser destination: ${productName}`),
    createElement('p', null, `Server-confirmed sku: ${sku}`),
    createElement('p', null, `Server-confirmed preview: ${preview}`),
    createElement('p', { 'data-testid': 'build-variant' }, `Built variant: ${__FLUO_BUILD_VARIANT__}`),
    createElement('button', { onClick: () => setCount((value) => value + 1), type: 'button' }, `Page count: ${count}`),
  );
}
