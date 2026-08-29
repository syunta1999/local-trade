/**
 * 対戦bot。
 *
 * 過去データの再生なので、botの売買は値段を動かせない。だからこの対戦は
 * 「同じ相場を見て、同じ約定ルールで、判断だけを競う」形になる。
 * 板の取り合いにはならない代わりに、条件は完全に対等になる。
 *
 * 先読みは構造的にできない:
 *   - 判断材料は自前の1分足（確定した足＋形成中の足）と、通り過ぎた歩み値だけ
 *   - 約定は matchTick、つまりプレイヤーとまったく同じ関数・同じ指値ルール
 *   - 乱数は種を固定。同じCSV・同じ開始位置ならbotは毎回まったく同じ動きをする
 *     （＝タイムアタックのコースとして成立する）
 */

import { addTick, createCandleState, type CandleState } from './candles';
import { bollingerAt } from './indicators';
import { hash32, mulberry32 } from './jitter';
import {
  cancelOrder,
  computePnl,
  createTrading,
  matchTick,
  placeOrder,
  type Fill,
  type OrderSide,
  type TradingState,
} from './trading';
import type { Tick } from './types';

/** botが見る足。画面の足種を変えてもbotの判断は変わらない */
const BOT_INTERVAL = 60;
/** スキャルが偏りを測る歩み値の本数 */
const SCALP_WINDOW = 240;
/** 偏りを信用するのに要る最低出来高 */
const SCALP_MIN_VOL = 2000;
/** 値動きの大きさを測る本数（確定した足のみ） */
const ATR_LEN = 14;
/** 足がまだ足りないときに使う値動きの目安(ティック) */
const ATR_FALLBACK = 8;
/**
 * 撤退の指値をいまの値段からどれだけずらすか(ティック)。0 = 現値ちょうど。
 * 現値に置き直し続けることで逆指値(ストップ)の代わりにしている。
 * 相場を跨いで置く（>0）と毎回その幅を確実に損するので、かえって成績が落ちる。
 */
const EXIT_SLIP = 0;

export type BotKind = 'fade' | 'break' | 'scalp';

export type BotDef = {
  id: BotKind;
  name: string;
  color: string;
  /** どう考えて売買するか */
  tagline: string;
  strong: string;
  weak: string;
  /** 反応の遅れの基準(秒)。難易度でここに倍率が掛かる */
  react: number;
  /**
   * 撤退・利確の幅は「直近1分足の平均値幅(ATR)の何倍か」で持つ。
   * ティック数で固定すると、値動きの大きさが違う銘柄でまるで別物になってしまう。
   */
  stopAtr: number;
  targetAtr: number;
  /** ATRが出せないほど静かなときの下限(ティック) */
  minStop: number;
  /** 最長保有(秒) */
  hold: number;
  /** 手仕舞い後の休み(秒) */
  cool: number;
  /** 新規注文を板に置いておく上限(秒) */
  chase: number;

  // ---- 判断のしきい値。botごとに使うものだけ入る ----
  /** 逆張り: ボリンジャーバンドの本数と幅(σ) */
  period?: number;
  sigma?: number;
  /** ブレイク: 何本ぶんの高安を見るか */
  lookback?: number;
  /** ブレイク: 抜けたと認める余裕（ATRの何倍か）。ヒゲ1本では動かない */
  marginAtr?: number;
  /** ブレイク: これより狭い持ち合いは相手にしない（ATRの何倍か） */
  minRangeAtr?: number;
  /** スキャル: 買い出来高の偏りのしきい値 */
  thresh?: number;
};

/**
 * 3体で弱点が正反対になるようにしてある。
 * どのbotに負けたかで、その日がどんな相場だったかが分かる。
 */
