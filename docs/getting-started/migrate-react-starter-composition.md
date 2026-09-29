# Migrate the React starter composition

<p><strong><kbd>English</kbd></strong> <a href="./migrate-react-starter-composition.ko.md"><kbd>한국어</kbd></a></p>

The official `react-vite-ssr` starter now ships product and search pages through one
HTTP-selected SSR, initial hydration, and soft-navigation path. Existing generated apps are
not rewritten. Their low-level `ReactElement`, `ReactServerEntry`, and document navigation
paths remain supported.

For an existing app adopting the new composition:

1. In each `@Path(...)` handler, bind and validate the HTTP DTO as before. Build one
   JSON-only `props` object and return
   `ReactNavigationPage.create(createElement(Page, props), { module: './page-name.tsx', props })`.
   Keep server-only services, DI instances, credentials, and secrets outside props.
2. Put client-renderable pages under `src/page*.tsx`, each exporting a default component
   that accepts the selected JSON props. Use `import.meta.glob('./page*.tsx')` in
   `src/entry-client.tsx`; give that build-produced map to `ReactClientRouterProvider`.
   Validate the selected module against the loaded production Vite manifest or the
   development importer set before streaming HTML.
3. Update the application `ReactPageRenderer` to accept the optional fourth
   `ReactInitialNavigationPage` argument. Render its `json` verbatim in an inert
   `<script type="application/json" id="fluo-initial-page">`; do not stringify, encode
   again, or place data in executable inline JavaScript. The runtime has already
   normalized props as JSON and escaped the transfer with a 64 KiB UTF-8 cap before
   HTML response commit. The first browser entry resolves that script through
   `loadReactInitialNavigationDestination(json, modules)` and hydrates the returned
   component with the payload URL, params and props.
4. Keep shared shell/providers outside the provider's destination page slot; render
   `destination ?? initialPage` inside it. On the existing provider, pass
   `failurePolicy={({ reason }) => reason === 'network' || reason === 'server-error' || reason === 'import-failure' ? 'preserve' : 'document'}`;
   place `useNavigation().failure` controls calling `router.retry()` and
   `router.openDocument()` in the persistent shell, outside the destination slot.
   Existing `Link` and `useRouter()` make
   approved soft moves, while direct GET, early clicks, disabled JavaScript, and
   unsupported destinations (including absent importer keys) retain the native document path.

The generated `src/app.ts`, `src/entry-server.tsx`, `src/react-app.tsx` and
`src/entry-client.tsx` are runnable examples of these connections. Adding a page
does not require changing the latter three files or creating another route matcher.
The generated starter selects transient-failure preservation by default; existing applications
must add the policy and controls in step 4 explicitly. A low-level provider without that
policy still loads a document on failed navigation. This migration does not opt into #3873's
soft revalidation, #3874's form enhancements, or stable RSC.

Verify `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm start`, and
`pnpm test:browser` in the generated app. Browser tests should check both direct
HTML hydration and the `Accept: application/vnd.fluo.react-navigation+json;v=1`
request made by each soft transition.

## Observed authoring cost

In a clean generated project, the second search page uses `src/page-search.tsx`
and a `SearchPageRequest`/`SearchPageRouter` in `src/app.ts`. Its `q` query is
bound and validated by `@FromQuery('q')` and `@RequestDto(...)`; neither page
duplicates the DTO as a client interface. A consumer experiment then added a
third note page with a native save form and an editor guard. Comparing its
generated source to the two-page starter showed exactly three touched files:
`src/app.ts` (new path/body DTOs, HTTP GET/POST, guard, registration),
`src/page-note.tsx` (new page and native form), and `src/page.tsx` (an optional
link to the note). It changed **zero** renderer, client-entry, manifest, router
store, or generated type files. The page accepts JSON props as
`Record<string, unknown>` and narrows fields at use; #3880 owns a future typed
projection, not another authoring path or a required unsafe cast.

The independent generated consumer ran `pnpm typecheck && pnpm build` with exit
code `0`, then passed five Chrome cases for the two existing pages, the third
HTTP-approved page, denied and invalid native saves, and an authorized
JavaScript-disabled `POST` → `303` → `GET`. Two further Chrome HTTP probes sent
HTML-breaking search input and a deliberately oversized destination: the initial
script preserved the JSON data without a literal closing-script injection, and
the oversized page returned a non-HTML `500` before committing its shell.
This is an authoring-cost experiment,
not a promise of a built-in auth or enhanced form policy: applications still
implement identity, persistence, and validation messages; #3874/#3875 own the
official form/auth integration.
