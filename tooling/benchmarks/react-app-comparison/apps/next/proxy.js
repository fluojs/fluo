import { NextResponse } from 'next/server';

// A Page and a Route Handler cannot occupy the same App Router segment.
// Rewrite only native form POSTs so their GET URLs remain real React pages.
export function proxy(request) {
  const { pathname } = request.nextUrl;
  if (request.method === 'POST' && (pathname === '/login' || pathname === '/products' || /^\/products\/[^/]+(?:\/delete)?$/.test(pathname))) {
    return NextResponse.rewrite(new URL(`/mutations${pathname}`, request.url));
  }
  const response = NextResponse.next();
  if (pathname === '/' || pathname === '/products' || pathname.startsWith('/products/') || pathname.startsWith('/admin/')) {
    response.headers.set('Cache-Control', 'no-store');
  }
  return response;
}

export const config = {
  matcher: ['/', '/login', '/products/:path*', '/admin/:path*'],
};