export const BOTS: BotDef[] = [
  {
    id: 'fade',
    name: '逆張り',
    color: '#5ec8e5',
    tagline: '伸びすぎたら戻ると考える。バンドの外に出たら逆を張る',
    strong: 'レンジ',
    weak: 'トレンド',
    react: 1.6,
    stopAtr: 0.8,
    targetAtr: 2.2,
    minStop: 4,
    hold: 420,
    cool: 30,
    chase: 25,
    period: 10,
    sigma: 1.7,
  },
  {
    id: 'break',
    name: 'ブレイク',
    color: '#f0b429',
    tagline: '直近6分の高値を抜けたら付いていく。押し目は待たない',
    strong: 'トレンド',
    weak: 'レンジ',
    react: 1.2,
    stopAtr: 1.2,
    targetAtr: 1.6,
    minStop: 4,
    hold: 300,
    cool: 45,
    chase: 15,
    lookback: 6,
    marginAtr: 0.2,
    minRangeAtr: 2,
  },
  {
    id: 'scalp',
    name: 'スキャル',
    color: '#c792ea',
    tagline: '歩み値の買い / 売りの偏りに乗って、数ティックで逃げる',
    strong: '出来高の多い時間',
    weak: '閑散',
    react: 0.6,
    stopAtr: 0.4,
    targetAtr: 0.3,
    minStop: 2,
    hold: 90,
    cool: 20,
    chase: 8,
    thresh: 0.62,
  },
];

/** 難易度は先読みではなく「反応の遅れ」で付ける。ズルはさせない */
export type Level = 'easy' | 'normal' | 'hard';

export const LEVELS: { id: Level; label: string; mult: number; note: string }[] = [
  { id: 'easy', label: 'かんたん', mult: 2.4, note: '判断が遅く、良い値段を逃しがち' },
  { id: 'normal', label: 'ふつう', mult: 1, note: '人がぎりぎり追える速さ' },
  { id: 'hard', label: 'むずかしい', mult: 0.4, note: '合図が出たらほぼ即座に動く' },
];

type Plan = { side: OrderSide; at: number };

export type BotRun = {
  def: BotDef;
  state: TradingState;
  candles: CandleState;
  rand: () => number;
  /** 呼値 */
  tick: number;
  /** 反応の遅れ(秒) */
  react: number;
  closes: number[];
  highs: number[];
  lows: number[];
  /** 直近の1分足の平均値幅(円)。撤退幅の物差し */
  atr: number;
  plan: Plan | null;
  /** 出している新規注文 / 返済注文の id。0 なら無し */
  entryId: number;
  exitId: number;
  /** 建玉の撤退ライン・利確ライン */
  stopPx: number;
  targetPx: number;
  holdUntil: number;
  coolUntil: number;
  giveUpAt: number;
  /** スキャル用の歩み値の窓。上げ / 下げの出来高を差分で持つ */
  buf: Int32Array;
  bufI: number;
  up: number;
  down: number;
};

const roundTo = (px: number, tick: number) => Math.round(px / tick) * tick;

/** 直近の確定した足の平均値幅。銘柄ごと・時間帯ごとの荒さにそのまま追従する */
function updateAtr(bot: BotRun): void {
  const n = bot.highs.length - 1; // 形成中の足は入れない
  if (n < 3) return;
  const from = Math.max(0, n - ATR_LEN);
  let acc = 0;
  for (let k = from; k < n; k++) acc += bot.highs[k] - bot.lows[k];
  const avg = acc / (n - from);
  if (avg > 0) bot.atr = avg;
}

/** 撤退幅・利確幅(円)。ATRの倍数だが、静かすぎるときは下限を効かせる */
function span(bot: BotRun, mult: number, minTicks: number): number {
  return Math.max(bot.atr * mult, minTicks * bot.tick);
}

