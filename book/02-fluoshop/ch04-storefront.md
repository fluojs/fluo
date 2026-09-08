# Building the Journey from Blog to Purchase

<!-- book:volume=02-fluoshop;chapter=04 -->

[Previous: Modeling a T-shirt as a Product](./ch03-catalog-and-money.md) - [Volume 2 Contents](./toc.md) - [Next: Why You Cannot Trust Cart Prices](./ch05-cart-and-pricing.md)

## Keep Readers from Losing Their Way

A reader finishes a retrospective post and clicks the logo T-shirt link. If the new screen drops the blog's name and asks them to create a new account, the operator may think "the shop module is nicely separated," but the reader feels sent away to another site. On the other hand, placing only a price and a buy button beneath the post makes it hard to tell which size is selected, where to go back, or whether the displayed price is already final.

This chapter completes the part of the journey where readers explore products without interrupting their reading flow. They can move from an existing post to a product listing or detail screen, select a SKU and quantity, check the amount at current prices, and return to the blog. The account stays the same, but we do not require login just to browse. The next chapter covers the point at which customer identification and cart persistence become necessary.

Here, "leading to a purchase" does not mean building a payment button in advance. There is no order or payment implementation yet, so we do not display a success screen or a fake order number. The selection check in this chapter is read-only. It provides working navigation and amount checking, and clearly tells the reader that nothing has been saved to a cart and no price has been finalized.

The first implementation uses server rendering, ordinary links, and a GET form. Readers can view options and request the amount for their selection again even without JavaScript. Even if the Volume 1 blog already uses hydration, there is no need to immediately duplicate the same client state in this shop screen. Choose the interaction each feature needs and keep the server authoritative for data.

## React Does Not Invent a New Routing System

`@Router` and `@Path` from `@fluojs/react` express page intent on top of existing Fluo HTTP metadata. They do not generate routes automatically from filenames. You must explicitly register the class that owns `/products` and the module containing it. Existing middleware, guards, request scope, and conflict checks follow the HTTP runtime path as well.

In this chapter, `/products` is an HTML listing and `/products/:slug` is an HTML detail page. Do not register a separate JSON controller for the same method and path at the same time. The public listing in Chapters 1 through 3 was a service contract, not yet an HTTP JSON route, so this choice does not conflict with it. If you have already registered another representation, first settle which component owns that path. Do not assume two duplicate GET declarations are automatically separated because their `Accept` headers differ.

Separate server files from screen files too. Put decorators and `createElement()` calls in `src/storefront/storefront.router.ts`, and JSX in `src/storefront/storefront.page.tsx`. The application decorator transform from `@fluojs/vite` targets `.ts` and does not include `.tsx`. Moving the router to `.tsx` for convenience and expecting native TypeScript stripping to handle standard decorators as well creates differences between development and builds.

This separation is not a matter of framework taste. The server router consumes a provider that uses Prisma, while the screen consumes only values already converted to the public model. Importing the server router or `src/app.ts` from a screen file can pull database code into a client bundle. Keeping type-only imports and pure screen functions makes it easier to move only the components that need it into the browser later.

## Selection Comes from the Request; Prices Come from the Server

Chapter 3's `CatalogBrowser` returns only public products and active sales units. The selection check finds a SKU within those results and validates the quantity. The following is the **complete file** `src/storefront/select-product.ts`. Do not put prices or customer IDs in the URL query.

```ts
import { DtoValidationError } from '@fluojs/validation';
import type { CatalogProduct } from '../catalog/catalog.port.js';
import { discountPrice, lineTotal, parseMoney } from '../catalog/money.js';

export type ProductSelection =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | {
    readonly kind: 'selected';
    readonly sku: string;
    readonly quantity: number;
    readonly totalMinor: string;
  };

export function selectProduct(
  product: CatalogProduct,
  query: URLSearchParams,
): ProductSelection {
  if (!query.has('sku') && !query.has('quantity')) {
    return { kind: 'none' };
  }
  if (query.getAll('sku').length !== 1
    || query.getAll('quantity').length > 1) {
    return { kind: 'invalid' };
  }
  const sku = query.get('sku');
  const rawQuantity = query.get('quantity') ?? '1';
  if (!/^[1-9][0-9]?$/.test(rawQuantity)) {
    return { kind: 'invalid' };
  }
  const variant = product.variants.find((item) => item.sku === sku);
  if (variant === undefined) {
    return { kind: 'invalid' };
  }
  const price = discountPrice(
    parseMoney(variant.currency, variant.priceMinor), variant.discountMinor,
  );
  const quantity = Number(rawQuantity);

  try {
    const total = lineTotal(price, quantity);
    return {
      kind: 'selected',
      sku: variant.sku,
      quantity,
      totalMinor: total.minor.toString(),
    };
  } catch (error) {
    if (error instanceof DtoValidationError
      && error.issues.some((issue) => issue.field === 'totalMinor')) {
      return { kind: 'invalid' };
    }
    throw error;
  }
}
```

