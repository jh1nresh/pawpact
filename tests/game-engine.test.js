import test from "node:test";
import assert from "node:assert/strict";

import {
  addRosterUnit,
  buyShopUnit,
  continueAfterResult,
  createGame,
  deployUnit,
  getBench,
  getDeployed,
  refreshShop,
  resolveMerges,
  simulateBattle,
  startBattle,
  stepBattle,
  synergyState
} from "../src/game-engine.js";

test("new games expose a deterministic five-card shop and enemy preview", () => {
  const first = createGame(42);
  const second = createGame(42);
  assert.equal(first.phase, "prep");
  assert.equal(first.shop.length, 5);
  assert.equal(first.enemyPreview.length, 2);
  assert.deepEqual(first.shop, second.shop);
  assert.deepEqual(first.enemyPreview, second.enemyPreview);
});

test("shop purchases spend gold and refresh costs two coins", () => {
  const game = createGame(8);
  const card = game.shop[0];
  const cost = card.unitId === "orange-cat" || card.unitId === "shiba-dog" ? 1 : 2;
  const before = game.gold;
  const bought = buyShopUnit(game, 0);
  assert.equal(bought.ok, true);
  assert.equal(game.gold, before - cost);
  assert.equal(getBench(game).length, 1);
  const afterBuy = game.gold;
  assert.equal(refreshShop(game).ok, true);
  assert.equal(game.gold, afterBuy - 2);
});

test("three matching units merge and preserve a deployed slot", () => {
  const game = createGame(12);
  game.roster = [];
  addRosterUnit(game, "orange-cat", 1, 20);
  addRosterUnit(game, "orange-cat", 1, null);
  addRosterUnit(game, "orange-cat", 1, null);
  const merge = resolveMerges(game);
  assert.deepEqual(merge, { unitId: "orange-cat", star: 2 });
  assert.equal(game.roster.length, 1);
  assert.equal(game.roster[0].star, 2);
  assert.equal(game.roster[0].slot, 20);
});

test("deployment is limited to the player half and four units", () => {
  const game = createGame(18);
  game.roster = [];
  const units = [
    addRosterUnit(game, "orange-cat"),
    addRosterUnit(game, "shiba-dog"),
    addRosterUnit(game, "british-cat"),
    addRosterUnit(game, "corgi-dog"),
    addRosterUnit(game, "ragdoll-cat")
  ];
  assert.equal(deployUnit(game, units[0].instanceId, 2).ok, false);
  units.slice(0, 4).forEach((unit, index) => {
    assert.equal(deployUnit(game, unit.instanceId, 15 + index).ok, true);
  });
  assert.equal(deployUnit(game, units[4].instanceId, 19).ok, false);
  assert.equal(getDeployed(game).length, 4);
});

test("moving onto an occupied slot swaps units without overflowing the bench", () => {
  const game = createGame(19);
  game.roster = [];
  for (let index = 0; index < 8; index += 1) {
    addRosterUnit(game, index % 2 === 0 ? "orange-cat" : "shiba-dog");
  }
  const mover = addRosterUnit(game, "british-cat", 1, 15);
  const occupant = addRosterUnit(game, "corgi-dog", 1, 16);

  assert.equal(getBench(game).length, 8);
  assert.equal(deployUnit(game, mover.instanceId, 16).ok, true);
  assert.equal(mover.slot, 16);
  assert.equal(occupant.slot, 15);
  assert.equal(getBench(game).length, 8);
});

test("mixed teams activate family, role, and Paw Pact synergies", () => {
  const game = createGame(22);
  game.roster = [];
  const team = [
    addRosterUnit(game, "orange-cat", 1, 20),
    addRosterUnit(game, "british-cat", 1, 21),
    addRosterUnit(game, "shiba-dog", 1, 22),
    addRosterUnit(game, "corgi-dog", 1, 23)
  ];
  const synergy = synergyState(team);
  assert.equal(synergy.catLevel, 1);
  assert.equal(synergy.dogLevel, 1);
  assert.equal(synergy.hunterActive, true);
  assert.equal(synergy.guardianActive, true);
  assert.equal(synergy.pawPactActive, true);
});

function preparedGame(seed) {
  const game = createGame(seed);
  game.roster = [];
  addRosterUnit(game, "orange-cat", 2, 21);
  addRosterUnit(game, "british-cat", 1, 20);
  addRosterUnit(game, "shiba-dog", 1, 23);
  addRosterUnit(game, "golden-dog", 1, 24);
  return game;
}

function animationFixture({ skill = false, lethal = false } = {}) {
  const game = createGame(303);
  game.roster = [];
  addRosterUnit(game, "orange-cat", 1, 20);
  assert.equal(startBattle(game).ok, true);
  const player = game.battle.units.find((unit) => unit.team === "player");
  const enemy = game.battle.units.find((unit) => unit.team === "enemy");
  game.battle.units = [player, enemy];
  player.x = 2;
  player.y = 3;
  player.speed = 999;
  player.attack = lethal ? enemy.maxHp * 2 : 12;
  player.energy = skill ? 100 : 0;
  enemy.x = 2;
  enemy.y = 2;
  enemy.speed = 1;
  enemy.dodge = 0;
  enemy.armor = 0;
  enemy.stunned = 1;
  return { game, player, enemy };
}

test("battle actions expose Orange Fist combat animation states", () => {
  const attack = animationFixture();
  stepBattle(attack.game);
  assert.equal(attack.player.animationState, "attack-combo");
  assert.equal(attack.enemy.animationState, "hit-stagger");

  const skill = animationFixture({ skill: true });
  stepBattle(skill.game);
  assert.equal(skill.player.animationState, "signature-skill");
  assert.equal(skill.enemy.animationState, "hit-stagger");
});

test("animation states reset each tick and victory replaces the final action", () => {
  const reset = animationFixture();
  stepBattle(reset.game);
  reset.player.stunned = 1;
  reset.enemy.stunned = 1;
  stepBattle(reset.game);
  assert.equal(reset.player.animationState, null);
  assert.equal(reset.enemy.animationState, null);

  const victory = animationFixture({ lethal: true });
  assert.equal(stepBattle(victory.game), "win");
  assert.equal(victory.player.animationState, "victory");
});

test("seeded battles complete and produce the same receipt", () => {
  const first = preparedGame(91);
  const second = preparedGame(91);
  assert.equal(startBattle(first).ok, true);
  assert.equal(startBattle(second).ok, true);
  const firstOutcome = simulateBattle(first);
  const secondOutcome = simulateBattle(second);
  assert.ok(["win", "loss", "draw"].includes(firstOutcome));
  assert.equal(firstOutcome, secondOutcome);
  assert.equal(first.result.ticks, second.result.ticks);
  assert.deepEqual(
    first.battle.units.map(({ battleId, hp, shield, alive, x, y }) => ({ battleId, hp, shield, alive, x, y })),
    second.battle.units.map(({ battleId, hp, shield, alive, x, y }) => ({ battleId, hp, shield, alive, x, y }))
  );
});

test("continuing a result pays rewards and advances or ends the run", () => {
  const game = preparedGame(144);
  startBattle(game);
  simulateBattle(game);
  const oldRound = game.round;
  const oldGold = game.gold;
  const reward = game.result.reward;
  const receipt = continueAfterResult(game);
  assert.equal(receipt.ok, true);
  assert.equal(game.gold, oldGold + reward);
  assert.ok(game.phase === "prep" || game.phase === "gameover");
  if (game.phase === "prep") {
    assert.equal(game.round, oldRound + 1);
    assert.equal(game.shop.length, 5);
  }
});
