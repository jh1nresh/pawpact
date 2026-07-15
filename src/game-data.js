export const BOARD_COLS = 5;
export const BOARD_ROWS = 6;
export const PLAYER_START_ROW = 3;
export const FIELD_LIMIT = 4;
export const BENCH_LIMIT = 8;
export const SHOP_SIZE = 5;
export const MAX_STAR = 3;

export const UNIT_LIBRARY = Object.freeze({
  "orange-cat": Object.freeze({
    name: "橘拳",
    family: "cat",
    role: "hunter",
    cost: 1,
    hp: 116,
    attack: 23,
    armor: 4,
    speed: 68,
    range: 1,
    skill: "pounce",
    skillName: "肉球飛撲",
    skillEnergy: 56,
    accent: "#ffad63"
  }),
  "siamese-cat": Object.freeze({
    name: "暹影",
    family: "cat",
    role: "trickster",
    cost: 2,
    hp: 92,
    attack: 27,
    armor: 2,
    speed: 94,
    range: 1,
    skill: "ambush",
    skillName: "窗簾伏擊",
    skillEnergy: 62,
    accent: "#a68cf4"
  }),
  "british-cat": Object.freeze({
    name: "英短盾",
    family: "cat",
    role: "guardian",
    cost: 2,
    hp: 158,
    attack: 15,
    armor: 11,
    speed: 44,
    range: 1,
    skill: "guard",
    skillName: "紙箱堡壘",
    skillEnergy: 54,
    accent: "#84a7c7"
  }),
  "ragdoll-cat": Object.freeze({
    name: "布偶醫",
    family: "cat",
    role: "support",
    cost: 3,
    hp: 102,
    attack: 14,
    armor: 4,
    speed: 61,
    range: 2,
    skill: "mend",
    skillName: "呼嚕療癒",
    skillEnergy: 58,
    accent: "#f2d7c8"
  }),
  "shiba-dog": Object.freeze({
    name: "柴先鋒",
    family: "dog",
    role: "hunter",
    cost: 1,
    hp: 123,
    attack: 21,
    armor: 5,
    speed: 73,
    range: 1,
    skill: "howl",
    skillName: "元氣吠聲",
    skillEnergy: 58,
    accent: "#e9964d"
  }),
  "corgi-dog": Object.freeze({
    name: "柯基堡",
    family: "dog",
    role: "guardian",
    cost: 2,
    hp: 142,
    attack: 18,
    armor: 9,
    speed: 62,
    range: 1,
    skill: "bump",
    skillName: "短腿衝撞",
    skillEnergy: 56,
    accent: "#f0b35e"
  }),
  "husky-dog": Object.freeze({
    name: "哈士奇",
    family: "dog",
    role: "trickster",
    cost: 3,
    hp: 108,
    attack: 25,
    armor: 3,
    speed: 79,
    range: 2,
    skill: "zoomies",
    skillName: "拆家暴走",
    skillEnergy: 64,
    accent: "#8ba3ba"
  }),
  "golden-dog": Object.freeze({
    name: "黃金暖",
    family: "dog",
    role: "support",
    cost: 3,
    hp: 148,
    attack: 14,
    armor: 7,
    speed: 55,
    range: 2,
    skill: "rescue",
    skillName: "暖心救援",
    skillEnergy: 60,
    accent: "#efc36d"
  })
});

export const UNIT_IDS = Object.freeze(Object.keys(UNIT_LIBRARY));

export const FAMILY_LABELS = Object.freeze({
  cat: "貓咪",
  dog: "狗狗"
});

export const ROLE_LABELS = Object.freeze({
  hunter: "獵手",
  guardian: "護衛",
  trickster: "奇策",
  support: "支援"
});

export const SKILL_DESCRIPTIONS = Object.freeze({
  pounce: "飛撲目標，造成高額傷害。",
  ambush: "鎖定生命最低的敵人進行伏擊。",
  guard: "替自己與最虛弱的隊友架起護盾。",
  mend: "以呼嚕聲治療生命最低的隊友。",
  howl: "振奮全隊並咬擊眼前敵人。",
  bump: "衝撞目標並使其停頓一次行動。",
  zoomies: "在敵群中暴走，波及相鄰目標。",
  rescue: "治療最虛弱的隊友並替全隊加盾。"
});

export function unitDefinition(unitId) {
  const unit = UNIT_LIBRARY[unitId];
  if (!unit) {
    throw new Error(`Unknown unit: ${unitId}`);
  }
  return unit;
}
