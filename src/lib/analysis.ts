import type { Trade } from './trading';
import type { Tick } from './types';

/**
 * チャレンジの記録と、その集計。
 *
 * 集計はティック配列を使って後追いで行う。建玉中の値動き(MAE/MFE)も、
 * トレード中に持ち回るのではなく `entryN`〜`exitN` の区間を走査して出す。
 */

export type ChallengeLog = {
  /** 開始時刻(実時刻)から作る一意なID */
  id: string;
  startedAt: number;
  endedAt: number;
  fileName: string;
  symbol: string | null;
  dateLabel: string;
  /** チャレンジ中に動いたセッション時刻の範囲(t) */
  fromClock: number;
  toClock: number;
  trades: Trade[];
  /** 取り消した注文の数 */
  cancelled: number;
  /** 巻き戻した回数。多いほど成績の参考度が下がる */
  seeks: number;
};

export function createLog(
  fileName: string,
  symbol: string | null,
  dateLabel: string,
  clock: number,
): ChallengeLog {
  const now = Date.now();
  return {
    id: String(now),
    startedAt: now,
    endedAt: now,
    fileName,
    symbol,
    dateLabel,
    fromClock: clock,
    toClock: clock,
    trades: [],
    cancelled: 0,
    seeks: 0,
  };
}

// ---- A / B: 基本成績と期待値 -------------------------------------------

export type SideStats = {
  count: number;
  wins: number;
  losses: number;
  evens: number;
  /** 勝率。引分は母数から除く */
  winRate: number;
  pnl: number;
  avgPnl: number;
  grossProfit: number;
  /** 負けの合計(正の数) */
  grossLoss: number;
  maxWin: number;
  maxLoss: number;
  avgWin: number;
  /** 平均損失(正の数) */
  avgLoss: number;
  /** リスクリワード比 = 平均利益 ÷ 平均損失 */
  riskReward: number;
  /** プロフィットファクター = 総利益 ÷ 総損失 */
  profitFactor: number;
  /** 1取引あたり期待値 */
  expectancy: number;
  /** このRRで損益トントンになる勝率 */
  breakEvenWinRate: number;
  /** 実勝率 − 損益分岐勝率。正なら優位性あり */
  edge: number;
};

const div = (a: number, b: number) => (b === 0 ? 0 : a / b);

export function statsOf(trades: Trade[]): SideStats {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const evens = trades.length - wins.length - losses.length;

  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0);
  const pnl = grossProfit - grossLoss;

  const avgWin = div(grossProfit, wins.length);
  const avgLoss = div(grossLoss, losses.length);
  const riskReward = div(avgWin, avgLoss);
  const decided = wins.length + losses.length;
  const winRate = div(wins.length, decided);
  // RR が出ないとき(負けが無い等)は損益分岐勝率を定義できない
  const breakEvenWinRate = riskReward > 0 ? 1 / (1 + riskReward) : 0;

  return {
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    evens,
    winRate,
    pnl,
    avgPnl: div(pnl, trades.length),
    grossProfit,
    grossLoss,
    maxWin: wins.length ? Math.max(...wins.map((t) => t.pnl)) : 0,
    maxLoss: losses.length ? Math.min(...losses.map((t) => t.pnl)) : 0,
    avgWin,
    avgLoss,
    riskReward,
    profitFactor: div(grossProfit, grossLoss),
    expectancy: winRate * avgWin - (1 - winRate) * avgLoss,
    breakEvenWinRate,
    edge: breakEvenWinRate > 0 ? winRate - breakEvenWinRate : 0,
  };
}

// ---- C: リスクと資金曲線 -----------------------------------------------

export type RiskStats = {
  maxDrawdown: number;
  /** 最大DD ÷ そのときのピーク。ピークが0以下なら0 */
  maxDrawdownPct: number;
  maxWinStreak: number;
  maxLoseStreak: number;
  stdev: number;
  /** 平均損益 ÷ 標準偏差 */
  sharpe: number;
  /** 総損益 ÷ 最大DD */
  recoveryFactor: number;
  /** 累積損益の推移 */
  equity: number[];
};

function riskOf(trades: Trade[]): RiskStats {
  const equity: number[] = [];
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  let ddPct = 0;
  let win = 0;
  let lose = 0;
  let maxWin = 0;
  let maxLose = 0;

  for (const t of trades) {
    cum += t.pnl;
    equity.push(cum);
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDd) {
      maxDd = dd;
      ddPct = peak > 0 ? dd / peak : 0;
    }
    if (t.pnl > 0) {
      win++;
      lose = 0;
    } else if (t.pnl < 0) {
      lose++;
      win = 0;
    }
    if (win > maxWin) maxWin = win;
    if (lose > maxLose) maxLose = lose;
  }

  const avg = div(cum, trades.length);
  const variance = div(
    trades.reduce((a, t) => a + (t.pnl - avg) ** 2, 0),
    trades.length,
  );
  const stdev = Math.sqrt(variance);

  return {
    maxDrawdown: maxDd,
    maxDrawdownPct: ddPct,
    maxWinStreak: maxWin,
    maxLoseStreak: maxLose,
    stdev,
    sharpe: div(avg, stdev),
    recoveryFactor: div(cum, maxDd),
    equity,
  };
}

