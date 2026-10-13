# Venue — design system

Everything the frontend needs, decided. Reference: notion.com/product/dev. Nothing here should
require a judgement call at build time.

Deliberately unlike Surety. Venue is indigo and lavender, monospace-forward, dotted hairlines.
Surety is true black, acid lime, brutalist. Separate submissions; they must not read as one product.

---

## 0. Direction

**A developer-platform page that happens to be an order book.**

Notion's dev page does four things, and all four transfer:

1. **Saturated indigo as a field, not an accent.** Whole sections are `#1E1EBE` with white content
   sitting on them. Other sections invert to near-white lavender with indigo type. The blue is the
   ground, not a highlight.
2. **Monospace as a primary UI typeface.** Navigation reads `[S] Syncs`, `[A] Agent tools`.
   Diagram labels, section captions, endpoint lists, status text — all mono. Sans is reserved for
   headlines and body prose.
3. **Dotted hairline borders.** Logo grids, diagram containers, connector lines. It is the single
   most identifiable device on the page and it costs one CSS property.
4. **Bold sans headlines in indigo**, tight tracking, on pale grounds.

That register suits Venue better than a trading terminal would. The submission's audience is a
transfer agent evaluating infrastructure, and every competing project will ship a dark exchange UI.
An indigo developer-platform aesthetic reads as *infrastructure you would integrate*, which is what
Venue is claiming to be.

**Colour still means compliance state.** The palette is nearly monochrome by design — indigo,
lavender, white — so the one warm accent carries enormous weight. Use it only when a rule binds.

**The hardest problem remains absence.** "Ineligible liquidity is absent, not greyed out" is the
thesis. Section 4 handles it. Do not grey rows: that leaks the book and contradicts the submission.

---

## 1. Tokens

```css
:root {
  --indigo:      #1e1ebe;   /* the field. also headings and cleared state */
  --indigo-deep: #16169a;   /* hover, pressed */
  --ground:      #f5f5fa;   /* pale lavender page */
  --card:        #ffffff;   /* panes and cards */
  --on-indigo:   #ffffff;   /* content on an indigo field */

  --body:        #4a4a7a;   /* secondary prose */
  --muted:       #8a8ab5;   /* mono labels, timestamps, captions */
  --line:        #d9d9ec;   /* 1px hairlines */

  --bound:       #e97366;   /* a rule bound. the ONLY warm colour */

  --font-ui:   'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  --r-sm: 4px;  --r-md: 6px;  --r-lg: 10px;
}
```

**Two modes, like the reference.** `.field` is indigo ground with `--on-indigo` content; default is
`--ground` with indigo type. Chrome and the audit strip are fields; the panes are cards.

**Mono is not just for numbers.** Every label, caption, status, viewer name, rule name, constraint
and endpoint is mono at 11px, `--muted`, often uppercase with `0.04em`. Sans appears only in
headlines and the few sentences of prose. Getting this ratio right *is* the aesthetic — if it looks
like too much mono, it is correct.

**Dotted borders are the signature.** `border: 1px dashed var(--line)` on containers that group
rather than contain — the pane grid, the audit regions, the rule strip. Solid hairlines for cards
and rows. Use dotted deliberately, not everywhere.

**Headlines:** Inter 700, `letter-spacing: -0.035em`, `--indigo`. Big. The reference is not shy.

**Density.** 4px base. Ladder rows 26px, chips 22px, card padding 20px, page gutter 32px.

---

## 2. The mark

**`[V]`** — a bracket key. It lifts the reference's most characteristic device (`[S] Syncs`,
`[A] Agent tools`) and it happens to be exactly right for this product: brackets are set notation,
and Venue's thesis is that *the set of parties who can legally settle is the set the book was
projected for*.

```svg
<!-- 24x24, currentColor -->
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g stroke="currentColor" fill="none" stroke-linecap="butt">
    <path d="M8 3.5 H5.6 V20.5 H8" stroke-width="1.7"/>
    <path d="M9.3 3.5 L12 19.4 L14.7 3.5" stroke-width="2.4" stroke-linejoin="miter"/>
    <path d="M16 3.5 H18.4 V20.5 H16" stroke-width="1.7"/>
  </g>
</svg>
```

Brackets are lighter than the V — 1.7 against 2.4 — so the letter reads first and the brackets
frame it. Keep that ratio at every size.

**Lockup:** mark, 16px gap, `Venue` in Inter 700, `letter-spacing: -0.038em`. Indigo on pale, white
on indigo. The mark inherits `currentColor`, so the lockup inverts with its container.

**Files** in `brand/`:
- `venue-icon.svg` / `.png` — 512x512, white on `#1E1EBE`, radius 112. The form upload.
- `venue-mark.svg` — 24x24, `currentColor`, transparent.
- `venue-lockup.svg` / `.png` — horizontal lockup.

Verified at 96, 48 and 32px.

**The bracket device extends into the UI.** Viewer panes are labelled `[A]`, `[B]`, `[C]`; the asset
switcher is `[/]`. It ties the mark to the interface for free.

---

## 3. Layout

```
╔═══════════════════════════════════════════════════════════════╗  indigo field
║ [V] Venue     RVS · ReVault Reg S T-Bill              [/]     ║  56px
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║  --ground
║ ┌─ [A] VIEWER ────┐ ┌─ [B] VIEWER ────┐ ┌─ [C] VIEWER ──────┐ ║  white cards,
║ │ tier 34 · US    │ │ tier 34 · DE    │ │ unverified        │ ║  1px --line
║ │ ┌ rule strip ─┐ │ │ ┌ rule strip ─┐ │ │ ┌ rule strip ─┐   │ ║
║ │                 │ │                 │ │                   │ ║
║ │  depth ladder   │ │    (absent)     │ │     (absent)      │ ║
║ │                 │ │                 │ │  Get verified →   │ ║
║ │  order ticket   │ │                 │ │                   │ ║
║ └─────────────────┘ └─────────────────┘ └───────────────────┘ ║
╠═══════════════════════════════════════════════════════════════╣  indigo field
║ TAPE                                                    [⌄]   ║  240px
╚═══════════════════════════════════════════════════════════════╝
```

