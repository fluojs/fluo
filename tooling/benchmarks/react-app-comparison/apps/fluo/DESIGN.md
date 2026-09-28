# Benchmark app design

## 0. Research Log

The canonical `examples/react-vite-ssr` pattern supplies the runtime and markup reference. External visual research and image drafts are intentionally excluded from this matched-workload benchmark: different assets would invalidate the cross-framework comparison.

## 1. Atmosphere & Identity

A restrained, functional catalog and jukebox; the common navigation and native forms make every benchmark task discoverable without introducing decorative assets.

## 2. Color

Canvas `#faf9f5`, ink `#252b2a`, muted `#525f5b`, panel `#ffffff`, line `#d9e1dc`, accent `#12664e`, focus `#155eef`. The same tokens apply to all screens.

## 3. Typography

System sans, body 16px/1.5, heading 32px/1.2, section heading 22px/1.3, caption 14px/1.4.

## 4. Spacing & Layout

Base unit 4px; a single 880px maximum-width column with 16px mobile gutters and 24px desktop gutters.

## 5. Primitives & States

Navigation links retain native anchor behavior, with underline on hover and focus. Panel lists have a subtle line and white fill. Native labeled inputs and buttons use 12px padding and a visible focus ring. The resource button displays its operation acknowledgement in a live region. Disabled and loading states use native control semantics.

## 6. Motion

No decorative motion; native navigation and the audio resource remain functional with reduced motion.

## 7. Responsive & Accessibility

Navigation wraps on narrow viewports. Every form input has a label; each route has one main landmark and a heading. Links and buttons are keyboard reachable.

## 8. Boundaries & Debt

No external visual assets or dev-only instrumentation enter the production comparison. Dynamic song playback is outside the fixture; the resource's observable operation is an actual HTMLAudioElement volume change.
