import type { Candle, Tick } from './types';

export type Interval = { label: string; seconds: number };

export const INTERVALS: Interval[] = [
  { label: '5分', seconds: 300 },
  { label: '3分', seconds: 180 },
  { label: '1分', seconds: 60 },
  { label: '30秒', seconds: 30 },
  { label: '15秒', seconds: 15 },
  { label: '5秒', seconds: 5 },
  { label: '1秒', seconds: 1 },
];

export type CandleState = {
  interval: number;
  candles: Candle[];
};

export function createCandleState(interval: number): CandleState {
  return { interval, candles: [] };
}

/**
 * ティックを1本取り込む。戻り値は更新/追加されたローソクと、新規足かどうか。
 * 返す Candle は内部配列と同一参照なので、呼び出し側は複製してからチャートへ渡す。
 */
export function addTick(state: CandleState, tick: Tick): { candle: Candle; isNew: boolean } {
  const bucket = Math.floor(tick.t / state.interval) * state.interval;
  const last = state.candles[state.candles.length - 1];

  if (last && last.time === bucket) {
    if (tick.price > last.high) last.high = tick.price;
    if (tick.price < last.low) last.low = tick.price;
    last.close = tick.price;
    last.volume += tick.size;
    return { candle: last, isNew: false };
  }

  const candle: Candle = {
    time: bucket,
    open: tick.price,
    high: tick.price,
    low: tick.price,
    close: tick.price,
    volume: tick.size,
  };
  state.candles.push(candle);
  return { candle, isNew: true };
}

/** ticks[0, count) を一括集計する（シーク時の再構築用） */
export function buildCandles(ticks: Tick[], count: number, interval: number): Candle[] {
  const state = createCandleState(interval);
  const end = Math.min(count, ticks.length);
  for (let i = 0; i < end; i++) addTick(state, ticks[i]);
  return state.candles;
}
