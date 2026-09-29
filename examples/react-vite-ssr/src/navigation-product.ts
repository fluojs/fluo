import { createElement } from 'react';

declare const __FLUO_BUILD_VARIANT__: string;

export default function ProductDestination(props: Record<string, unknown>) {
  const sku = typeof props.sku === 'string' ? props.sku : '';
  const productName = typeof props.productName === 'string' ? props.productName : '';
  const preview = props.preview === true;
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
  );
}
