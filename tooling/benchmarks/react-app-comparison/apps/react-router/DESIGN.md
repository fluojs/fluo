# Benchmark app visual contract

This is an operational fixture, not a marketing page. The catalog, editor forms,
and jukebox use the same restrained paper surface.

- Canvas: warm off-white `#f7f5f0`; ink: `#222a31`; muted ink: `#5d6870`.
- Actions: deep blue `#225c77`, with white text; focus ring: `#225c77`.
- Spacing: a 4 px base, 16 px controls, 24 px section gaps, and 48 px page margin.
- Typography: system sans for controls, Georgia for primary headings.
- Primitives: nav links have hover/keyboard-focus states; form controls expose
  labels and native validation; player buttons expose state in adjacent status.
- Responsive: content is at most 720 px wide and page padding contracts on
  narrow screens. Jukebox navigation wraps instead of overflowing.
- Motion: none; audio playback is acknowledged by the media element's events.
- Accessibility: visible focus ring, semantic headings, labeled fields and
  media state announced through `role="status"`.
- Accepted debt: generated tones represent local audio resources rather than
  licensed recordings; the fixture evaluates persistent media operation.
