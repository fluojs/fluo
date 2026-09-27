import { createElement, useEffect } from 'react';

export default function ProductDestination(props: Record<string, unknown>) {
  const sku = typeof props.sku === 'string' ? props.sku : '';
  const productName = typeof props.productName === 'string' ? props.productName : '';
  const preview = props.preview === true;
  useEffect(() => {
    document.title = `Catalog item ${sku}`;
  }, [sku]);

  return createElement(
    'section',
    { 'aria-label': 'Loaded product destination' },
    createElement('h2', null, `Browser destination: ${productName}`),
    createElement('p', null, `Server-confirmed sku: ${sku}`),
    createElement('p', null, `Server-confirmed preview: ${preview}`),
  );
}