export function createBot(def: BotDef, tickSize: number, level: Level, seed: number): BotRun {
  const mult = LEVELS.find((l) => l.id === level)?.mult ?? 1;
  const rand = mulberry32(hash32(seed + def.id.charCodeAt(0) * 7919));
  return {
    def,
    state: createTrading(),
    candles: createCandleState(BOT_INTERVAL),
    rand,
    tick: tickSize,
    // 同じ合図でも3体が同時に動かないよう、種を固定した揺らぎを足す
    react: def.react * mult * (0.85 + rand() * 0.3),
    closes: [],
    highs: [],
    lows: [],
    atr: ATR_FALLBACK * tickSize,
    plan: null,
    entryId: 0,
    exitId: 0,
    stopPx: 0,
    targetPx: 0,
    holdUntil: 0,
    coolUntil: 0,
    giveUpAt: 0,
    buf: new Int32Array(SCALP_WINDOW * 2),
    bufI: 0,
    up: 0,
    down: 0,
  };
}

/** 建玉の向き。botは両建てしない */
export function botSide(bot: BotRun): 'long' | 'short' | null {
  if (bot.state.long.qty > 0) return 'long';
  if (bot.state.short.qty > 0) return 'short';
  return null;
}

/** 歩み値の窓を更新する。古い1本を引いて新しい1本を足すだけ */
function pushTape(bot: BotRun, tick: Tick): void {
  const i = bot.bufI;
  const oldDir = bot.buf[i * 2];
  const oldSize = bot.buf[i * 2 + 1];
  if (oldDir > 0) bot.up -= oldSize;
  else if (oldDir < 0) bot.down -= oldSize;

  bot.buf[i * 2] = tick.dir;
  bot.buf[i * 2 + 1] = tick.size;
  if (tick.dir > 0) bot.up += tick.size;
  else if (tick.dir < 0) bot.down += tick.size;

  bot.bufI = (i + 1) % SCALP_WINDOW;
}

/** 新規で入る向き。入らないなら null */
function signal(bot: BotRun, tick: Tick): OrderSide | null {
  const i = bot.closes.length - 1;
  if (i < 1) return null;

  if (bot.def.id === 'fade') {
    const period = bot.def.period ?? 14;
    if (i < period) return null;
    const b = bollingerAt(bot.closes, i, period, bot.def.sigma ?? 1.7);
    if (!b) return null;
    if (tick.price >= b.upper) return 'sell';
    if (tick.price <= b.lower) return 'buy';
    return null;
  }

  if (bot.def.id === 'break') {
    const lb = bot.def.lookback ?? 10;
    if (i < lb) return null;
    let hi = -Infinity;
    let lo = Infinity;
    // 形成中の足(i)は含めない。確定した足だけで水準を決める
    for (let k = i - lb; k < i; k++) {
      if (bot.highs[k] > hi) hi = bot.highs[k];
      if (bot.lows[k] < lo) lo = bot.lows[k];
    }
    // 狭すぎる持ち合いの「抜け」はただのノイズなので相手にしない
    if (hi - lo < bot.atr * (bot.def.minRangeAtr ?? 1.2)) return null;
    const margin = Math.max(bot.atr * (bot.def.marginAtr ?? 0.2), bot.tick);
    if (tick.price > hi + margin) return 'buy';
    if (tick.price < lo - margin) return 'sell';
    return null;
  }

  const total = bot.up + bot.down;
  if (total < SCALP_MIN_VOL) return null;
  const share = bot.up / total;
  const th = bot.def.thresh ?? 0.62;
  if (share > th) return 'buy';
  if (share < 1 - th) return 'sell';
  return null;
}

/** 利確の目標値。逆張りだけはバンドの中心へ戻るのを狙う */
function targetOf(bot: BotRun, side: OrderSide, entry: number): number {
  const dir = side === 'buy' ? 1 : -1;
  const byTicks = entry + dir * span(bot, bot.def.targetAtr, bot.def.minStop);
  if (bot.def.id !== 'fade') return roundTo(byTicks, bot.tick);
  const b = bollingerAt(bot.closes, bot.closes.length - 1, bot.def.period ?? 14, bot.def.sigma ?? 1.7);
  if (!b) return roundTo(byTicks, bot.tick);
  // 中心まで戻るのを待ちすぎないよう、ティック目標より手前なら手前を採る
  const mid = roundTo(b.mid, bot.tick);
  return dir > 0 ? Math.min(mid, byTicks) : Math.max(mid, byTicks);
}

