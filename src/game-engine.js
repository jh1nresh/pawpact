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
}
