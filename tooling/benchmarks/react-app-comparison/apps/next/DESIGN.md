# Benchmark Next application

## 0. Research Log

- Reference: the shared fixture and HTTP contract specify a small operational catalog and jukebox; no visual reference or research assets were supplied.
- External visual research and image generation are omitted: this is a bounded comparison fixture, and neither is needed to establish its functional UI.

## 1. Atmosphere & Identity

A compact, legible catalog with a distinct dark listening room. Product data and playback status are the focal points, not decoration.

## 2. Color

| Token | Value | Purpose |
| --- | --- | --- |
| `--canvas` | `#f5f3ed` | Page background |
| `--paper` | `#ffffff` | Raised content |
| `--ink` | `#192521` | Primary text |
| `--muted` | `#52645b` | Supporting text |
| `--accent` | `#125a43` | Actions and links |
| `--line` | `#d7ded5` | Dividers |
| `--night` | `#13231f` | Listening room |
| `--light` | `#f2f5ea` | Listening room text |

## 3. Typography

System sans-serif for UI; system monospace for identifiers. Titles use 2rem/1.2; headings 1.35rem/1.3; body 1rem/1.5; metadata 0.875rem/1.4. Body never drops below 14px.

## 4. Spacing & Layout

4px base unit. Page width 68rem; 24px mobile padding, 40px desktop padding; cards 24px internal spacing; 16px gaps. The page scrolls normally, with responsive wrapping below 680px.

## 5. Primitives & States

- Navigation links: clear underlined focus and current route announcement.
- Product row: name and SKU, a full detail link, and a divider; absent items produce 404.
- Form: explicit labels, native inputs and submit buttons; invalid writes return 400.
- Player: native audio-backed play/pause buttons; status text acknowledges media events and errors; active view content changes without replacing the player.

## 6. Motion

No ambient motion. Control state is immediate; reduced-motion preferences need no special treatment.

## 7. Responsive & Accessibility

One column on phones, a two-column reading area where space permits. Semantic headings, named form fields, keyboard-focusable links and buttons, and a live playback status.

## 8. Accepted Debt

The jukebox uses an embedded generated audio tone rather than a licensed music asset so the benchmark remains standalone and offline.