Three white cards on `--ground`, 1px `--line`, `--r-lg`, 20px padding, 16px gutters. The three
together sit inside a `1px dashed --line` container — the grouping device from the reference's
diagrams, and it says "one book, three views" without a caption.

Card headers: `[A] VIEWER` in mono 11px uppercase `--muted`; credential beneath in mono 12px
`--body`.

---

## 4. Components

### Rule strip
Five chips per card, mono throughout, `--r-sm`, 22px.

- Satisfied: `--ground` fill, 1px solid `--line`, value in `--indigo`.
- Binding: 1px solid `--bound`, value in `--bound`, fill stays `--ground`.
- Firing now: fill flashes `--bound` at 12% for 400ms, then settles to binding.

Labels mono 10px uppercase `--muted`; values mono 11px.

### Depth ladder
Bids below, asks above, 1px `--line` mid-market rule. 26px rows, everything mono.

- Price right-aligned `--indigo`; size `--body`.
- Depth bar behind each row: `--indigo` at 6%, scaled to largest visible size. Texture, not chart.
- Hover fills `--ground`. **Never reveal counterparty identity**, including on hover — a design
  decision with a compliance reason, and someone will ask.

### The empty book — the important one
When a viewer fails the asset's RuleV2, the ladder region shows a `1px dashed --line` box, centred,
containing:

> `no eligible liquidity`
> `credential does not satisfy rule set`
> `sub-tier 34 · required >= 70`

All mono, `--muted`, 12px, left-aligned inside the dashed box — and that constraint's chip
simultaneously `--bound`. No spinner, no skeleton, no warning glyph, nothing red.

The dashed box is doing real work: on the reference, dashed containers mean *a defined region that
is currently empty*. That is precisely the state, and it reads as deliberate rather than broken.

Unverified viewers get `Get verified →` in `--indigo` on the last line — the registry's link, and
the only place it appears.

### Order ticket
Eligible cards only. Side toggle, price, size, estimated fill, one solid `--indigo` button with
`--on-indigo` label. Disabled: `--muted` on `--ground`.

### Tape
Indigo field, full width, collapsible, mono 11px `--on-indigo`, newest first.

| | Treatment | Content |
|---|---|---|
| fill | white text | price, size, both legs, Travel Rule ref, tx hash |
| skipped | 2px `--bound` left border, rule name in `--bound` | the order passed over **and the rule that skipped it** |
| lapse | white at 70%, `↺` prefix | maker credential lapsed, order withdrawn |
| refusal | white at 55% | pre-trade refusal, no funds moved |

On an indigo field, coral is unmissable. The skipped row is the demo's money shot and this is why
the tape is a field rather than a card.

---

## 5. The four demo beats

**1. Three books.** All three cards render on load already different. Do not animate them in
sequence — the contrast is the first impression.

**2. The holder cap binds.** Cap chip flashes then goes `--bound`; a `skipped` row enters the tape
naming the rule. 400ms ease-out. The only moment that deserves motion.

**3. A credential lapses.** The resting order fades over 300ms; a `lapse` row enters the tape.

**4. A fill settles.** A `fill` row enters with the tx hash as a link to MonadScan, both legs on one
line.

---

## 6. Motion

Flashes 400ms ease-out, row entries 300ms, everything else instant. No page transitions, no
parallax, no scroll-triggered anything. Motion means state changed — if a judge sees movement,
something happened.

`prefers-reduced-motion`: opacity only, keep the colour changes.

---

## 7. Implementation

```js
// tailwind.config.ts — theme.extend
colors: {
  indigo:'#1e1ebe', 'indigo-deep':'#16169a', ground:'#f5f5fa', card:'#ffffff',
  'on-indigo':'#ffffff', body:'#4a4a7a', muted:'#8a8ab5', line:'#d9d9ec', bound:'#e97366',
},
fontFamily: {
  ui:['Inter','ui-sans-serif','system-ui','sans-serif'],
  mono:['JetBrains Mono','ui-monospace','monospace'],
},
borderRadius: { sm:'4px', md:'6px', lg:'10px' },
```

Inter is already in `brand/fonts/`. Copy it and JetBrains Mono into `apps/console/public/fonts`,
`font-display: swap`, self-hosted. **No CDN** — a font that fails mid-demo costs more than the
download.

**Build order.** Tokens, the two modes and the dashed-container primitive first (30 min) — the last
one is used by four components. Then the ladder and rule strip, which carry beats 1 and 2. Then the
tape. Ticket and audit view are cuttable; ladder and rule strip are not.

**Time budget: 6 hours, and it is the last thing that gets more.** If a component matches its
description above, stop.

---

## 8. What to avoid

- Greying out ineligible rows. It leaks the book and contradicts the submission.
- Using sans where mono belongs. Labels, statuses, rules and numbers are all mono; sans is
  headlines and prose only. This ratio is the aesthetic.
- A second accent colour. Coral is the only warm thing in the product; a second one halves its
  force.
- Dotted borders everywhere. They mean *grouping* or *defined-but-empty*. Solid means contains.
- Revealing counterparty identity anywhere, including hover and the tape.
- Shadows. The reference uses lines and fields, never elevation.
- A dark theme, or a warm neutral. The palette is cool indigo and lavender throughout.
