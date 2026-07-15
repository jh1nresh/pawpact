# PAWPACT accessibility audit — initial violations

Date: 2026-07-15

Automated axe scan was unavailable in the zero-dependency harness. Findings below come from the in-app browser accessibility tree, focus-state inspection, and a mobile target-size measurement at 390 × 844 CSS pixels.

## A11Y-01 — focus is lost after replacing interactive controls

Observed after both recruiting and selecting a bench unit: `document.activeElement` became `BODY`.

```js
button.addEventListener("click", () => {
  const receipt = buyShopUnit(game, index);
  announce(receipt.message);
  renderAll();
});
```

```js
button.addEventListener("click", () => {
  selectedInstanceId = selectedInstanceId === unit.instanceId ? null : unit.instanceId;
  announce(...);
  renderAll();
});
```

Required fix: identify roster and board controls with stable data attributes and move focus to the newly recruited bench unit, the first valid placement cell, or the control that logically replaces the removed element.

## A11Y-02 — mobile board and skip-link targets are below 44 px

Measured mobile targets: every enabled player board cell was 57 × 38 px; the skip link was 96 × 42 px.

```css
.board-cell {
  aspect-ratio: 1.52;
}

.skip-link {
  padding: 10px 16px;
}
```

Required fix: give board cells a 44 px minimum height and increase skip-link vertical padding.

## A11Y-03 — `aria-disabled` disagrees with actual refresh behavior

When gold is below two, the refresh button remains clickable to announce the reason, but is exposed as disabled to assistive technology.

```js
refs.refresh.disabled = game.phase !== "prep";
refs.refresh.setAttribute("aria-disabled", String(game.phase !== "prep" || game.gold < 2));
```

Required fix: keep `aria-disabled` aligned with the native `disabled` state; low-gold attempts stay operable and announce the insufficient-funds message.

## A11Y-04 — empty bench slots add non-interactive screen-reader noise

The accessibility tree exposes up to eight generic labelled elements that cannot be acted on.

```js
const empty = makeElement("span", "bench-slot bench-slot--empty");
empty.setAttribute("aria-label", `空的備戰位置 ${index + 1}`);
```

Required fix: mark decorative empty slots as hidden from assistive technology; capacity remains available through the roster controls and visual layout.

## A11Y-05 — enemy preview names rely on `title`

```js
const item = makeElement("span", "enemy-chip");
item.title = `${definition.name}，${unit.star} 星`;
```

Required fix: add an explicit accessible name in addition to the optional hover title.

## A11Y-06 — closing the game-over dialog does not restore focus

```js
refs.dialog.addEventListener("close", () => {
  if (game.phase === "result") refs.primary.focus();
});
```

Required fix: restore focus to the primary action for both result and game-over phases.

## A11Y-07 — primary coral action contrast is below 4.5:1

Measured `#fff7e7` on `#ce5061` at 3.99:1.

```css
--coral-deep: #ce5061;
```

Required fix: deepen the coral token while preserving the visual direction; `#bd4356` yields 4.81:1.

## Post-fix receipt

- Mobile target scan at 390 × 844: zero enabled buttons or links below 44 × 44 px.
- Recruit flow: focus moves from the removed shop card to the recruited bench button.
- Select flow: focus moves to the first valid placement cell; deploy flow preserves focus on the occupied cell.
- Empty bench slots are `aria-hidden`; enemy previews have explicit accessible names.
- Refresh `aria-disabled` now matches native `disabled`.
- Dialog close restores focus in result and game-over phases.
- Contrast: CTA 4.81:1, muted panel text 9.06:1, shop copy 6.07:1.
