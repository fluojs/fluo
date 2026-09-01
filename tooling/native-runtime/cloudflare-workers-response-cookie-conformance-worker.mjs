import {
  createNativeResponseCookieConformanceResponse,
} from './response-cookie-conformance.mjs';

export default {
  fetch() {
    const response = createNativeResponseCookieConformanceResponse();

    return new Response(JSON.stringify(response.headers.getSetCookie()), {
      headers: response.headers,
    });
  },
};