// ---- D: 時間 -------------------------------------------------------------

/** 東証の1日を性格の違う区分に割る */
const BUCKETS = [
  { label: '寄付 9:00-9:30', from: 9 * 60, to: 9 * 60 + 30 },
  { label: '前場 9:30-11:30', from: 9 * 60 + 30, to: 11 * 60 + 30 },
  { label: '後場前半 12:30-13:00', from: 12 * 60 + 30, to: 13 * 60 },
  { label: '後場 13:00-15:00', from: 13 * 60, to: 15 * 60 },
  { label: '大引け 15:00-15:30', from: 15 * 60, to: 15 * 60 + 30 },
];

/** t(epoch秒, 壁時計をUTCとして符号化)から分を取り出す */
function minuteOfDay(t: number): number {
  const d = new Date(t * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export type BucketStats = { label: string; count: number; wins: number; winRate: number; pnl: number };

export type TimeStats = {
  avgHold: number;
  avgHoldWin: number;
  avgHoldLose: number;
  avgInterval: number;
  avgWait: number;
  cancelled: number;
  /** 取消 ÷ (約定 + 取消) */
  cancelRate: number;
  buckets: BucketStats[];
};

function timeOf(trades: Trade[], cancelled: number): TimeStats {
  const hold = (t: Trade) => Math.max(0, t.exitAt - t.entryAt);
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);

  const entries = trades.map((t) => t.entryAt).sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < entries.length; i++) gap += entries[i] - entries[i - 1];

  const buckets = BUCKETS.map((b) => {
    const inB = trades.filter((t) => {
      const m = minuteOfDay(t.entryAt);
      return m >= b.from && m < b.to;
    });
    const w = inB.filter((t) => t.pnl > 0).length;
    const l = inB.filter((t) => t.pnl < 0).length;
    return {
      label: b.label,
      count: inB.length,
      wins: w,
      winRate: div(w, w + l),
      pnl: inB.reduce((a, t) => a + t.pnl, 0),
    };
  });

  // 1トレードにつき建て・返済の2回約定している
  const fills = trades.length * 2;
  return {
    avgHold: div(trades.reduce((a, t) => a + hold(t), 0), trades.length),
    avgHoldWin: div(wins.reduce((a, t) => a + hold(t), 0), wins.length),
    avgHoldLose: div(losses.reduce((a, t) => a + hold(t), 0), losses.length),
    avgInterval: div(gap, Math.max(0, entries.length - 1)),
    avgWait: div(trades.reduce((a, t) => a + t.entryWait + t.exitWait, 0), fills),
    cancelled,
    cancelRate: div(cancelled, fills + cancelled),
    buckets,
  };
}

// ---- E: 執行の質 ---------------------------------------------------------

export type Excursion = {
  trade: Trade;
  /** 最大逆行幅(円/株) */
  mae: number;
  /** 最大順行幅(円/株) */
  mfe: number;
  maeMoney: number;
  mfeMoney: number;
};

/** 建玉中の値動きを走査して、最大逆行と最大順行を出す */
export function excursionOf(t: Trade, ticks: Tick[]): Excursion {
  if (ticks.length === 0) return { trade: t, mae: 0, mfe: 0, maeMoney: 0, mfeMoney: 0 };
  const a = Math.max(0, Math.min(t.entryN, ticks.length - 1));
  const b = Math.max(a, Math.min(t.exitN, ticks.length - 1));
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = a; i <= b; i++) {
    const p = ticks[i].price;
    if (p > hi) hi = p;
    if (p < lo) lo = p;
  }
  if (!Number.isFinite(hi)) return { trade: t, mae: 0, mfe: 0, maeMoney: 0, mfeMoney: 0 };

  const mfe = Math.max(0, t.side === 'long' ? hi - t.entry : t.entry - lo);
  const mae = Math.max(0, t.side === 'long' ? t.entry - lo : hi - t.entry);
  return { trade: t, mae, mfe, maeMoney: mae * t.qty, mfeMoney: mfe * t.qty };
}

export type SweepRow = { level: number; pnl: number; delta: number };

export type ExecStats = {
  avgMae: number;
  avgMfe: number;
  maxMae: number;
  maxMfe: number;
  /** 取れた利益 ÷ 取れたはずの利益。1に近いほど伸ばせている */
  captureRate: number;
  /** 1 − captureRate */
  missRate: number;
  /** 負けトレードの平均逆行(円/株) */
  loseMae: number;
  /** 負けトレードの平均損失(円/株)。loseMae との差が「戻したぶん」 */
  loseLoss: number;
  /** 勝ちトレードでも耐えた平均逆行(円/株) */
  winMae: number;
  /** 含み益があったのに負けた件数 */
  gaveBack: number;
  /** 逆行に耐えて勝った件数 */
  endured: number;
  items: Excursion[];
  tpSweep: SweepRow[];
  slSweep: SweepRow[];
};

