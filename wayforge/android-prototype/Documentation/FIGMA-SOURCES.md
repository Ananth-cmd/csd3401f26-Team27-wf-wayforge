# Figma references

Source: [Wayforge-SIT](https://www.figma.com/design/kAnL2j9Ko6bOkvhHYttL3G/Wayforge-SIT?node-id=27-16).

Screens used: `27:16` Explore, `27:118` Search, `27:174` Destination, `30:1571` Route, `30:235` Guidance, `4:13` Arrival, `4:15` Preferences. The Ryot Games Studio variation supplies the demo's Board Room, Game Room and Pantry names. Where the design contains inconsistent floor labels, the app derives labels from its building data.

The layout is adapted into responsive Unity UI Toolkit containers, with real building geometry replacing the design's static map imagery. The font fallback is Unity's bundled runtime font. Brand/background tokens are `#006B5E`, `#102E2B`, `#617873`, `#F5F8F8`, `#EAF1EF`, `#DDF1E9`.

Original icon vector exports are retained unchanged in `FigmaAssets`. Their raster versions are rendered at four times their original dimensions for crisp Android presentation; the UI uses the original design slot sizes (mostly 21/22px, direction 30px and arrival 36px). They do not require remote URLs at runtime.

| Icon | Figma node | App usage |
|---|---|---|
| search | 27:24 | Explore search field |
| locate | 27:64 | Set start, recenter, location preferences |
| chevron | 27:77 | Destination rows |
| pin | 27:72 | Destination/start rows |
| map | 27:87 | Explore navigation and map preference |
| saved | 27:91 | Saved navigation |
| settings | 27:95 | Settings navigation |
| back | 27:123 | Screen headers |
| close | 27:132 | Retained source asset; not needed by the adapted search field |
| arrow | 30:244 | Guidance card |
| check | 7:250 | Arrival badge |
| walk | 7:351 | Route preference |
