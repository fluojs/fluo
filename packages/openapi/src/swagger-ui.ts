const SWAGGER_UI_DIST_VERSION = '5.32.2';
const SWAGGER_UI_DIST_BASE_URL = `https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_DIST_VERSION}`;
const SWAGGER_UI_CSS_URL = `${SWAGGER_UI_DIST_BASE_URL}/swagger-ui.css`;
const SWAGGER_UI_BUNDLE_JS_URL = `${SWAGGER_UI_DIST_BASE_URL}/swagger-ui-bundle.js`;

type SwaggerUiRoutes = {
  readonly documentPath: string;
  readonly uiPath: string;
};

/**
 * Asset URLs used by the generated Swagger UI HTML page.
 */
export interface OpenApiSwaggerUiAssetsOptions {
  cssUrl?: string;
  jsBundleUrl?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function serializeInlineScriptString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/**
 * Resolve pinned or caller-provided Swagger UI asset URLs.
 *
 * @param assets Optional caller-provided asset URLs.
 * @returns Complete asset URLs for generated Swagger UI HTML.
 */
export function resolveSwaggerUiAssets(
  assets: OpenApiSwaggerUiAssetsOptions | undefined,
): Required<OpenApiSwaggerUiAssetsOptions> {
  return {
    cssUrl: assets?.cssUrl ?? SWAGGER_UI_CSS_URL,
    jsBundleUrl: assets?.jsBundleUrl ?? SWAGGER_UI_BUNDLE_JS_URL,
  };
}

/**
 * Render Swagger UI HTML for one configured OpenAPI document route.
 *
 * @param title Document title rendered into the page.
 * @param assets Complete Swagger UI asset URLs.
 * @param routes Normalized JSON document and UI routes.
 * @returns A standalone Swagger UI HTML document.
 */
export function createSwaggerUiHtml(
  title: string,
  assets: Required<OpenApiSwaggerUiAssetsOptions>,
  routes: SwaggerUiRoutes,
): string {
  const uiPathPattern = routes.uiPath === '/'
    ? '/?$'
    : `${escapeRegularExpression(routes.uiPath)}/?$`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="${escapeHtml(assets.cssUrl)}" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${escapeHtml(assets.jsBundleUrl)}" crossorigin></script>
    <script>
      const specUrl = window.location.pathname.replace(
        new RegExp(${serializeInlineScriptString(uiPathPattern)}),
        () => ${serializeInlineScriptString(routes.documentPath)}
      );
      const swaggerUi = SwaggerUIBundle({
        url: specUrl,
        dom_id: '#swagger-ui'
      });
      void swaggerUi;
    </script>
  </body>
</html>`;
}
