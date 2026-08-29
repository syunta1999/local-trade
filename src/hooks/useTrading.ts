import { useCallback, useEffect, useRef, useState } from 'react';
import { createLog, type ChallengeLog } from '../lib/analysis';
import { loadStateCsv, saveStateCsv } from '../lib/csvfile';
import {
  checkRules,
  DEFAULT_RULES,
  RULES_FILE,
  RULES_HEAD,
  rulesFromCsv,
  rulesToRows,
  type RuleId,
  type Rules,
  type RuleState,
} from '../lib/rules';
import { playAlert, playFill, playTape } from '../lib/sound';
import {
  cancelOrder,
  cancelSide,
  createTrading,
  LOT,
  matchTick,
  placeOrder,
  type Order,
  type OrderKind,
  type OrderSide,
  type Position,
  type Trade,
} from '../lib/trading';
import type { Tick } from '../lib/types';

/** 直近の約定を板で光らせる時間(ms) */
const FLASH_MS = 900;

/** パネルの描画に必要なぶんだけ取り出した写し */
export type TradingView = {
  orders: Order[];
  long: Position;
  short: Position;
  trades: Trade[];
  realized: number;
};

/** チャレンジの進み具合。中身の配列は持たず件数だけ */
export type ChallengeView = {
  recording: boolean;
  trades: number;
  seeks: number;
  cancelled: number;
  startedAt: number;
};

