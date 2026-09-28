# Benchmark fixture interface

## 0. Research Log

- Embedded references: Notion, Linear, and GitHub considered; Notion's restrained workspace palette and native control treatment selected for a functional benchmark fixture.
- Layout: StyleGallery's `page-grid` and `tab-strip` patterns inform the content column and persistent jukebox navigation. The document owns scrolling; the audio control stays in the jukebox parent route.
- Lazyweb and concept images omitted: the required seeded content and transport behavior, rather than a new visual identity, define this fixture.

## 1. Atmosphere & Identity

A compact, readable catalog and music workspace. Warm paper surfaces make the seeded content the primary element; the audio transport is the only persistent interactive element.

## 2. Color

| Token | Value | Role |
| --- | --- | --- |
| `--paper` | `#f6f5f4` | Page background |
| `--surface` | `#ffffff` | Panels and fields |
| `--ink` | `#31302e` | Primary text |
| `--muted` | `#615d59` | Secondary text |
| `--line` | `#dedbd7` | Subtle dividers |
| `--action` | `#005bab` | Links and primary controls |
| `--focus` | `#097fe8` | Keyboard outline |

## 3. Typography

System sans-serif; headings 32px/1.2 and 24px/1.3, body 16px/1.5, detail 14px/1.4. No remote font request.

## 4. Spacing & Layout

Four-pixel base unit: 8px controls, 16px inline gaps and panels, 24px section gaps, 32px outer margins. Content max-width 800px; navigation wraps on narrow screens. The document is the only vertical scroll container.

## 5. Components

- **Navigation**: inline links for catalog, editor, and jukebox; wraps; visible focus and active indication.
- **Panel**: neutral card with content and actions; empty and error states remain text, not empty boxes.
- **Form**: explicitly labeled native fields and buttons; browser validation is supplementary to server validation; focus remains visible.
- **Transport**: persistent audio player in the jukebox layout, with play/pause, current track, and event-confirmed state. View links replace only the outlet beneath it.

## 6. Motion & Interaction

No decorative animation. Audio operation state changes only on media events or a rejected `play()` promise; navigation uses router links. Reduced-motion needs no special branch.

## 7. Depth

Single neutral panel treatment with subtle border and soft shadow; no decoration on seeded data rows.

## 8. Accessibility & Accepted Debt

Semantic links, labels, buttons, status text, and keyboard focus outline. Audio is a generated local tone rather than a licensed song recording; the fixture's song titles identify selectable tracks.
