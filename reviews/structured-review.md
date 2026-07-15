# PAWPACT structured review

Date: 2026-07-15
Scope: correctness, state transitions, security, accessibility, responsive behavior, and PM brief acceptance criteria
Mode: independent read-only review; no implementation files changed

## Verdict

**PASS** — both requested changes were resolved with regression coverage, and the full harness passes after the fixes.

Original finding count: 0 Critical, 0 High, 1 Medium, 1 Low. Open finding count: 0.

## Findings

### SR-01 — Medium — moving a deployed unit onto an occupied slot can exceed the bench limit

- Category: correctness / state transition
- Location: `src/game-engine.js:194-201`
- Requirement affected: PM brief `Game rules for MVP` bench capacity and acceptance criterion 3's deployment state integrity.
- Evidence: `deployUnit` exempts an already-deployed unit from the field-limit check, then unconditionally assigns the destination occupant to `slot = null`. If the bench already contains eight units, this creates a ninth bench unit.
- Reproduction:

  ```js
  const game = createGame(7);
  game.roster = [];
  for (let i = 0; i < 8; i += 1) addRosterUnit(game, i % 2 ? "shiba-dog" : "orange-cat");
  const mover = addRosterUnit(game, "british-cat", 1, 20);
  addRosterUnit(game, "corgi-dog", 1, 21);
  const receipt = deployUnit(game, mover.instanceId, 21);
  console.log(receipt, getBench(game).length);
  ```

  Observed receipt: `{"ok":true,"message":"英短盾已上場。"}`. Observed bench count: `9`; `BENCH_LIMIT` is `8`.
- Impact: the exported engine transition can create an invalid roster and break the capacity assumptions used by recruiting and recall. The current UI only selects bench units for deployment, so the ordinary click flow does not currently expose this path; the engine invariant is still unsound and will surface as soon as field-to-field repositioning is added.
- Minimal fix: preserve the mover's previous slot and swap the occupant into it when both units are deployed; for a bench-to-field placement, keep the current occupant-to-bench behavior. Add a regression test with eight bench units and two deployed units, asserting bench count stays at eight and deployed slots remain unique.

### SR-02 — Low — idle units run an infinite decorative animation contrary to the motion contract

- Category: acceptance criteria / accessibility-adjacent motion
- Locations: `styles.css:1276-1288`; prep tokens are rendered at `src/app.js:264-282`.
- Requirement affected: PM brief `Screen contract` line 84 says no decorative constant motion; `Motion harness` lines 113-117 says motion is occasional during battle and absent during idle preparation.
- Evidence: under `prefers-reduced-motion: no-preference`, every board portrait receives `animation: pet-bob 900ms ease-in-out infinite alternate`. The selector is not phase-scoped, so a unit deployed during preparation continues bobbing while the game is idle.
- Reproduction: run the app with normal motion preferences, recruit and deploy one unit, then stop interacting. Its board portrait continues animating indefinitely.
- Impact: this does not affect deterministic combat and reduced-motion users are protected, but it conflicts with the authored motion contract and adds attention noise during composition decisions.
- Minimal fix: replace the infinite idle loop with a single short action-linked animation. Because battle cells are rebuilt on each discrete tick, `animation-iteration-count: 1` is sufficient to provide a movement cue without constant idle motion; alternatively phase-scope a one-shot class to battle updates.

## Resolution receipt

- SR-01: resolved by swapping the destination occupant into the mover's previous slot. A regression with eight bench units plus two deployed units first failed with `null !== 15`, then passed after the fix; bench capacity remains eight.
- SR-02: resolved by removing the infinite portrait animation. The result dialog keeps its one-shot reveal, and the reduced-motion override remains intact.
- Post-fix `npm run check`: exit 0; 8/8 tests passed; static structure/security validation passed.

## Acceptance matrix

| Criterion | Result | Evidence |
| --- | --- | --- |
| 1. Buy from five-card shop, refresh, update gold | PASS | `tests/game-engine.test.js:19-41`; UI handlers at `src/app.js:335-380` and `src/app.js:488-492`. |
| 2. Three matching copies merge | PASS | Regression at `tests/game-engine.test.js:43-54`; an additional nine-copy probe collapsed deterministically to one 3-star unit. |
| 3. Select bench unit, deploy to player half, recall, max four | PASS | Normal limits and the full-bench occupied-slot swap regression pass in `tests/game-engine.test.js`; UI recall/deploy handlers preserve focus. |
| 4. Family, role, and mixed-species bonds are visible | PASS | Calculation test at `tests/game-engine.test.js:74-89`; rendering at `src/app.js:131-174`. |
| 5. Deterministic animated combat with movement, attacks, skills, health, result | PASS | Seeded receipt test passes. A 200-seed probe had 0 incomplete battles and 0 overlapping live-unit cells. Controlled probes observed all eight authored skill names in battle logs; constant idle motion was removed. |
| 6. Continue pays reward, advances round, regenerates opponent/shop | PASS | `tests/game-engine.test.js:117-132`; transition at `src/game-engine.js:585-603`. |
| 7. Pointer, touch, keyboard, and live announcements | PASS WITH EXISTING MANUAL RECEIPT | Native buttons cover pointer/touch/keyboard; status region is at `index.html:130` and announcements at `src/app.js:89-94`. The post-fix audit in `reviews/accessibility-audit.md:96-104` reports focus, target-size, semantics, dialog-focus, and contrast fixes. This review did not independently rerun a browser accessibility tree. |
| 8. Desktop 1440x900 and mobile 390x844 avoid horizontal overflow/clipped controls | STATIC PASS; RUNTIME EVIDENCE STILL REQUIRED | Responsive collapse is defined at `styles.css:1104-1274`; the mobile grid uses `minmax(0, 1fr)`, a fluid board, one-column shop, and two-column bench. This review did not independently capture fresh browser screenshots, so the PM promotion gate must retain the existing browser receipt. |

## Security receipt

PASS for the reviewed local-only threat model.

- `npm run check` confirmed no remote runtime assets in shipped page code and no `innerHTML`, `insertAdjacentHTML`, `eval`, `new Function`, or `document.write` in the UI.
- Independent source search found no SVG scripts, event-handler attributes, `javascript:` URLs, or remote SVG references.
- The local server binds only to `127.0.0.1`, emits `X-Content-Type-Options: nosniff`, and traversal probes returned 404.
- No dependencies, credentials, persistence, backend, payment, or external API surface is present.

## Verification receipts

### Required command

`npm run check` — **exit 0**

- JavaScript syntax checks: PASS
- Node tests: 8/8 PASS, 0 failed
- Static structure/security validation: PASS
- Required files: 8
- Pet symbols: 8
- Concept board cells: 30

### Additional read-only probes

- 200 deterministic battle seeds: 0 incomplete; 0 overlapping live-unit coordinates.
- Eight controlled unit probes: all eight authored skills observed in the battle log.
- Nine identical 1-star units: resolved to one 3-star unit.
- HTTP smoke: an existing listener already occupied port 4173; its `/` response was HTTP 200 and its SHA-256 exactly matched local `index.html`. `/src/app.js` returned HTTP 200 with the expected JavaScript content type.
- Traversal probes: encoded parent and absolute-path attempts all returned HTTP 404.

## Residual risks

- Automated axe was unavailable by design; accessibility relies on the recorded browser-tree/manual audit plus source inspection.
- This independent pass did not create new desktop/mobile screenshots or replay the complete keyboard flow; those browser artifacts remain a separate promotion-gate receipt.
- Game-over/restart and recall focus behavior are source-reviewed but do not yet have dedicated automated tests.