/** 利確幅・損切幅を振ってみたときの総損益。到達したら必ず約定した前提の概算 */
function sweep(items: Excursion[], levels: number[], kind: 'tp' | 'sl', actual: number): SweepRow[] {
  return levels.map((level) => {
    let pnl = 0;
    for (const it of items) {
      const reached = kind === 'tp' ? it.mfe >= level : it.mae >= level;
      if (reached) pnl += (kind === 'tp' ? level : -level) * it.trade.qty;
      else pnl += it.trade.pnl;
    }
    return { level, pnl, delta: pnl - actual };
  });
}

/** 刻みに沿った候補の水準を8段階つくる */
function levelsFor(max: number, tickSize: number): number[] {
  if (!(max > 0) || !(tickSize > 0)) return [];
  const step = Math.max(tickSize, Math.ceil(max / 8 / tickSize) * tickSize);
  const out: number[] = [];
  for (let v = step; v <= max + step / 2 && out.length < 8; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

function execOf(items: Excursion[], tickSize: number): ExecStats {
  const trades = items.map((i) => i.trade);
  const actual = trades.reduce((a, t) => a + t.pnl, 0);
  const totalMfe = items.reduce((a, i) => a + i.mfeMoney, 0);

  // 逆行は勝ち負けで意味が違うので分けて見る
  const losers = items.filter((i) => i.trade.pnl < 0);
  const winners = items.filter((i) => i.trade.pnl > 0);
  const loseMae = div(losers.reduce((a, i) => a + i.mae, 0), losers.length);
  const loseLoss = div(-losers.reduce((a, i) => a + i.trade.pnl / i.trade.qty, 0), losers.length);
  const winMae = div(winners.reduce((a, i) => a + i.mae, 0), winners.length);

  const maxMfe = items.length ? Math.max(...items.map((i) => i.mfe)) : 0;
  const maxMae = items.length ? Math.max(...items.map((i) => i.mae)) : 0;
  const captureRate = div(actual, totalMfe);

  return {
    avgMae: div(items.reduce((a, i) => a + i.mae, 0), items.length),
    avgMfe: div(items.reduce((a, i) => a + i.mfe, 0), items.length),
    maxMae,
    maxMfe,
    captureRate,
    missRate: totalMfe > 0 ? 1 - captureRate : 0,
    loseMae,
    loseLoss,
    winMae,
    gaveBack: items.filter((i) => i.mfe > 0 && i.trade.pnl < 0).length,
    endured: items.filter((i) => i.mae > 0 && i.trade.pnl > 0).length,
    items,
    tpSweep: sweep(items, levelsFor(maxMfe, tickSize), 'tp', actual),
    slSweep: sweep(items, levelsFor(maxMae, tickSize), 'sl', actual),
  };
}

// ---- まとめ ---------------------------------------------------------------

export type HistBin = { from: number; to: number; count: number };

function histogram(trades: Trade[], bins = 9): HistBin[] {
  if (trades.length === 0) return [];
  const vals = trades.map((t) => t.pnl);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (lo === hi) return [{ from: lo, to: hi, count: trades.length }];
  const w = (hi - lo) / bins;
  return Array.from({ length: bins }, (_, i) => {
    const from = lo + w * i;
    const to = i === bins - 1 ? hi : from + w;
    return {
      from,
      to,
      count: vals.filter((v) => (i === bins - 1 ? v >= from && v <= to : v >= from && v < to)).length,
    };
  });
}

export type Analysis = {
  all: SideStats;
  long: SideStats;
  short: SideStats;
  totalQty: number;
  turnover: number;
  risk: RiskStats;
  time: TimeStats;
  exec: ExecStats;
  hist: HistBin[];
};

/**
 * 建玉中の値動きを求めた状態から集計する。
 * 過去のチャレンジは MAE/MFE を記録済みなので、ティックを読み直さずにここへ渡せる。
 */
export function analyzeFrom(items: Excursion[], cancelled: number, tickSize: number): Analysis {
  const trades = items.map((i) => i.trade);
  return {
    all: statsOf(trades),
    long: statsOf(trades.filter((t) => t.side === 'long')),
    short: statsOf(trades.filter((t) => t.side === 'short')),
    totalQty: trades.reduce((a, t) => a + t.qty, 0),
    turnover: trades.reduce((a, t) => a + (t.entry + t.exit) * t.qty, 0),
    risk: riskOf(trades),
    time: timeOf(trades, cancelled),
    exec: execOf(items, tickSize),
    hist: histogram(trades),
  };
}

/** いま再生中のチャレンジを、ティックを走査して集計する */
export function analyze(log: ChallengeLog, ticks: Tick[], tickSize: number): Analysis {
  return analyzeFrom(
    log.trades.map((t) => excursionOf(t, ticks)),
    log.cancelled,
    tickSize,
  );
}