/** その日の何分か。エントリー期限の判定に使う */
function minuteOfDay(t: number): number {
  const d = new Date(t * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

const snapshot = (s: ReturnType<typeof createTrading>): TradingView => ({
  orders: [...s.orders],
  long: { ...s.long },
  short: { ...s.short },
  trades: [...s.trades],
  realized: s.realized,
});

const EMPTY_VIEW: TradingView = snapshot(createTrading());

export type ChallengeMeta = { fileName: string; symbol: string | null; dateLabel: string };

export function useTrading() {
  const stateRef = useRef(createTrading());
  const [view, setView] = useState<TradingView>(EMPTY_VIEW);
  const [mode, setMode] = useState<OrderKind>('open');
  const [lot, setLot] = useState(LOT);
  const [message, setMessage] = useState<string | null>(null);
  /** 直近に約定した値段。板を光らせるだけの用途 */
  const [flash, setFlash] = useState<{ price: number; side: OrderSide } | null>(null);
  const flashTimer = useRef(0);

  /**
   * チャレンジの記録。シークで建玉は消えるが、ここに積んだ取引は残る。
   * 再生ループから触るので実体は ref に置き、画面用の件数だけ state に写す。
   */
  const logRef = useRef<ChallengeLog | null>(null);
  const recordingRef = useRef(false);
  const [challenge, setChallenge] = useState<ChallengeView | null>(null);

  /** 自分ルールと、いま破っているもの */
  const [rules, setRules] = useState<Rules>(DEFAULT_RULES);
  const rulesRef = useRef(rules);
  const [violations, setViolations] = useState<RuleId[]>([]);
  const violRef = useRef<Set<RuleId>>(new Set());
  /** 記録中のチャレンジの取引。お題の判定に使うのでシークしても残る */
  const [challengeTrades, setChallengeTrades] = useState<Trade[]>([]);

  const commit = useCallback(() => setView(snapshot(stateRef.current)), []);

  // 保存してあるルールを読み込む
  useEffect(() => {
    let alive = true;
    void (async () => {
      const text = await loadStateCsv(RULES_FILE);
      if (!alive || !text) return;
      const next = rulesFromCsv(text);
      rulesRef.current = next;
      setRules(next);
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** 破ったルールを立てる。新しく立ったものがあれば音を鳴らす */
  const raise = useCallback((hits: RuleId[]) => {
    let added = false;
    for (const h of hits) {
      if (violRef.current.has(h)) continue;
      violRef.current.add(h);
      added = true;
    }
    if (!added) return;
    setViolations([...violRef.current]);
    playAlert();
  }, []);

  const clearViolation = useCallback((id: RuleId) => {
    if (!violRef.current.delete(id)) return;
    setViolations([...violRef.current]);
  }, []);

  const saveTimer = useRef(0);
  const changeRule = useCallback((id: RuleId, patch: Partial<RuleState>) => {
    setRules((prev) => {
      const next = { ...prev, [id]: { ...prev[id], ...patch } };
      rulesRef.current = next;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(
        () => void saveStateCsv(rulesToRows(next), RULES_HEAD, RULES_FILE),
        400,
      );
      return next;
    });
  }, []);

  const syncChallenge = useCallback(() => {
    const l = logRef.current;
    setChallengeTrades(l ? [...l.trades] : []);
    setChallenge(
      l
        ? {
            recording: recordingRef.current,
            trades: l.trades.length,
            seeks: l.seeks,
            cancelled: l.cancelled,
            startedAt: l.startedAt,
          }
        : null,
    );
  }, []);

  const showFlash = useCallback((price: number, side: OrderSide) => {
    setFlash({ price, side });
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  }, []);

  /** 再生ループから毎ティック呼ばれる。板に出ている注文を突き合わせる */
  const onTick = useCallback(
    (tick: Tick) => {
      const log = logRef.current;
      if (log && recordingRef.current) log.toClock = tick.t;
      playTape(tick.size, tick.dir);

      const st = stateRef.current;
      const fills = matchTick(st, tick.price, tick.t, tick.n);

      // 建玉があるあいだは毎ティック、損切り幅や最大損失を見張る
      raise(
        checkRules({
          rules: rulesRef.current,
          trades: st.trades,
          long: st.long,
          short: st.short,
          last: tick.price,
          clock: tick.t,
          clockMin: minuteOfDay(tick.t),
          realized: st.realized,
        }),
      );

      if (fills.length === 0) return;

      if (log && recordingRef.current) {
        for (const f of fills) if (f.trade) log.trades.push(f.trade);
      }
      const lastFill = fills[fills.length - 1];
      showFlash(lastFill.price, lastFill.order.side);
      playFill(lastFill.order.side);
      commit();
      if (fills.some((f) => f.trade)) syncChallenge();
    },
    [commit, raise, showFlash, syncChallenge],
  );
  // 再生ループ(rAF)から読むので、レンダー中ではなく副作用で差し替える
  const onTickRef = useRef<((tick: Tick) => void) | null>(null);
  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  /** 板をダブルクリックしたときの発注 */
  const place = useCallback(
    (side: OrderSide, price: number, at: number) => {
      const st = stateRef.current;
      // 発注そのものは止めない。破ったことを見せるのが目的
      raise(
        checkRules({
          rules: rulesRef.current,
          trades: st.trades,
          long: st.long,
          short: st.short,
          last: price,
          clock: at,
          clockMin: minuteOfDay(at),
          realized: st.realized,
          order: { qty: lot, kind: mode },
        }),
      );

      const res = placeOrder(st, { side, kind: mode, price, qty: lot, at });
      if (!res.ok) {
        setMessage(res.error);
        window.setTimeout(() => setMessage(null), 2500);
        return;
      }
      setMessage(null);
      commit();
    },
    [mode, lot, commit, raise],
  );

  const noteCancel = useCallback(
    (n: number) => {
      const log = logRef.current;
      if (n > 0 && log && recordingRef.current) {
        log.cancelled += n;
        syncChallenge();
      }
    },
    [syncChallenge],
  );

  const cancel = useCallback(
    (id: number) => {
      if (cancelOrder(stateRef.current, id)) {
        noteCancel(1);
        commit();
      }
    },
    [commit, noteCancel],
  );

  /** 板の片側（売り or 買い）の注文をまとめて取り消す */
  const cancelBySide = useCallback(
    (side: OrderSide) => {
      const n = cancelSide(stateRef.current, side);
      if (n > 0) {
        noteCancel(n);
        commit();
      }
    },
    [commit, noteCancel],
  );

  /** シークやCSV差し替えで建玉と注文を無かったことにする。チャレンジの記録は残す */
  const reset = useCallback(() => {
    stateRef.current = createTrading();
    setMessage(null);
    setFlash(null);
    commit();
  }, [commit]);

  /** 巻き戻した回数を数える。多いほど成績の参考度が下がる */
  const noteSeek = useCallback(() => {
    const log = logRef.current;
    if (log && recordingRef.current) {
      log.seeks += 1;
      syncChallenge();
    }
  }, [syncChallenge]);

  const startChallenge = useCallback(
    (meta: ChallengeMeta, clock: number) => {
      logRef.current = createLog(meta.fileName, meta.symbol, meta.dateLabel, clock);
      recordingRef.current = true;
      violRef.current.clear();
      setViolations([]);
      syncChallenge();
    },
    [syncChallenge],
  );

  const stopChallenge = useCallback(() => {
    const log = logRef.current;
    if (!log) return null;
    log.endedAt = Date.now();
    recordingRef.current = false;
    syncChallenge();
    return log;
  }, [syncChallenge]);

  /** 分析用に今の記録を写して渡す */
  const snapshotLog = useCallback((): ChallengeLog | null => {
    const l = logRef.current;
    return l ? { ...l, trades: [...l.trades] } : null;
  }, []);

  const changeLot = useCallback((next: number) => {
    const n = Math.floor(next / LOT) * LOT;
    setLot(Math.max(LOT, Math.min(n, 1_000_000)));
  }, []);

  return {
    ...view,
    mode,
    setMode,
    lot,
    changeLot,
    message,
    flash,
    onTickRef,
    place,
    cancel,
    cancelBySide,
    reset,
    noteSeek,
    challenge,
    challengeTrades,
    rules,
    changeRule,
    violations,
    clearViolation,
    startChallenge,
    stopChallenge,
    snapshotLog,
  };
}
