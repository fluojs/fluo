# Fluo documentation design

## 1. Atmosphere and identity

An English developer handbook, inspired by the reading hierarchy of NestJS
documentation rather than a pixel clone. The live Controllers page was inspected
on 2026-09-21: grouped sidebar, prominent article heading, sequential prose and
code, restrained active-page highlight. Keep Fluo's blue identity, not Nest's
logo, copy, or red palette. Existing Fumadocs navigation, search, code blocks,
table of contents and mobile controls remain reusable primitives.

Primary readers are a first-time backend developer following a small example
and an experienced developer looking up an exact contract. Both must find the
recommended path without knowing the package names.

## 2. Color

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#ffffff` | `#101827` |
| Sidebar and code surface | `#f5f7fb` | `#172238` |
| Primary text | `#18243a` | `#edf3ff` |
| Secondary text | `#52617a` | `#afbdd4` |
| Border | `#dbe3f0` | `#31425e` |
| Link and focus | `#1d4ed8` | `#80b4ff` |
| Active background | `#eaf1ff` | `#203654` |

Expose these through the existing `--color-fd-*` variables. Blue identifies
links, focus and selection, never a paragraph of decorative text. Syntax
highlighting retains Fumadocs' accessible light/dark themes.

## 3. Typography

Use a local system sans stack for body and navigation, and the system monospace
stack for code. No remote font is necessary for reading documentation.
Body: 16px, line height 1.8. Lead: 18px, line height 1.65. Heading: 36px on
wide screens and 30px on narrow screens, weight 650, line height 1.2.
Section headings: 26px/1.3; subsection headings: 20px/1.4.
Navigation: 14px/1.5. Metadata and code: 13px/1.6.

## 4. Spacing and layout

Use 4px steps: 4, 8, 12, 16, 24, 32, 48, 64. Keep Fumadocs' responsive shell:
sidebar at desktop, a mobile menu below its native breakpoint, and a sticky
right-hand table of contents when space permits. Article measure is 760px.
The document owns article scrolling; sidebar and table of contents independently
scroll only when their content exceeds the viewport. Code and tables may scroll
horizontally inside their own containers, never widen the document.

## 5. Components and states

- **Document shell:** existing DocsLayout, grouped page tree, search, theme
  switch and mobile navigation. Active item has blue text and tinted fill;
  hover remains distinct and focus has a visible outline.
- **Article:** existing DocsPage, title, description, body and table of contents.
  Heading anchors and previous/next links are actual links.
- **Code example:** Fumadocs fenced block with filename where relevant,
  copy control and local horizontal scrolling. Prose names prerequisites and
  whether a snippet is complete or belongs inside an existing class.
- **Reference table:** semantic header cells, readable padding and bounded
  horizontal scroll for wide data.
- **Callout:** a short limitation or prerequisite, not a substitute for the
  main explanation. Do not communicate severity through color alone.

The five representative pages form the real-content state harness. Check
navigation closed/open, search empty/results/no-results, light/dark themes,
keyboard focus, long code and tables at narrow/tablet/wide widths.

## 6. Motion and interaction

Reuse Fumadocs' accessible search and disclosure interactions. No new decorative
animation, parallax or heading reveal. Respect reduced-motion preferences.
Every interactive appearance must correspond to a real action.

## 7. Accessibility

Preserve semantic landmarks, unique page headings, descriptive links, accessible
search controls and keyboard navigation. Use visible focus outlines with 3px
offset. Body links are underlined. Mobile reading must work at 375px without
document-level horizontal overflow. Test menu dismissal, search selection,
copy controls and table-of-contents links in the rendered browser.

## 8. Scope, evidence and debt

This increment covers the shared reading surface and five representative pages,
not a claim that all existing content has been rewritten. The capability map
tracks remaining content work separately. Preserve legacy URLs and Korean
repository/Book sources while English becomes the new website authoring path.
No accessibility debt is accepted in advance. Record concrete verification
results and any unavailable audits in the implementation evidence report.