function place(bot: BotRun, side: OrderSide, kind: 'open' | 'close', px: number, qty: number, at: number): number {
  const res = placeOrder(bot.state, { side, kind, price: roundTo(px, bot.tick), qty, at });
  return res.ok ? res.order.id : 0;
}

function onFilled(bot: BotRun, fill: Fill, tick: Tick): void {
  if (fill.order.kind === 'open') {
    bot.entryId = 0;
    const dir = fill.order.side === 'buy' ? 1 : -1;
    bot.stopPx = roundTo(fill.price - dir * span(bot, bot.def.stopAtr, bot.def.minStop), bot.tick);
    bot.targetPx = targetOf(bot, fill.order.side, fill.price);
    bot.holdUntil = tick.t + bot.def.hold;
    // 利確の指値はすぐ置く。あとは相場が来るのを待つだけ
    const exitSide: OrderSide = fill.order.side === 'buy' ? 'sell' : 'buy';
    bot.exitId = place(bot, exitSide, 'close', bot.targetPx, fill.qty, tick.t);
    return;
  }
  bot.exitId = 0;
  bot.coolUntil = tick.t + bot.def.cool;
  bot.plan = null;
}

function think(bot: BotRun, tick: Tick, lot: number): void {
  const side = botSide(bot);

  if (side) {
    // 撤退ラインを割ったか、持ちすぎたら、いまの値段で投げる
    const hit = side === 'long' ? tick.price <= bot.stopPx : tick.price >= bot.stopPx;
    if (!hit && tick.t < bot.holdUntil) return;
    if (bot.exitId) {
      cancelOrder(bot.state, bot.exitId);
      bot.exitId = 0;
    }
    const exitSide: OrderSide = side === 'long' ? 'sell' : 'buy';
    const qty = side === 'long' ? bot.state.long.qty : bot.state.short.qty;
    // 相場を跨いで置く。そうしないと「戻ってくるまで約定しない」ことになり、
    // 損切りのつもりが下がり続ける玉を持ち続けてしまう
    // 撤退条件が続くあいだ毎ティック置き直すので、最初に反対側へ動いた瞬間に約定する
    const slip = EXIT_SLIP * bot.tick;
    const px = exitSide === 'sell' ? tick.price - slip : tick.price + slip;
    bot.exitId = place(bot, exitSide, 'close', px, qty, tick.t);
    return;
  }

  // 新規注文を出したまま触れないなら引っ込める
  if (bot.entryId) {
    if (tick.t >= bot.giveUpAt) {
      cancelOrder(bot.state, bot.entryId);
      bot.entryId = 0;
      bot.coolUntil = tick.t + bot.def.cool / 2;
    }
    return;
  }
  if (bot.state.orders.length > 0) return;
  if (tick.t < bot.coolUntil) return;

  if (bot.plan) {
    if (tick.t < bot.plan.at) return;
    const s = bot.plan.side;
    bot.plan = null;
    // 逆張りとスキャルは1ティック有利な側に置いて待つ（もう一段行ったら拾う）。
    // ブレイクだけは追いかける側なので、相場を跨いで置いてすぐ約定させる
    const dir = s === 'buy' ? -1 : 1;
    const px = bot.def.id === 'break' ? tick.price - dir * bot.tick : tick.price + dir * bot.tick;
    bot.entryId = place(bot, s, 'open', px, lot, tick.t);
    bot.giveUpAt = tick.t + bot.def.chase;
    return;
  }

  const sig = signal(bot, tick);
  if (sig) bot.plan = { side: sig, at: tick.t + bot.react };
}