An initial visit with no SKU at all is different from a request submitting an invalid SKU. For an initial visit, provide a form that makes selection easy; treat a SKU from another product or an inactive SKU as an invalid selection. Reject duplicate occurrences of the same URL key too, rather than arbitrarily choosing the first or last value. A browser form normally sends just one value, but anyone can construct an HTTP request directly.

Check the quantity's string format before converting it to `Number`. A quantity in the range 1 through 99 is a safe integer, but do not apply the same conversion to money. If the total exceeds the database range, reject the selection so the reader can choose again. In contrast, if `parseMoney()` fails because a stored product's currency or price representation is invalid, do not hide it as a user selection error. Turning a product-data problem into 400 only leaves the customer repeatedly changing the quantity.

Both the option prices on the screen and the selection total use `(priceMinor - discountMinor)`. The existing fixture with a default discount of 0 totals 58,000 won for two shirts at 29,000 won each; changing the per-unit discount to 1,000 won makes the total 56,000 won. The display and the cart must not use different unit prices.

This calculation does not "finalize" a price. It describes the selection using values read by the server at request time. If the price changes between refreshes, the selection preview amount may change too. Even after values are saved to a cart later, checkout must recalculate on the server. That is why we do not take the shortcut of placing `priceMinor` in a hidden input to pass it to the next request.

## A Shop Screen That Renders Only the Values It Receives

The following is the **complete file** `src/storefront/storefront.page.tsx`. In the Korean edition, the UI text in the code is written in English so that the same block can be retained in translation, while the explanations continue in Korean. `lang="en"` identifies the actual language of this isolated exercise screen. When localizing it as a Korean product screen, change the document language and displayed text together.

```tsx
import * as React from 'react';
import type { CatalogProduct } from '../catalog/catalog.port.js';
import type { ProductSelection } from './select-product.js';

export function formatKrw(minor: string): string {
  return `KRW ${BigInt(minor).toLocaleString('en-US')}`;
}

export function StorefrontDocument(props: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${props.title} | FluoBlog`}</title>
      </head>
      <body>
        <a href="#main">Skip to content</a>
        <header>
          <nav aria-label="Main navigation">
            <a href="/posts">FluoBlog</a>{' / '}
            <a href="/products">Shop</a>
          </nav>
        </header>
        <main id="main" style={{ maxWidth: '48rem', margin: '2rem auto', padding: '1rem' }}>
          {props.children}
        </main>
        <footer><a href="/posts">Back to the blog</a></footer>
      </body>
    </html>
  );
}

