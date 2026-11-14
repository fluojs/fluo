---
"@fluojs/http": patch
---

Share strict Accept media-range and quality parsing between success and error negotiation. Ignore malformed ranges, invalid qvalues, and duplicate quality parameters individually, returning canonical JSON 406 without invoking the HTML provider when no acceptable offer remains.