/** 足・値動きの大きさ・歩み値の窓を1本ぶん進める。売買の判断はしない */
function observe(bot: BotRun, tick: Tick): void {
  const { candle, isNew } = addTick(bot.candles, tick);
  if (isNew) {
    bot.closes.push(candle.close);
    bot.highs.push(candle.high);
    bot.lows.push(candle.low);
    updateAtr(bot);
  } else {
    const i = bot.closes.length - 1;
    bot.closes[i] = candle.close;
    bot.highs[i] = candle.high;
    bot.lows[i] = candle.low;
  }
  pushTape(bot, tick);
}

/**
 * 対戦を始める前に、すでに流れ終わったティックで判断材料だけ作らせる。
 *
 * これは先読みではない。プレイヤーがチャートで見ているのとまったく同じ「過去」で、
 * ここを飛ばすとbotはバンドも値動きの大きさも持たないまま開始することになる。
 * 売買はしないので、ラウンド開始前の成績は必ずゼロから始まる。
 */
export function warmBot(bot: BotRun, ticks: Tick[], from: number, to: number): void {
  for (let i = Math.max(0, from); i < to; i++) observe(bot, ticks[i]);
}

/** ティック1本ぶん進める。返すのは約定した注文 */
export function stepBot(bot: BotRun, tick: Tick, lot: number): Fill[] {
  // 1) 約定合わせ。プレイヤーとまったく同じ関数を通す
  const fills = matchTick(bot.state, tick.price, tick.t, tick.n);
  for (const f of fills) onFilled(bot, f, tick);

  // 2) 自前の足と歩み値の窓を進める
  observe(bot, tick);

  // 3) 判断
  think(bot, tick, lot);
  return fills;
}

/** 画面に出すための1往復。いくらで建てていくらで返したかまで持つ */
export type BotTrade = {
  side: 'long' | 'short';
  entry: number;
  exit: number;
  entryAt: number;
  exitAt: number;
  /** ティックの通し番号。ミニチャートの横位置に使う */
  entryN: number;
  exitN: number;
  qty: number;
  pnl: number;
};

export type BotView = {
  id: BotKind;
  name: string;
  color: string;
  /** マーカーに出す1文字の目印 */
  tag: string;
  side: 'long' | 'short' | null;
  qty: number;
  avg: number;
  /** 建て始めた時刻と通し番号。建玉中のものもミニチャートに出す */
  since: number;
  sinceN: number;
  realized: number;
  trades: BotTrade[];
  wins: number;
  /** 板に出している未約定の注文 */
  orders: { side: OrderSide; price: number; qty: number }[];
};

export function viewOf(bot: BotRun): BotView {
  const side = botSide(bot);
  const pos = side === 'long' ? bot.state.long : side === 'short' ? bot.state.short : null;
  return {
    id: bot.def.id,
    name: bot.def.name,
    color: bot.def.color,
    tag: bot.def.name[0],
    side,
    qty: pos?.qty ?? 0,
    avg: pos?.avg ?? 0,
    since: pos?.since ?? 0,
    sinceN: pos?.sinceN ?? 0,
    realized: bot.state.realized,
    trades: bot.state.trades.map((t) => ({
      side: t.side,
      entry: t.entry,
      exit: t.exit,
      entryAt: t.entryAt,
      exitAt: t.exitAt,
      entryN: t.entryN,
      exitN: t.exitN,
      qty: t.qty,
      pnl: t.pnl,
    })),
    wins: bot.state.trades.filter((t) => t.pnl > 0).length,
    orders: bot.state.orders.map((o) => ({ side: o.side, price: o.price, qty: o.qty })),
  };
}

/** 画面と同じ式で総合損益を出す */
export function totalOf(v: BotView, last: number): number {
  return computePnl(
    {
      long: { qty: v.side === 'long' ? v.qty : 0, avg: v.avg, since: 0, sinceN: 0, wait: 0 },
      short: { qty: v.side === 'short' ? v.qty : 0, avg: v.avg, since: 0, sinceN: 0, wait: 0 },
      realized: v.realized,
    },
    last,
  ).total;
}
