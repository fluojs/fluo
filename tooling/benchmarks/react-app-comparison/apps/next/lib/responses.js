import { isEditor, validateProduct } from '../../../fixture/domain.mjs';

export function authorized(request) {
  return isEditor(request.headers.get('cookie'));
}

export function productName(form) {
  return validateProduct(form.get('name'));
}

export function postRedirect(location, cookie) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
  });
}

export function rejected(status, message) {
  return new Response(message, { status, headers: { 'Cache-Control': 'no-store' } });
}
