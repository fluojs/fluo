import { createElement, useState } from 'react';

export default function AdminDestination({ page }: { readonly page: 'qr' | 'songs' }) {
  const [count, setCount] = useState(0);
  return createElement(
    'section',
    { 'aria-label': `Admin ${page} page` },
    createElement('h1', null, page === 'qr' ? 'Admin QR' : 'Admin songs'),
    createElement(
      'button',
      { onClick: () => setCount((value) => value + 1), type: 'button' },
      `Page count: ${count}`,
    ),
  );
}
