/**
 * テクニカル指標の計算。
 *
 * 再生中は「まだ確定していない最新の足」の終値が毎フレーム変わるため、
 * 各指標に「全期間を一括で出す」関数と「最終足だけを出し直す」関数を用意する。
 * 一括版はシーク・足変更・設定変更のときだけ呼ぶ。
 */

export type LinePoint = { time: number; value: number };

// ---- 単純移動平均 ------------------------------------------------------

/** closes[i] を終端とする period 本の単純移動平均。足りなければ undefined */
export function smaAt(closes: number[], i: number, period: number): number | undefined {
  if (period < 1 || i < period - 1) return undefined;
  let sum = 0;
  for (let k = i - period + 1; k <= i; k++) sum += closes[k];
  return sum / period;
}

/** 全期間の移動平均。period に満たない区間は点を打たない */
export function smaSeries(times: number[], closes: number[], period: number): LinePoint[] {
  const out: LinePoint[] = [];
  if (period < 1 || closes.length < period) return out;
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out.push({ time: times[i], value: sum / period });
  }
  return out;
}

// ---- ボリンジャーバンド ------------------------------------------------

export type Band = { mid: number; upper: number; lower: number };

/** 母集団標準偏差（BBの慣例に合わせて n で割る） */
function stdev(closes: number[], from: number, to: number, mean: number): number {
  let acc = 0;
  for (let k = from; k <= to; k++) {
    const d = closes[k] - mean;
    acc += d * d;
  }
  return Math.sqrt(acc / (to - from + 1));
}

export function bollingerAt(
  closes: number[],
  i: number,
  period: number,
  sigma: number,
): Band | undefined {
  const mid = smaAt(closes, i, period);
  if (mid === undefined) return undefined;
  const sd = stdev(closes, i - period + 1, i, mid);
  return { mid, upper: mid + sigma * sd, lower: mid - sigma * sd };
}

export type BandSeries = { mid: LinePoint[]; upper: LinePoint[]; lower: LinePoint[] };

export function bollingerSeries(
  times: number[],
  closes: number[],
  period: number,
  sigma: number,
): BandSeries {
  const out: BandSeries = { mid: [], upper: [], lower: [] };
  for (let i = period - 1; i < closes.length; i++) {
    const b = bollingerAt(closes, i, period, sigma);
    if (!b) continue;
    out.mid.push({ time: times[i], value: b.mid });
    out.upper.push({ time: times[i], value: b.upper });
    out.lower.push({ time: times[i], value: b.lower });
  }
  return out;
}

// ---- RSI (Wilder) ------------------------------------------------------

/**
 * RSI は前の足の平均損益を引き継ぐ再帰計算なので、確定済みの状態を持ち回る。
 * confirmed = この足まで avgGain/avgLoss に織り込み済み、という意味。
 */
export type RsiState = {
  period: number;
  /** 進行中の足を暫定計算できるだけの確定状態があるか */
  ready: boolean;
  confirmed: number;
  avgGain: number;
  avgLoss: number;
};

function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function smooth(prev: number, add: number, period: number): number {
  return (prev * (period - 1) + add) / period;
}

const EMPTY_STATE = (period: number): RsiState => ({
  period,
  ready: false,
  confirmed: -1,
  avgGain: 0,
  avgLoss: 0,
});

/**
 * 全期間のRSIと、最終足の1本手前まで確定させた状態を返す。
 * 最終足は進行中なので確定させない。
 * 足が period+2 本に満たない間は暫定計算の土台が作れないため ready=false を返し、
 * 呼び出し側は毎回この関数で作り直す（本数が少ないので負荷は無視できる）。
 */
export function rsiSeries(
  times: number[],
  closes: number[],
  period: number,
): { points: LinePoint[]; state: RsiState } {
  const n = closes.length;
  const points: LinePoint[] = [];
  if (period < 2 || n < period + 1) return { points, state: EMPTY_STATE(period) };

  let g = 0;
  let l = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  g /= period;
  l /= period;
  points.push({ time: times[period], value: rsiFrom(g, l) });

  const state: RsiState = { period, ready: n >= period + 2, confirmed: period, avgGain: g, avgLoss: l };

  for (let i = period + 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    const ng = smooth(state.avgGain, d > 0 ? d : 0, period);
    const nl = smooth(state.avgLoss, d < 0 ? -d : 0, period);
    points.push({ time: times[i], value: rsiFrom(ng, nl) });
    // 最終足だけは進行中なので織り込まない
    if (i <= n - 2) {
      state.avgGain = ng;
      state.avgLoss = nl;
      state.confirmed = i;
    }
  }
  return { points, state };
}

