src/game-data.js:L10-137: delete: eight unit `id` fields duplicate their `UNIT_LIBRARY` keys and have no reader. The map keys remain the canonical IDs.
src/game-engine.js:L76-78,L255-273,L541,L607-621: delete: `shopId`/`shopRoll`, `version`, battle `instanceId`/`acted`, and persistent `lastMerge` are bookkeeping with no external reader. Keep combat state and return a local merge receipt.
src/game-engine.js:L129-131,L306-318,L517-520: shrink: five `slice()` clones precede `sort()` on arrays already freshly created by grouping or filtering. Sort those arrays directly.
src/game-engine.js:L289-291: yagni: `battleRandom` is a one-line wrapper with one caller. Call `nextRandom(battle)` directly.
src/game-engine.js:L628-630,src/app.js:L21,L480: yagni: `restartGame` has one implementation and forwards its argument unchanged. Call the already-imported `createGame` directly.
src/app.js:L112-119: yagni: `phaseCopy` is a one-caller lookup wrapper. Inline the four-state lookup in `renderHud`.
src/app.js:L280,L405: delete: `has-unit`, `has-{team}-unit`, and the primary button's `data-phase` hooks are emitted but never queried or styled. Nothing replaces them.
src/app.js:L378-380,styles.css:L800-804: native: `aria-disabled` mirrors a native disabled button solely for CSS. Style `.icon-button:disabled` and remove the mirrored attribute state.
styles.css:L4-16,L605-608: delete: `--ink-soft`, `--panel-raised`, `--coral`, and the regular portrait variant are declared but never consumed. Nothing replaces them; require the already-passed portrait size.
styles.css:L47-56: shrink: resets cover `input`, `select`, and `textarea` elements that do not exist, then reopen `button`. One `button` rule carries `font` and `color`.
styles.css:L1276-1288: delete: infinite `pet-bob` is decorative constant motion, not a battle-state cue. Nothing replaces it; keep the result reveal only.
index.html:L124-127,src/app.js:L52,L127,styles.css:L991-1007: delete: the developer-facing engine/seed footer duplicates external test receipts and adds product chrome, styling, and DOM plumbing. Keep determinism in the engine and tests.
scripts/validate.mjs:L78-79: delete: source-text assertions for the exact board-loop spelling duplicate behavioral browser coverage and constrain implementation shape. Keep the 30-cell concept check and functional smoke test.
net: -83 lines possible.