export function CatalogPage(props: {
  readonly products: readonly CatalogProduct[];
}) {
  return (
    <>
      <h1>FluoBlog merchandise</h1>
      <p>Choose a product to explore its available options.</p>
      {props.products.length === 0 ? (
        <p>No products are currently listed.</p>
      ) : (
        <ul>
          {props.products.map((product) => (
            <li key={product.id}>
              <a href={`/products/${encodeURIComponent(product.slug)}`}>
                {product.name}
              </a>
              <ul>
                {product.variants.map((variant) => (
                  <li key={variant.sku}>
                    {variant.label}: {formatKrw((BigInt(variant.priceMinor) - BigInt(variant.discountMinor)).toString())}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SelectionSummary(props: { readonly selection: ProductSelection }) {
  switch (props.selection.kind) {
    case 'none':
      return <p>Select an option and quantity to check the current amount.</p>;
    case 'invalid':
      return <p id="selection-error" role="alert">Choose a listed option and a quantity from 1 to 99.</p>;
    case 'selected':
      return (
        <section aria-label="Selection summary">
          <p>{props.selection.sku} × {props.selection.quantity}</p>
          <output data-total-minor={props.selection.totalMinor}>
            {formatKrw(props.selection.totalMinor)}
          </output>
          <p>This is a price preview. No stock is reserved and no order has been placed.</p>
        </section>
      );
    default: {
      const unreachable: never = props.selection;
      return unreachable;
    }
  }
}

export function ProductPage(props: {
  readonly product: CatalogProduct;
  readonly selection: ProductSelection;
}) {
  const selected = props.selection.kind === 'selected' ? props.selection : undefined;
  const invalid = props.selection.kind === 'invalid';
  return (
    <>
      <h1>{props.product.name}</h1>
      <p>Prices are shown in KRW. Availability is checked when an order is accepted.</p>
      <SelectionSummary selection={props.selection} />
      <form action={`/products/${encodeURIComponent(props.product.slug)}`} method="get">
        <label htmlFor="sku">Option</label>
        <select
          id="sku"
          name="sku"
          required
          defaultValue={selected?.sku ?? ''}
          aria-invalid={invalid}
          aria-describedby={invalid ? 'selection-error' : undefined}
        >
          <option value="" disabled>Choose an option</option>
          {props.product.variants.map((variant) => (
            <option key={variant.sku} value={variant.sku}>
              {variant.label} — {formatKrw((BigInt(variant.priceMinor) - BigInt(variant.discountMinor)).toString())}
            </option>
          ))}
        </select>
        <label htmlFor="quantity">Quantity</label>
        <input
          id="quantity"
          name="quantity"
          type="number"
          min="1"
          max="99"
          step="1"
          required
          defaultValue={selected?.quantity ?? 1}
          aria-invalid={invalid}
        />
        <button type="submit">Check selection</button>
      </form>
      <p><a href="/products">Explore other products</a></p>
    </>
  );
}

export function MissingProductPage() {
  return (
    <>
      <h1>Product not found</h1>
      <p>This product is not currently listed.</p>
      <a href="/products">Return to the shop</a>
    </>
  );
}
```

The screen uses named links and form elements from the beginning. Using a link rather than a `div` with a click handler lets the browser handle new tabs, copying links, and keyboard navigation. Connecting labels to field IDs avoids relying solely on visual proximity to convey meaning. The failure message uses `role="alert"`, and color alone does not distinguish the error state.

Showing a price for every option is deliberate too. Displaying only the cheapest SKU's price prominently and changing the total when another size is selected is easy to implement, but looks like a hidden condition to readers. Because there are few initial products, we display every active option. When products and options reach the hundreds, search and listing pagination need to be redesigned. Do not describe the current 24-product listing limit as a complete large-scale browsing feature.

`formatKrw()` reads a validated decimal string as `bigint` for display. It never goes through `Number`, so even large amounts display exactly. This function is for formatting only; input validation belongs at the public model boundary. Product names are passed as JSX text, so React escapes them. Do not insert operator-entered names as HTML or use `dangerouslySetInnerHTML`.

The current document has no client bootstrap script. Therefore, `defaultValue` sets the initial selection in the server-generated form, and the browser's default behavior handles actual interaction. Submitting the form returns an entirely new GET response. Without maintaining separate price-calculation state on the server and in the browser, keeping the selection in the URL makes refresh and sharing easy to understand.

## Connect the Server and Set Status Codes

The following is the **complete file** `src/storefront/storefront.router.ts`. Every page uses the same document, but this does not replace the existing blog renderer. Because the route explicitly returns `createReactServerEntry()`, it does not need a separate `renderPage` callback.

```ts
import { Inject } from '@fluojs/core';
import {
  createReactServerEntry,
  Path,
  Router,
  type ReactRenderContext,
} from '@fluojs/react';
import { createElement, type ReactElement } from 'react';
import {
  CATALOG_LISTING,
  type CatalogBrowser,
} from '../catalog/catalog.port.js';
import { selectProduct } from './select-product.js';
import {
  CatalogPage,
  MissingProductPage,
  ProductPage,
  StorefrontDocument,
} from './storefront.page.js';

function pageEntry(title: string, page: ReactElement, status = 200) {
  return createReactServerEntry(
    createElement(StorefrontDocument, { title, children: page }),
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

@Inject(CATALOG_LISTING)
@Router('/products')
export class StorefrontRouter {
  constructor(private readonly catalog: CatalogBrowser) {}

  @Path('/')
  async index() {
    const products = await this.catalog.list();
    return pageEntry('Shop', createElement(CatalogPage, { products }));
  }

  @Path('/:slug')
  async show(_input: undefined, context: ReactRenderContext) {
    const slug = context.request.params['slug'];
    if (slug === undefined) {
      throw new Error('Missing route parameter: slug');
    }
    const product = await this.catalog.findBySlug(slug);
    if (product === null) {
      return pageEntry('Not found', createElement(MissingProductPage), 404);
    }
    const url = new URL(context.request.url, 'http://fluo.local');
    const selection = selectProduct(product, url.searchParams);
    return pageEntry(
      product.name,
      createElement(ProductPage, { product, selection }),
      selection.kind === 'invalid' ? 400 : 200,
    );
  }
}
```

For a missing product, specify `status: 404` rather than merely putting an error message in the HTML. Drafts and products no longer public appear as the same "not found" in public reads. If the product exists but the selection is invalid, return the same product screen with 400. Use the status option on `createReactServerEntry` rather than guessing which HTTP status an arbitrary Error name will become.

`http://fluo.local` is only a base address for parsing relative URLs, not a network destination. This code does not fetch from that address. Because it returns an entry after completing the read and selection validation, it can decide that a product is missing or a selection is invalid before sending response headers. This chapter neither checks nor reserves inventory; chapter 7 implements that boundary. Do not catch database outages and convert them to "product not found"; send them through the existing server error handling and observability paths.

The following **complete file** replaces `src/storefront/storefront.module.ts` from Chapter 2. It exports the dynamic React module definition under the same name, so imports in `src/app.ts` continue referencing `StorefrontModule`.

```ts
import { ReactModule } from '@fluojs/react';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CatalogPromotion } from './catalog-promotion.js';
import { StorefrontRouter } from './storefront.router.js';

export const StorefrontModule = ReactModule.forRoot({
  imports: [CatalogModule],
  controllers: [StorefrontRouter],
  providers: [CatalogPromotion],
  exports: [CatalogPromotion],
});
```

The router's dependencies are resolved inside the React module, so put `CatalogModule` in that module's `imports`. Registering the two modules side by side at the root is not a substitute. Retaining the existing `CatalogPromotion` also preserves the path that composes recommendation links for post screens. The blog's server-page composition can pass the public post defined in Chapter 2, obtain the link array, and render ordinary `<a>` elements.

When placing links, do not cover the opening of a post with a sales banner. Show related merchandise to people who have read to the end, and provide one clear shop link in the shared navigation on every page. Keep a way back to `/posts` from the shop too. Just as we have not rebuilt authentication, do not needlessly reset the information structure readers have learned.

## Two Boundaries to Preserve in Vite

This project's execution baseline is Node.js 24 and pnpm 10. If the existing Vite configuration already contains `fluoDecoratorsPlugin()`, do not add it again. The following is a **separate minimal configuration example** showing the essentials of an application server build. It is not an instruction to replace the existing development-server settings and blog client-asset build configuration in `vite.config.ts` wholesale with this file. Compare it with the existing configuration to confirm that the same plugin and server target are preserved.

```ts
import { fluoDecoratorsPlugin } from '@fluojs/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [fluoDecoratorsPlugin()],
  build: {
    ssr: 'src/main.ts',
    target: 'node24',
  },
});
```

The first boundary is decorator transformation. The plugin processes application `.ts` files with Babel's `2023-11` decorator transform before passing them to Vite's subsequent transforms. Test files, declaration files, `node_modules`, and `.tsx` files do not follow this same path. The existing Vitest configuration continues using a separate test transform. Do not enable `experimentalDecorators` or `emitDecoratorMetadata` and mix a different model with standard class-level injection.

The second boundary is assets. The root export of `@fluojs/react` neither locates a manifest on the filesystem nor builds a client bundle. This chapter's server-only shop screens do not need hydration assets, but the existing blog screens may still need them. Do not spread an empty bootstrap array across the whole application configuration and turn the existing authoring screen into a static document too.

To understand what a manifest does, you can create the following **isolated source-contract experiment** as `src/storefront/assets.test.ts`. The hashed filenames here are test inputs, not a claim that actual build files exist. Without reading real assets or running Vite, the experiment checks the boundary that converts an already-read manifest into a list of URLs.

```ts
import { createReactViteAssetManifest } from '@fluojs/react/vite';
import { expect, it } from 'vitest';

it('derives asset URLs from an explicitly supplied manifest', () => {
  const result = createReactViteAssetManifest({
    base: '/static/',
    entries: {
      client: 'src/entry-client.tsx',
      server: 'src/entry-server.tsx',
    },
    manifest: {
      'src/entry-client.tsx': {
        file: 'assets/client.123.js',
        css: ['assets/client.123.css'],
        isEntry: true,
      },
      'src/entry-server.tsx': {
        file: 'assets/server.123.js',
        isEntry: true,
      },
    },
  });

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('Expected a valid asset manifest');
  }
  expect(result.manifest.css).toEqual(['/static/assets/client.123.css']);
  expect(result.manifest.hydrationOptions.bootstrapModules)
    .toEqual(['/static/assets/client.123.js']);
});

it('rejects missing entry selections instead of guessing assets', () => {
  const result = createReactViteAssetManifest({
    entries: {
      client: 'src/entry-client.tsx',
      server: 'src/entry-server.tsx',
    },
    manifest: {},
  });
  expect(result.ok).toBe(false);
});
```

When introducing hydration later, put the CSS from the successful parsing result into the document head in order, pass the hydration options to the server entry, and build the same initial tree in the browser. Hardcoding filename hashes in source or mixing an old manifest with a new server can cause a partial failure where HTML appears but interaction stops working. The parser experiment above verifies URL construction, not whether the files are actually served.

Do not interpolate product names or customer information into `bootstrapScriptContent` either. This option is a boundary that passes trusted scripts through unchanged, not a feature that safely serializes arbitrary data. The current implementation does not use that option and sends only the public HTML generated by the server.

## Check Request Results Before Checking Buttons

The following is the **complete test file** `src/storefront/select-product.test.ts`. It checks whether calculation uses only a SKU selected from the public model. By actually changing values a user can send, it reveals more important boundaries than a test that checks only one click on a valid form.

```ts
import { expect, it } from 'vitest';
import type { CatalogProduct } from '../catalog/catalog.port.js';
import { selectProduct } from './select-product.js';

const product: CatalogProduct = {
  id: 'product-tee',
  slug: 'fluo-logo-tee',
  name: 'Fluo Logo Tee',
  variants: [{
    sku: 'FLUO-TEE-BLK-M',
    label: 'Black / M',
    currency: 'KRW',
    priceMinor: '29000',
    discountMinor: '0',
  }],
};

it('calculates a selection from the server-owned price', () => {
  const query = new URLSearchParams({
    sku: 'FLUO-TEE-BLK-M',
    quantity: '2',
    priceMinor: '1',
  });
  expect(selectProduct(product, query)).toEqual({
    kind: 'selected',
    sku: 'FLUO-TEE-BLK-M',
    quantity: 2,
    totalMinor: '58000',
  });
});

it('uses the same per-unit discount as the cart quote', () => {
  const discounted: CatalogProduct = {
    ...product,
    variants: product.variants.map(variant => ({ ...variant, discountMinor: '1000' })),
  };
  expect(selectProduct(discounted, new URLSearchParams({
    sku: 'FLUO-TEE-BLK-M', quantity: '2',
  }))).toEqual({
    kind: 'selected', sku: 'FLUO-TEE-BLK-M', quantity: 2, totalMinor: '56000',
  });
});

it.each([
  'sku=OTHER-SKU&quantity=1',
  'sku=FLUO-TEE-BLK-M&quantity=0',
  'sku=FLUO-TEE-BLK-M&quantity=1.5',
  'sku=FLUO-TEE-BLK-M&quantity=100',
  'sku=FLUO-TEE-BLK-M&sku=OTHER-SKU&quantity=1',
  'sku=FLUO-TEE-BLK-M&quantity=1&quantity=2',
])('rejects an invalid selection: %s', (query) => {
  expect(selectProduct(product, new URLSearchParams(query)))
    .toEqual({ kind: 'invalid' });
});

it('treats an initial visit as unselected', () => {
  expect(selectProduct(product, new URLSearchParams()))
    .toEqual({ kind: 'none' });
});
```

The first test uses a request with a maliciously altered amount field. The read-only selection screen does not use an unknown price field in its calculation; it uses only the server price found by SKU. This does not mean every write API should allow additional fields under the same policy. Chapter 3's administrator DTO rejects additional properties, while this GET browsing path interprets only the keys needed for calculation. What the two boundaries share is an explicit choice of which fields are authoritative inputs.

For actual request checks, prepare an active SKU with a full price of 29,000 won and a discount of 0 under a `published` product in the development database, then use the existing application's development server. The commands below query only the loopback server and cause no data changes or external payments. Match the example port 3000 to your existing runtime configuration.

```bash
curl -i http://127.0.0.1:3000/products
curl -i 'http://127.0.0.1:3000/products/fluo-logo-tee?sku=FLUO-TEE-BLK-M&quantity=2'
curl -i 'http://127.0.0.1:3000/products/fluo-logo-tee?sku=OTHER-SKU&quantity=1'
curl -i http://127.0.0.1:3000/products/missing-product
```

The expected results are 200 with an HTML Content-Type for the first response, 200 with `data-total-minor="58000"` for the second, 400 for the third, and 404 for the last. In a separate development fixture whose product name looks like an HTML tag, the output must contain escaped text rather than an actual tag. An empty display is an empty state with 200; a database connection failure must not masquerade as an empty display or a 404.

In a browser with JavaScript disabled, follow the product link in a post, the detail link in the listing, and then use the selection form. After submission, the URL must retain the selected SKU and quantity, and the current amount for two shirts must appear. Check that the Tab key alone can move through links, options, quantity, and the button; that Back returns to the listing; and that option names are not clipped on narrow screens. Because this is a GET form, refreshing must not create duplicate orders or retry payments.

After unpublishing a product, a new request to the same detail URL must return 404. After deactivating an option, visiting an old selection URL should return 400 and ask for another selection if the product is still eligible for public display. This observation checks that an old selection retained in the browser cannot bypass the server's current publication conditions. An option being absent from the screen's select element is not a substitute for validation.

For streaming, distinguish when a failure occurs as well. The package distinguishes failures before the shell is created from recoverable rendering failures after a response has started. A status already sent cannot be rewritten later. This screen completes the product read and selection validation before returning the entry, so it does not defer core pricing decisions behind Suspense. Reader disposal following a network disconnect or response-sink failure follows the package contract; screen functions do not close database connections themselves.

The application-request and browser experiments in this chapter are reproduction procedures and expected results. Do not report manuscript validation as actual PostgreSQL, HTTP, or browser execution. The independent unit experiments can be run with `pnpm exec vitest run src/storefront/select-product.test.ts src/storefront/assets.test.ts`, and their success is also separate from evidence of complete screen behavior.

## Now the Need for a Cart Becomes Clear

Server rendering and a GET form suit the current requirement, but they do not cover every shopping interaction. Selecting T-shirts and stickers together, closing a tab and returning later, or checking a total across several products requires a cart that outlives the selection in a single URL. Even then, rather than first treating local state as truth, decide which values the server stores and recalculates.

Carry forward the constraints already established in this chapter. Screens receive only the public model. Prices travel as strings in minor currency units. SKUs are checked against the server's public products. Checking a selection is neither an inventory reservation nor order acceptance. Because the screen preserves these distinctions, there is no fake success path to remove when we add real cart behavior in the next chapter.

The same reasoning explains why we do not immediately add a complex client router or a global state store. Fluo's stable React model is HTTP-first; client navigation and hydration can be explicitly composed when needed. Do not confuse RSC and Server Functions experiments with the default path. Separate the problem answered by current GET browsing from the problem future persistence will answer so that UI technology does not obscure transaction rules.

Readers can now discover merchandise in their familiar blog, choose their size and quantity, and check the current amount. In the next chapter, we move that selection into a cart. At the actual persistence boundary, we explore why storing the total shown by the browser becomes dangerous and which values the server must reread and recalculate.

## Implementation References

- [`@fluojs/react` README](../../packages/react/README.md), [public exports](../../packages/react/src/index.ts): HTTP-first pages, explicit server entries, and the boundary between rendering and hydration.
- [React module implementation](../../packages/react/src/module.ts), [server entry options and implementation](../../packages/react/src/server-entry.ts), [rendering context and status handling](../../packages/react/src/render.ts): imports/providers/exports, status, and HTML response ownership.
- [SSR dispatcher tests](../../packages/react/src/dispatcher-ssr.test.ts), [stream lifecycle tests](../../packages/react/src/render-stream-lifecycle.test.ts): Package evidence for actual HTTP paths and stream disposal.
- [`@fluojs/react/vite` public exports](../../packages/react/src/vite.ts), [manifest tests](../../packages/react/src/vite.test.ts): Explicitly supplied asset manifests and diagnostics.
- [`@fluojs/vite` README](../../packages/vite/README.md), [public exports](../../packages/vite/src/index.ts), [decorator plugin implementation](../../packages/vite/src/decorators-plugin.ts): `.ts` transformation, the Babel peer dependency, and the Vite/Vitest boundary.
- [Product and money implementation](./ch03-catalog-and-money.md), [shared editorial contracts](../EDITORIAL.md): Server authority over pricing and the current implementation stage.

[Previous: Modeling a T-shirt as a Product](./ch03-catalog-and-money.md) - [Volume 2 Contents](./toc.md) - [Next: Why You Cannot Trust Cart Prices](./ch05-cart-and-pricing.md)