/** state を index の足まで確定させる（足が閉じたときに呼ぶ） */
export function rsiAdvance(state: RsiState, closes: number[], index: number): void {
  for (let i = state.confirmed + 1; i <= index; i++) {
    if (i < 1) continue;
    const d = closes[i] - closes[i - 1];
    state.avgGain = smooth(state.avgGain, d > 0 ? d : 0, state.period);
    state.avgLoss = smooth(state.avgLoss, d < 0 ? -d : 0, state.period);
    state.confirmed = i;
  }
}

/** 確定状態を壊さずに index の暫定RSIを覗く（進行中の足用） */
export function rsiPeek(state: RsiState, closes: number[], index: number): number | undefined {
  if (!state.ready || index <= state.confirmed) return undefined;
  let g = state.avgGain;
  let l = state.avgLoss;
  for (let i = state.confirmed + 1; i <= index; i++) {
    const d = closes[i] - closes[i - 1];
    g = smooth(g, d > 0 ? d : 0, state.period);
    l = smooth(l, d < 0 ? -d : 0, state.period);
  }
  return rsiFrom(g, l);
}

// ---- VWAP --------------------------------------------------------------

/**
 * 出来高加重平均価格（その日に売買が成立した値段の平均）。
 *
 * 移動平均と違って「直近◯本」ではなく、その日の寄り付きからの累計で引く。
 * 日付が変わったら累計を切り直す（前日の売買は今日の基準値にならない）。
 *
 * RSIと同じく、進行中の足を織り込まない確定状態を持ち回る。
 * confirmed = この足まで累計に入れ終わった、という意味。
 */
export type VwapState = {
  confirmed: number;
  /** 累計の 値段×出来高 */
  pv: number;
  /** 累計の出来高 */
  vol: number;
  /** 累計を始めた日（epoch日）。またいだら切り直す */
  day: number;
};

/** 時刻がどの日に属するか。時刻はJSTの壁時計をUTC秒にしてあるので、そのまま割ればJSTの日付になる */
const dayOf = (time: number) => Math.floor(time / 86400);

const emptyVwap = (): VwapState => ({ confirmed: -1, pv: 0, vol: 0, day: Number.NaN });

/** state を index の足まで確定させる（足が閉じたときに呼ぶ） */
export function vwapAdvance(
  state: VwapState,
  times: number[],
  typical: number[],
  volumes: number[],
  index: number,
): void {
  for (let i = state.confirmed + 1; i <= index; i++) {
    const d = dayOf(times[i]);
    if (d !== state.day) {
      state.day = d;
      state.pv = 0;
      state.vol = 0;
    }
    state.pv += typical[i] * volumes[i];
    state.vol += volumes[i];
    state.confirmed = i;
  }
}

/** 確定状態を壊さずに index の暫定VWAPを覗く（進行中の足用） */
export function vwapPeek(
  state: VwapState,
  times: number[],
  typical: number[],
  volumes: number[],
  index: number,
): number | undefined {
  if (index <= state.confirmed) return undefined;
  let { pv, vol, day } = state;
  for (let i = state.confirmed + 1; i <= index; i++) {
    const d = dayOf(times[i]);
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    pv += typical[i] * volumes[i];
    vol += volumes[i];
  }
  // 出来高ゼロの足しか無い間は平均が出せない
  return vol > 0 ? pv / vol : undefined;
}

/**
 * 全期間のVWAPと、最終足の1本手前まで確定させた状態を返す。
 * 最終足は進行中なので確定させない。
 */
export function vwapSeries(
  times: number[],
  typical: number[],
  volumes: number[],
): { points: LinePoint[]; state: VwapState } {
  const n = times.length;
  const points: LinePoint[] = [];
  const state = emptyVwap();
  for (let i = 0; i < n - 1; i++) {
    vwapAdvance(state, times, typical, volumes, i);
    if (state.vol > 0) points.push({ time: times[i], value: state.pv / state.vol });
  }
  if (n > 0) {
    const v = vwapPeek(state, times, typical, volumes, n - 1);
    if (v !== undefined) points.push({ time: times[n - 1], value: v });
  }
  return { points, state };
}
