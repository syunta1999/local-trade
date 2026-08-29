import type { Position, Trade } from './trading';

/**
 * 自分で決めたルールと、その違反判定。
 *
 * 負けるのは優位性が無いからより「自分のルールを破るから」であることが多い。
 * 破った瞬間に気づけるよう、判定はティック単位で回す。
 */

export type RuleId =
  | 'maxTrades'
  | 'stopLoss'
  | 'maxLot'
  | 'entryCutoff'
  | 'maxDrawdown'
  | 'loseStreak'
  | 'cooldown';

export type RuleDef = {
  id: RuleId;
  label: string;
  min: number;
  max: number;
  step: number;
  /** 入力欄の種類。time は分で持って HH:MM で編集する */
  kind: 'number' | 'time';
  /** 値の見せ方 */
  fmt: (v: number) => string;
  note: string;
};

/** 分 → "HH:MM" */
export const minToTime = (v: number) =>
  `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;

/** "HH:MM" → 分 */
export const timeToMin = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : 0;
};

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export const RULE_DEFS: RuleDef[] = [
  {
    id: 'maxTrades',
    label: 'トレード回数',
    min: 1,
    max: 50,
    step: 1,
    kind: 'number',
    fmt: (v) => `${v}回まで`,
    note: '数を打ちたくなる衝動を止める',
  },
  {
    id: 'stopLoss',
    label: '損切り幅',
    min: 1,
    max: 500,
    step: 1,
    kind: 'number',
    fmt: (v) => `-${v}円/株 まで`,
    note: 'これ以上の含み損を抱えない',
  },
  {
    id: 'maxLot',
    label: '最大ロット',
    min: 100,
    max: 10000,
    step: 100,
    kind: 'number',
    fmt: (v) => `${v.toLocaleString('ja-JP')}株まで`,
    note: '熱くなって張り増さない',
  },
  {
    id: 'entryCutoff',
    label: 'エントリー期限',
    min: 9 * 60,
    max: 15 * 60 + 30,
    step: 15,
    kind: 'time',
    fmt: (v) => `${hhmm(v)} まで`,
    note: 'ダラダラ入り続けない',
  },
  {
    id: 'maxDrawdown',
    label: '最大損失',
    min: 1000,
    max: 500000,
    step: 1000,
    kind: 'number',
    fmt: (v) => `-${v.toLocaleString('ja-JP')}円 まで`,
    note: '合計がこれを割ったら今日は終わり',
  },
  {
    id: 'loseStreak',
    label: '連敗',
    min: 2,
    max: 10,
    step: 1,
    kind: 'number',
    fmt: (v) => `${v}連敗まで`,
    note: '流れが悪いときに手を止める',
  },
  {
    id: 'cooldown',
    label: '次の玉まで',
    min: 5,
    max: 600,
    step: 5,
    kind: 'number',
    fmt: (v) => `${v}秒 空ける`,
    note: '返済直後に飛び乗らない',
  },
];

export type RuleState = { enabled: boolean; value: number };
export type Rules = Record<RuleId, RuleState>;

export const DEFAULT_RULES: Rules = {
  maxTrades: { enabled: false, value: 5 },
  stopLoss: { enabled: false, value: 20 },
  maxLot: { enabled: false, value: 300 },
  entryCutoff: { enabled: false, value: 10 * 60 },
  maxDrawdown: { enabled: false, value: 30000 },
  loseStreak: { enabled: false, value: 3 },
  cooldown: { enabled: false, value: 60 },
};

export type CheckInput = {
  rules: Rules;
  trades: Trade[];
  long: Position;
  short: Position;
  /** 現在値 */
  last: number;
  /** セッション内の時刻(t) */
  clock: number;
  /** その日の何分か。エントリー期限の判定用 */
  clockMin: number;
  realized: number;
  /** 発注しようとしている注文。常時チェックのときは無い */
  order?: { qty: number; kind: 'open' | 'close' };
};

/** いま破っているルールを列挙する */
export function checkRules(input: CheckInput): RuleId[] {
  const { rules, trades, long, short, last, clockMin, realized, order } = input;
  const hit: RuleId[] = [];
  const on = (id: RuleId) => rules[id]?.enabled;
  const val = (id: RuleId) => rules[id]?.value ?? 0;

  if (on('maxTrades') && trades.length > val('maxTrades')) hit.push('maxTrades');

  if (on('stopLoss') && last > 0) {
    const longLoss = long.qty > 0 ? long.avg - last : 0;
    const shortLoss = short.qty > 0 ? last - short.avg : 0;
    if (Math.max(longLoss, shortLoss) > val('stopLoss')) hit.push('stopLoss');
  }

  if (on('maxDrawdown') && last > 0) {
    const unreal =
      (long.qty ? (last - long.avg) * long.qty : 0) +
      (short.qty ? (short.avg - last) * short.qty : 0);
    if (realized + unreal < -val('maxDrawdown')) hit.push('maxDrawdown');
  }

  if (on('loseStreak')) {
    let streak = 0;
    for (let i = trades.length - 1; i >= 0; i--) {
      if (trades[i].pnl < 0) streak++;
      else break;
    }
    if (streak >= val('loseStreak')) hit.push('loseStreak');
  }

  if (order) {
    if (on('maxLot') && order.qty > val('maxLot')) hit.push('maxLot');
    if (order.kind === 'open') {
      if (on('entryCutoff') && clockMin >= val('entryCutoff')) hit.push('entryCutoff');
      if (on('cooldown') && trades.length > 0) {
        const lastExit = Math.max(...trades.map((t) => t.exitAt));
        if (input.clock - lastExit < val('cooldown')) hit.push('cooldown');
      }
    }
  }

  return hit;
}

// ---- CSVへの保存 ----------------------------------------------------------

export const RULES_FILE = 'rules.csv';
export const RULES_HEAD = 'ID,有効,値';

export function rulesToRows(rules: Rules): string[] {
  return RULE_DEFS.map((d) => `${d.id},${rules[d.id].enabled ? 1 : 0},${rules[d.id].value}`);
}

export function rulesFromCsv(text: string): Rules {
  const out: Rules = structuredClone(DEFAULT_RULES);
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/).slice(1)) {
    const [id, en, v] = line.split(',');
    const key = id as RuleId;
    if (!out[key]) continue;
    out[key] = { enabled: en === '1', value: Number(v) || out[key].value };
  }
  return out;
}
