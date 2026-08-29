import { useCallback, useEffect, useRef, useState } from 'react';
import { addTick, buildCandles, createCandleState } from '../lib/candles';
import type { Candle, Tick } from '../lib/types';

/** 歩み値パネルに保持する行数 */
const TAPE_ROWS = 200;
/** UI state を書き戻す最短間隔(ms)。60fpsでの再描画コストを抑える */
const FLUSH_MS = 60;
/** 1フレームで処理するティックの上限。高倍速でも UI を固めない */
const MAX_TICKS_PER_FRAME = 8000;
/** これ以上の無約定時間は早送りする（昼休み等） */
const GAP_SKIP_SEC = 3;

export type ReplayStats = {
  last: number;
  prev: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
};

export type ReplaySink = {
  setCandles: (candles: Candle[]) => void;
  updateCandle: (candle: Candle) => void;
};

export type ReplayView = {
  cursor: number;
  clock: number;
  tape: Tick[];
  stats: ReplayStats;
};

const EMPTY_STATS: ReplayStats = {
  last: 0,
  prev: 0,
  open: 0,
  high: 0,
  low: 0,
  volume: 0,
  turnover: 0,
};

export function useReplay(
  ticks: Tick[],
  interval: number,
  sinkRef: React.RefObject<ReplaySink | null>,
) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [skipGaps, setSkipGaps] = useState(true);
  const [view, setView] = useState<ReplayView>({
    cursor: 0,
    clock: 0,
    tape: [],
    stats: EMPTY_STATS,
  });

  const candleRef = useRef(createCandleState(interval));
  const cursorRef = useRef(0);
  const clockRef = useRef(0);
  const tapeRef = useRef<Tick[]>([]);
  const statsRef = useRef<ReplayStats>(EMPTY_STATS);

  const playingRef = useRef(false);
  const speedRef = useRef(speed);
  const skipRef = useRef(skipGaps);
  const intervalRef = useRef(interval);
  const rafRef = useRef(0);
  const lastNowRef = useRef(0);
  const lastFlushRef = useRef(0);

  speedRef.current = speed;
  skipRef.current = skipGaps;

  const flush = useCallback(() => {
    lastFlushRef.current = performance.now();
    setView({
      cursor: cursorRef.current,
      clock: clockRef.current,
      tape: tapeRef.current.slice(0, TAPE_ROWS),
      stats: { ...statsRef.current },
    });
  }, []);

  /** ticks[0, index) を消化した状態を作り直す（シーク・足種変更用） */
  const rebuild = useCallback(
    (index: number) => {
      const end = Math.max(0, Math.min(index, ticks.length));
      const candles = buildCandles(ticks, end, intervalRef.current);
      candleRef.current = { interval: intervalRef.current, candles };

      const stats: ReplayStats = { ...EMPTY_STATS };
      if (end > 0) {
        stats.open = ticks[0].price;
        stats.high = ticks[0].price;
        stats.low = ticks[0].price;
        for (let i = 0; i < end; i++) {
          const tk = ticks[i];
          if (tk.price > stats.high) stats.high = tk.price;
          if (tk.price < stats.low) stats.low = tk.price;
          stats.volume += tk.size;
          stats.turnover += tk.value;
        }
        stats.last = ticks[end - 1].price;
        stats.prev = end > 1 ? ticks[end - 2].price : ticks[end - 1].price;
      }
      statsRef.current = stats;

      const from = Math.max(0, end - TAPE_ROWS);
      tapeRef.current = ticks.slice(from, end).reverse();

      cursorRef.current = end;
      clockRef.current = end > 0 ? ticks[end - 1].rt : (ticks[0]?.rt ?? 0);

      sinkRef.current?.setCandles(candles);
      flush();
    },
    [ticks, sinkRef, flush],
  );

  /** ティック1本を消化して chart / tape / stats に反映 */
  const consume = useCallback(
    (tick: Tick) => {
      const { candle } = addTick(candleRef.current, tick);
      sinkRef.current?.updateCandle(candle);

      const s = statsRef.current;
      s.prev = s.last || tick.price;
      s.last = tick.price;
      if (!s.open) {
        s.open = tick.price;
        s.high = tick.price;
        s.low = tick.price;
      }
      if (tick.price > s.high) s.high = tick.price;
      if (tick.price < s.low) s.low = tick.price;
      s.volume += tick.size;
      s.turnover += tick.value;

      tapeRef.current.unshift(tick);
      if (tapeRef.current.length > TAPE_ROWS * 2) {
        tapeRef.current.length = TAPE_ROWS;
      }
    },
    [sinkRef],
  );

  const stop = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
  }, []);

  // ---- 再生ループ ------------------------------------------------------
  useEffect(() => {
    if (!playing || ticks.length === 0) return;

    lastNowRef.current = performance.now();

    const frame = (now: number) => {
      // タブ復帰などで dt が跳ねるのを抑える
      const dt = Math.min((now - lastNowRef.current) / 1000, 0.25);
      lastNowRef.current = now;

      let clock = clockRef.current + dt * speedRef.current;
      let cursor = cursorRef.current;

      // 無約定の空白時間は詰める（昼休み・板寄せ待ちなど）
      if (skipRef.current && cursor < ticks.length) {
        const next = ticks[cursor].rt;
        if (next - clock > GAP_SKIP_SEC) clock = next;
      }

      let processed = 0;
      while (cursor < ticks.length && ticks[cursor].rt <= clock) {
        consume(ticks[cursor]);
        cursor++;
        if (++processed >= MAX_TICKS_PER_FRAME) {
          // 上限に当たったら時計を巻き戻して取りこぼしを防ぐ
          clock = ticks[cursor - 1].rt;
          break;
        }
      }

      cursorRef.current = cursor;
      clockRef.current = clock;

      const finished = cursor >= ticks.length;
      if (finished || now - lastFlushRef.current >= FLUSH_MS) flush();

      if (finished) {
        stop();
        return;
      }
      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, ticks, consume, flush, stop]);

  // ---- データ差し替え / 足種変更 ---------------------------------------
  useEffect(() => {
    playingRef.current = false;
    setPlaying(false);
    intervalRef.current = interval;
    rebuild(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticks]);

  useEffect(() => {
    intervalRef.current = interval;
    rebuild(cursorRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval]);

  // ---- 操作 ------------------------------------------------------------
  const play = useCallback(() => {
    if (ticks.length === 0) return;
    if (cursorRef.current >= ticks.length) rebuild(0);
    playingRef.current = true;
    setPlaying(true);
  }, [ticks.length, rebuild]);

  const pause = useCallback(() => stop(), [stop]);

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [play, pause]);

  const seek = useCallback(
    (index: number) => {
      stop();
      rebuild(index);
    },
    [stop, rebuild],
  );

  const stepTick = useCallback(
    (n = 1) => {
      stop();
      let cursor = cursorRef.current;
      for (let i = 0; i < n && cursor < ticks.length; i++) {
        consume(ticks[cursor]);
        cursor++;
      }
      cursorRef.current = cursor;
      clockRef.current = cursor > 0 ? ticks[cursor - 1].rt : clockRef.current;
      flush();
    },
    [stop, ticks, consume, flush],
  );

  return {
    playing,
    speed,
    setSpeed,
    skipGaps,
    setSkipGaps,
    total: ticks.length,
    ...view,
    play,
    pause,
    toggle,
    seek,
    stepTick,
  };
}
