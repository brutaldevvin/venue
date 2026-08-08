# Bundled fonts

Both families are vendored rather than loaded from a CDN, so a font that fails to fetch
cannot degrade the demo. Both are licensed under the SIL Open Font License 1.1, which
permits bundling and redistribution provided the licence travels with them.

| File | Family | Weight | Source | Licence |
|---|---|---|---|---|
| `inter-400.woff2` | Inter | 400 | https://github.com/rsms/inter | OFL 1.1 |
| `inter-700.woff2` | Inter | 700 | https://github.com/rsms/inter | OFL 1.1 |
| `jbmono-400.woff2` | JetBrains Mono | 400 | https://github.com/JetBrains/JetBrainsMono | OFL 1.1 |
| `jbmono-500.woff2` | JetBrains Mono | 500 | https://github.com/JetBrains/JetBrainsMono | OFL 1.1 |

Licence text: https://openfontlicense.org

These are the Latin subsets. Glyphs outside that range, such as the tape's lapse marker,
are rendered in the system monospace stack instead, because the fallback for a missing
glyph is a visibly wrong character.
