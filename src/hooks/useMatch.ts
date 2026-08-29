import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BOTS,
  createBot,
  stepBot,
  viewOf,
  warmBot,
  type BotRun,
  type BotView,
  type Level,
} from '../lib/bot';
import { playBotFill } from '../lib/sound';
import type { Position, Trade } from '../lib/trading';
import type { Tick } from '../lib/types';

/** 画面の書き戻し間隔(ms) */
const FLUSH_MS = 150;

/** 1ラウンドの長さの候補（相場の時間で数える） */
export const DURATIONS = [
  { sec: 600, label: '10分' },
  { sec: 1800, label: '30分' },
  { sec: 3600, label: '60分' },
];

/** 勝負がついた時点の全員の成績 */
export type Standing = {
  name: string;
  color: string;
  total: number;
  trades: number;
  wins: number;
  isPlayer: boolean;
};

export type PlayerSnapshot = {
  long: Position;
  short: Position;
  realized: number;
  trades: Trade[];
};

export type MatchView = {
  active: boolean;
  /** 残り時間(秒)。相場の時間で数える */
  remain: number;
  duration: number;
  /** ラウンドの範囲（ティックの通し番号）。ミニチャートの横軸に使う */
  startN: number;
  nowN: number;
  bots: BotView[];
  /** 勝負がついたときだけ入る */
  result: { last: number; rows: Standing[] } | null;
};

const EMPTY: MatchView = {
  active: false,
  remain: 0,
  duration: 0,
  startN: 0,
  nowN: 0,
  bots: [],
  result: null,
};

/**
 * 対戦の進行役。botを走らせ、ラウンドの終わりを見張る。
 * botは matchTick で約定するので、プレイヤーと完全に同じ条件で戦う。
 */
export function useMatch(
  tickSize: number,
  /** botが1回に使う株数。プレイヤーのロット設定に合わせる */
  lotRef: React.RefObject<number>,
  /** 勝負がついた瞬間のプレイヤーの成績を取るための窓口 */
  playerRef: React.RefObject<PlayerSnapshot>,
  /** 開始前の助走に使う。ここまでに流れ終わったぶんだけ見せる */
  ticksRef: React.RefObject<Tick[]>,
) {
  const [view, setView] = useState<MatchView>(EMPTY);
  const botsRef = useRef<BotRun[]>([]);
  const activeRef = useRef(false);
  const endRef = useRef(0);
  const clockRef = useRef(0);
  const startNRef = useRef(0);
  const nowNRef = useRef(0);
  const durRef = useRef(0);
  const pendingRef = useRef<{ level: Level; sec: number } | null>(null);
  const flushRef = useRef(0);

  const commit = useCallback((result: MatchView['result'] = null) => {
    flushRef.current = performance.now();
    setView({
      active: activeRef.current,
      remain: Math.max(0, endRef.current - clockRef.current),
      duration: durRef.current,
      startN: startNRef.current,
      nowN: nowNRef.current,
      bots: botsRef.current.map(viewOf),
      result,
    });
  }, []);

  /** 決着。全員をその瞬間の値段で評価して順位を出す */
  const finish = useCallback(
    (last: number) => {
      activeRef.current = false;
      const p = playerRef.current;
      const rows: Standing[] = [
        {
          name: 'あなた',
          color: '#f0b429',
          total:
            (p.long.qty ? (last - p.long.avg) * p.long.qty : 0) +
            (p.short.qty ? (p.short.avg - last) * p.short.qty : 0) +
            p.realized,
          trades: p.trades.length,
          wins: p.trades.filter((t) => t.pnl > 0).length,
          isPlayer: true,
        },
        ...botsRef.current.map((b) => {
          const v = viewOf(b);
          const un =
            v.side === 'long'
              ? (last - v.avg) * v.qty
              : v.side === 'short'
                ? (v.avg - last) * v.qty
                : 0;
          return {
            name: v.name,
            color: v.color,
            total: v.realized + un,
            trades: v.trades.length,
            wins: v.wins,
            isPlayer: false,
          };
        }),
      ];
      rows.sort((a, b) => b.total - a.total);
      commit({ last, rows });
    },
    [commit, playerRef],
  );

  const onTick = useCallback(
    (tick: Tick) => {
      if (pendingRef.current) {
        // 開始位置は「最初に流れてきたティック」。押した瞬間の相場から始まる
        const { level, sec } = pendingRef.current;
        pendingRef.current = null;
        botsRef.current = BOTS.map((def) => createBot(def, tickSize, level, tick.n));
        // ここまでに流れ終わったぶんで、バンドや値動きの大きさを作らせる。
        // 売買はしないので、成績はここからゼロで始まる
        const all = ticksRef.current;
        if (all.length) for (const b of botsRef.current) warmBot(b, all, 0, tick.n);
        endRef.current = tick.t + sec;
        durRef.current = sec;
        startNRef.current = tick.n;
        activeRef.current = true;
      }
      if (!activeRef.current) return;

      clockRef.current = tick.t;
      nowNRef.current = tick.n;
      let filled = false;
      for (const bot of botsRef.current) {
        if (stepBot(bot, tick, lotRef.current).length > 0) filled = true;
      }
      if (filled) playBotFill();

      if (tick.t >= endRef.current) {
        finish(tick.price);
        return;
      }
      if (filled || performance.now() - flushRef.current >= FLUSH_MS) commit();
    },
    [tickSize, lotRef, ticksRef, commit, finish],
  );

  const onTickRef = useRef<((tick: Tick) => void) | null>(null);
  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  const start = useCallback(
    (level: Level, sec: number) => {
      pendingRef.current = { level, sec };
      botsRef.current = [];
      activeRef.current = false;
      durRef.current = sec;
      endRef.current = 0;
      commit();
    },
    [commit],
  );

  /** 時間切れを待たずに終える */
  const giveUp = useCallback(
    (last: number) => {
      if (!activeRef.current) return;
      finish(last);
    },
    [finish],
  );

  /** シークやCSV差し替えでラウンドは無効になる。同じ条件で走っていないため */
  const reset = useCallback(() => {
    pendingRef.current = null;
    activeRef.current = false;
    botsRef.current = [];
    endRef.current = 0;
    startNRef.current = 0;
    nowNRef.current = 0;
    setView(EMPTY);
  }, []);

  const clearResult = useCallback(() => {
    setView((v) => (v.result ? { ...v, result: null } : v));
  }, []);

  return { ...view, onTickRef, start, giveUp, reset, clearResult };
}
