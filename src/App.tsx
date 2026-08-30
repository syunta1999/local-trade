import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chart } from './components/Chart';
import { Controls } from './components/Controls';
import { IndicatorBar } from './components/IndicatorBar';
import { Analysis, Overall } from './components/Analysis';
import { DailyCard } from './components/DailyCard';
import { Help } from './components/Help';
import { MatchCard, MatchResult } from './components/Match';
import { RulePanel } from './components/RulePanel';
import { Tape } from './components/Tape';
import { TradePanel } from './components/TradePanel';
import { useMatch, type PlayerSnapshot } from './hooks/useMatch';
import { useReplay, type ReplaySink } from './hooks/useReplay';
import { useSettings } from './hooks/useSettings';
import { useTrading } from './hooks/useTrading';
import { analyze, type ChallengeLog } from './lib/analysis';
import { BotBoard } from './components/BotBoard';
import type { Level } from './lib/bot';
import { decodeCsv, formatClock, parseCsv } from './lib/csv';
import { loadGhost, resetChallenges, saveChallenge, type GhostTrade } from './lib/csvfile';
import { DEFAULT_SETTINGS, type Box } from './lib/settings';
import { applyTheme } from './lib/themes';
import {
  setBgm,
  setLargeSize as setTapeLarge,
  setSoundChannel,
  soundPrefs,
  stopBgm,
  unlockSound,
  type SoundChannel,
} from './lib/sound';
import { computePnl, detectTickSize, LOT } from './lib/trading';
import type { Tick } from './lib/types';
import type { IndicatorUi, ParsedCsv } from './lib/types';

/** 起動時に読むCSV */
const DEFAULT_FILE = 'default.csv';
/** 開発サーバーのAPI。起動後に置いたファイルもここなら確実に返る */
const apiUrl = (name: string) => `/api/data/file/${encodeURIComponent(name)}`;
/** ビルド後（APIが無いとき）用の静的配信パス */
const staticUrl = (name: string) => `${import.meta.env.BASE_URL}data/${encodeURIComponent(name)}`;

/**
 * public/data のCSVを取る。APIを優先し、無ければ静的配信に落ちる。
 * 見つからないときは index.html が 200 で返ってくるので content-type で弾く。
 */
async function fetchCsv(name: string): Promise<ArrayBuffer> {
  let last = '';
  for (const url of [apiUrl(name), staticUrl(name)]) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        last = `${res.status} ${res.statusText}`;
        continue;
      }
      if (res.headers.get('content-type')?.includes('text/html')) {
        last = 'ファイルが見つかりません';
        continue;
      }
      return await res.arrayBuffer();
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(last || '読み込めませんでした');
}
const LARGE_SIZES = [1000, 3000, 5000, 10000];
const EMPTY_GHOST: GhostTrade[] = [];

const nf = new Intl.NumberFormat('ja-JP');

export default function App() {
  const [data, setData] = useState<ParsedCsv | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [intervalSec, setIntervalSec] = useState(DEFAULT_SETTINGS.interval);
  const [largeSize, setLargeSize] = useState(DEFAULT_SETTINGS.largeSize);
  const [ind, setInd] = useState<IndicatorUi>(DEFAULT_SETTINGS.ind);
  /** public/data にあるCSV一覧 */
  const [files, setFiles] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>(DEFAULT_FILE);

  const sinkRef = useRef<ReplaySink | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [theme, setTheme] = useState(DEFAULT_SETTINGS.theme);
  /**
   * 配色を当てる。子より先に効かせたいので副作用ではなくレンダー中に呼ぶ。
   * useEffect だと子（Chart）の副作用のほうが先に走ってしまい、
   * 差し替わる前のCSS変数を読んでチャートだけ前の色のまま残る。
   */
  const themeApplied = useRef('');
  if (themeApplied.current !== theme) {
    themeApplied.current = theme;
    applyTheme(theme);
  }

  const ticks = useMemo(() => data?.ticks ?? [], [data]);
  /** 呼値の刻み。銘柄ごとに違うのでデータから割り出す */
  const tickSize = useMemo(() => detectTickSize(ticks.map((tk) => tk.price)), [ticks]);

  const trading = useTrading();

  /** botはプレイヤーと同じロットで戦う。決着の集計にも今の成績が要る */
  const lotRef = useRef(LOT);
  lotRef.current = trading.lot;
  const playerRef = useRef<PlayerSnapshot>({
    long: trading.long,
    short: trading.short,
    realized: 0,
    trades: [],
  });
  playerRef.current = {
    long: trading.long,
    short: trading.short,
    realized: trading.realized,
    trades: trading.trades,
  };
  const ticksRef = useRef(ticks);
  ticksRef.current = ticks;
  const match = useMatch(tickSize, lotRef, playerRef, ticksRef);

  // 再生ループからは1本の窓口しか呼べないので、ここで自分とbotに配る
  const tickRef = useRef<((tick: Tick) => void) | null>(null);
  const replay = useReplay(ticks, intervalSec, sinkRef, tickRef);
  const { onTickRef: toTrading } = trading;
  const { onTickRef: toMatch } = match;
  useEffect(() => {
    tickRef.current = (tk) => {
      toTrading.current?.(tk);
      toMatch.current?.(tk);
    };
  }, [toTrading, toMatch]);

  /** 分析中の記録。チャレンジ開始時のティックを覚えておき、CSVを差し替えても正しく集計する */
  const [analysisLog, setAnalysisLog] = useState<ChallengeLog | null>(null);
  const [showOverall, setShowOverall] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // どれも既定は非表示。必要になったらボタンで出す
  const [views, setViews] = useState({ rules: false, ghost: false, daily: false, match: false });
  const [level, setLevel] = useState<Level>(DEFAULT_SETTINGS.level);
  const [roundSec, setRoundSec] = useState(DEFAULT_SETTINGS.roundSec);
  const [matchBox, setMatchBox] = useState<Box>(DEFAULT_SETTINGS.matchBox);
  const [matchFold, setMatchFold] = useState(DEFAULT_SETTINGS.matchFold);
  const [botBox, setBotBox] = useState<Box>(DEFAULT_SETTINGS.botBox);
  const [botOpen, setBotOpen] = useState(DEFAULT_SETTINGS.botOpen);
  const [botFold, setBotFold] = useState(DEFAULT_SETTINGS.botFold);
  /** ヘッダーとフッターは畳める。畳んだぶんチャートが広がる */
  const [chrome, setChrome] = useState({
    header: DEFAULT_SETTINGS.header,
    footer: DEFAULT_SETTINGS.footer,
  });
  const [sound, setSound] = useState(soundPrefs);
  /** 歩み値はいつも見るものではないので畳める。畳むと板が広がる */
  const [tapeOpen, setTapeOpen] = useState(DEFAULT_SETTINGS.tapeOpen);
  const [ghost, setGhost] = useState<GhostTrade[]>([]);
  const challengeTicksRef = useRef<Tick[]>([]);
  const challengeTickSizeRef = useRef(1);

  const { reset: resetTrading, stopChallenge, startChallenge, snapshotLog, noteSeek } = trading;

  /** チャレンジを終えて記録を溜める */
  const finishChallenge = useCallback(() => {
    const log = stopChallenge();
    if (!log) return null;
    const done = { ...log, trades: [...log.trades] };
    // 1件も取引していないチャレンジは記録を汚すだけなので残さない
    if (done.trades.length > 0) {
      void saveChallenge(done, analyze(done, challengeTicksRef.current, challengeTickSizeRef.current));
    }
    return done;
  }, [stopChallenge]);

  // CSVを差し替えたら建玉と注文は無かったことにする。記録中なら区切って保存する
  const finishRef = useRef(finishChallenge);
  finishRef.current = finishChallenge;
  const recording = trading.challenge?.recording ?? false;
  const resetMatch = match.reset;
  useEffect(() => {
    if (recording) finishRef.current();
    resetTrading();
    resetMatch();
    // 銘柄が変わるので、記録中だったチャレンジと対戦はここで打ち切る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticks, resetTrading, resetMatch]);

  // シークは時間を巻き戻すので、その先で建てた玉は持ち越せない
  const { seek } = replay;
  const onSeek = useCallback(
    (index: number) => {
      noteSeek();
      resetTrading();
      // 巻き戻すと同じ条件で走っていないことになるので、対戦は無効にする
      resetMatch();
      seek(index);
    },
    [noteSeek, resetTrading, resetMatch, seek],
  );

  const onToggleChallenge = useCallback(() => {
    if (recording) {
      const done = finishChallenge();
      if (done) setAnalysisLog(done);
      return;
    }
    challengeTicksRef.current = ticks;
    challengeTickSizeRef.current = tickSize;
    startChallenge(
      {
        fileName: current,
        symbol: data?.symbol ?? null,
        dateLabel: data?.dateLabel ?? '',
      },
      Math.floor(replay.clock),
    );
  }, [recording, finishChallenge, ticks, tickSize, startChallenge, current, data, replay.clock]);

  // 同じCSVの前回の記録を「ゴースト」として読む
  useEffect(() => {
    let alive = true;
    void (async () => {
      const g = await loadGhost(current);
      if (alive) setGhost(g);
    })();
    return () => {
      alive = false;
    };
  }, [current, analysisLog]);

  // 大口の閾値は板の音の重みにも使う
  useEffect(() => {
    setTapeLarge(largeSize);
  }, [largeSize]);

  const onSound = useCallback((ch: SoundChannel, on: boolean) => {
    setSoundChannel(ch, on);
    setSound(soundPrefs());
    if (ch === 'bgm' && !on) stopBgm();
  }, []);

  // AudioContext はユーザー操作の中でしか起こせないので、最初のクリックで解錠する
  useEffect(() => {
    const once = () => unlockSound();
    window.addEventListener('pointerdown', once, { once: true });
    window.addEventListener('keydown', once, { once: true });
    return () => {
      window.removeEventListener('pointerdown', once);
      window.removeEventListener('keydown', once);
    };
  }, []);

  /**
   * 再生中だけBGMを流す。チャレンジ中は密度の高いほうに変わるので、
   * 記録し忘れ・切り忘れに耳で気づける。
   */
  useEffect(() => {
    if (!sound.bgm || !replay.playing) {
      setBgm('off');
      return;
    }
    setBgm(recording ? 'challenge' : 'calm');
  }, [sound.bgm, replay.playing, recording]);

  // ---- 設定の記憶 ------------------------------------------------------
  const { loaded: saved, save: saveSettings } = useSettings();
  const applied = useRef(false);
  const { setSpeed, setSkipGaps } = replay;

  // 保存してあった設定を一度だけ当てる
  useEffect(() => {
    if (!saved || applied.current) return;
    applied.current = true;
    setInd(saved.ind);
    setIntervalSec(saved.interval);
    setLargeSize(saved.largeSize);
    setTapeOpen(saved.tapeOpen);
    setLevel(saved.level);
    setRoundSec(saved.roundSec);
    setMatchBox(saved.matchBox);
    setMatchFold(saved.matchFold);
    setBotBox(saved.botBox);
    setBotOpen(saved.botOpen);
    setBotFold(saved.botFold);
    setChrome({ header: saved.header, footer: saved.footer });
    setTheme(saved.theme);
    setSpeed(saved.speed);
    setSkipGaps(saved.skipGaps);
    for (const k of ['bgm', 'tape', 'fill'] as const) setSoundChannel(k, saved.sound[k]);
    setSound(soundPrefs());
  }, [saved, setSpeed, setSkipGaps]);

  // 変わったら書き戻す。読み込みが済むまでは何もしない
  const { speed, skipGaps } = replay;
  useEffect(() => {
    if (!applied.current) return;
    saveSettings({
      ind,
      interval: intervalSec,
      speed,
      skipGaps,
      sound,
      tapeOpen,
      largeSize,
      level,
      roundSec,
      matchBox,
      matchFold,
      botBox,
      botOpen,
      botFold,
      header: chrome.header,
      footer: chrome.footer,
      theme,
    });
  }, [
    saveSettings,
    ind,
    intervalSec,
    speed,
    skipGaps,
    sound,
    tapeOpen,
    largeSize,
    level,
    roundSec,
    matchBox,
    matchFold,
    botBox,
    botOpen,
    botFold,
    chrome,
    theme,
  ]);

  /**
   * data/challenges を初期状態に戻す。設定もルールも起動時に読むので、
   * 消したあとは画面ごと作り直すのがいちばん確実
   */
  const onReset = useCallback(async () => {
    const ok = await resetChallenges();
    if (ok) window.location.reload();
    return ok;
  }, []);

  /** 値動きの多い 9:00〜10:00 のどこかから再生し直す */
  const onRandom = useCallback(() => {
    if (ticks.length === 0) return;
    const minOf = (t: number) => {
      const d = new Date(t * 1000);
      return d.getUTCHours() * 60 + d.getUTCMinutes();
    };
    let from = -1;
    let to = -1;
    for (let i = 0; i < ticks.length; i++) {
      const m = minOf(ticks[i].t);
      if (m >= 9 * 60 && from < 0) from = i;
      if (m < 10 * 60) to = i;
    }
    if (from < 0 || to <= from) return;
    unlockSound();
    onSeek(from + Math.floor(Math.random() * (to - from)));
    replay.play();
  }, [ticks, onSeek, replay]);

  /** いまの場面からラウンドを始める。開始位置は最初に流れたティック */
  const { start: startMatch, giveUp: giveUpMatch, clearResult } = match;
  const onStartMatch = useCallback(() => {
    unlockSound();
    startMatch(level, roundSec);
    replay.play();
  }, [startMatch, level, roundSec, replay]);

  // 決着が付いたら止める。ラウンドの終わりを見逃さないため
  const matchResult = match.result;
  const pauseRef = useRef(replay.pause);
  pauseRef.current = replay.pause;
  useEffect(() => {
    if (matchResult) pauseRef.current();
  }, [matchResult]);

  /** botの未約定の注文。板にそのまま出す */
  const botOrders = useMemo(
    () =>
      match.bots.flatMap((b) =>
        b.orders.map((o) => ({
          price: o.price,
          side: o.side,
          qty: o.qty,
          color: b.color,
          name: b.name,
        })),
      ),
    [match.bots],
  );

  const onAnalyze = useCallback(() => {
    const log = snapshotLog();
    if (log) setAnalysisLog(log);
  }, [snapshotLog]);

  const patchInd = useCallback(
    (patch: Partial<IndicatorUi>) => setInd((prev) => ({ ...prev, ...patch })),
    [],
  );

  const indicators = useMemo(
    () => ({
      maPeriods: ind.maOn ? ind.maPeriods : [],
      bb: { on: ind.bbOn, period: ind.bbPeriod, sigma: ind.bbSigma },
      rsi: { on: ind.rsiOn, period: ind.rsiPeriod },
    }),
    [ind],
  );


  const load = useCallback(async (buf: ArrayBuffer, name: string) => {
    setLoading(true);
    setError(null);
    try {
      const parsed = parseCsv(decodeCsv(buf), name);
      if (parsed.ticks.length === 0) throw new Error('約定行を読み取れませんでした');
      setData(parsed);
      setCurrent(name);
      return parsed;
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /** public/data の一覧を取り直す。開発サーバー以外ではAPIが無いので黙って諦める */
  const refreshFiles = useCallback(async () => {
    try {
      const res = await fetch('/api/data');
      if (!res.ok) return;
      const json = (await res.json()) as { files?: string[] };
      if (Array.isArray(json.files)) setFiles(json.files);
    } catch {
      // vite dev 以外では一覧を出せない
    }
  }, []);

  // 起動時に既定のCSVを読む
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const buf = await fetchCsv(DEFAULT_FILE);
        if (!alive) return;
        await load(buf, DEFAULT_FILE);
      } catch (e) {
        if (!alive) return;
        setLoading(false);
        setError(
          `${DEFAULT_FILE} を読み込めませんでした (${e instanceof Error ? e.message : e})。ファイルを選択してください。`,
        );
      }
      if (alive) await refreshFiles();
    })();
    return () => {
      alive = false;
    };
  }, [load, refreshFiles]);

  /** public/data 内のCSVに切り替える */
  const onSelectFile = useCallback(
    async (name: string) => {
      if (!name || name === current) return;
      try {
        await load(await fetchCsv(name), name);
      } catch (e) {
        setError(`${name} を読み込めませんでした (${e instanceof Error ? e.message : e})`);
      }
    },
    [current, load],
  );

  /** 端末から開いたCSVは public/data に控えて、次から一覧で選べるようにする */
  const onPickFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const buf = await file.arrayBuffer();
      if (!(await load(buf, file.name))) return;
      try {
        const res = await fetch(`/api/data/${encodeURIComponent(file.name)}`, {
          method: 'PUT',
          body: buf,
        });
        if (!res.ok) return;
        const json = (await res.json()) as { name?: string };
        if (json.name) setCurrent(json.name);
        await refreshFiles();
      } catch {
        // 控えられなくても再生自体は続けられる
      }
    },
    [load, refreshFiles],
  );

  // Space で再生 / 一時停止
  const { toggle } = replay;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const { stats } = replay;
  const change = stats.last && stats.open ? stats.last - stats.open : 0;
  const changePct = stats.open ? (change / stats.open) * 100 : 0;
  const vwap = stats.volume ? stats.turnover / stats.volume : 0;
  const tone = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const disabled = ticks.length === 0;
  const myPnl = computePnl(
    { long: trading.long, short: trading.short, realized: trading.realized },
    stats.last,
  );
  const myRow = {
    total: myPnl.total,
    trades: trading.trades.length,
    wins: trading.trades.filter((t) => t.pnl > 0).length,
    hold:
      trading.long.qty && trading.short.qty
        ? '両建'
        : trading.long.qty
          ? `買 ${nf.format(trading.long.qty)}`
          : trading.short.qty
            ? `売 ${nf.format(trading.short.qty)}`
            : '—',
  };
  const fileOptions = files.includes(current) ? files : [current, ...files];

  const toggleChrome = (k: 'header' | 'footer') => setChrome((c) => ({ ...c, [k]: !c[k] }));

  /** 何もないところを押したら畳む。ボタンや入力の上では効かせない */
  const blankClose = (k: 'header' | 'footer') => (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, label, a, .set-menu')) return;
    toggleChrome(k);
  };

  return (
    <div className="app">
      {chrome.header ? (
        <header
          className="topbar"
          onClick={blankClose('header')}
          title="何もないところをクリックすると閉じます"
        >
        <div className="brand">
          <strong>Hyper Scape</strong>
          <span className="sub">
            {data ? `${data.symbol ?? '—'} · ${data.dateLabel}` : 'CSV未読込'}
            <span className="file-name" title="再生中のCSV">
              {current}
            </span>
          </span>
        </div>

        <div className="stats">
          <Stat label="現在値" value={stats.last ? nf.format(stats.last) : '—'} tone={tone} big />
          <Stat
            label="始値比"
            value={
              stats.last
                ? `${change > 0 ? '+' : ''}${nf.format(change)} (${change > 0 ? '+' : ''}${changePct.toFixed(2)}%)`
                : '—'
            }
            tone={tone}
          />
          <Stat label="高値" value={stats.high ? nf.format(stats.high) : '—'} />
          <Stat label="安値" value={stats.low ? nf.format(stats.low) : '—'} />
          <Stat label="出来高" value={stats.volume ? nf.format(stats.volume) : '—'} />
          <Stat label="VWAP" value={vwap ? vwap.toFixed(2) : '—'} />
        </div>

          <button
            type="button"
            className="chrome-x"
            onClick={() => toggleChrome('header')}
            title="ヘッダーを閉じる（チャートが広がります）"
          >
            ▲
          </button>
        </header>
      ) : (
        <button
          type="button"
          className="chrome-bar"
          onClick={() => toggleChrome('header')}
          title="ヘッダーを開く"
        >
          ▼ {data ? `${data.symbol ?? current}${stats.last ? ` · ${nf.format(stats.last)}` : ''}` : 'ヘッダー'}
        </button>
      )}
      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onPickFile} hidden />

      {error && <div className="banner error">{error}</div>}
      {loading && <div className="banner">読み込み中…</div>}

      <main className={`main${tapeOpen ? '' : ' tape-closed'}`}>
        <section className="chart-wrap">
          <IndicatorBar value={ind} onChange={patchInd} interval={intervalSec} disabled={disabled} />
          <Chart
            ref={sinkRef}
            indicators={indicators}
            ghost={views.ghost ? ghost : EMPTY_GHOST}
            interval={intervalSec}
            theme={theme}
          />
        </section>

        <TradePanel
          trading={trading}
          last={replay.stats.last}
          tickSize={tickSize}
          clock={replay.clock}
          symbol={data?.symbol ?? null}
          dateLabel={data?.dateLabel ?? ''}
          disabled={disabled}
          challenge={trading.challenge}
          onToggleChallenge={onToggleChallenge}
          onAnalyze={onAnalyze}
          onOverall={() => setShowOverall(true)}
          toggles={views}
          onToggleView={(k) => {
            // 畳んだまま閉じていても、出し直したら中身が見えるようにする
            if (k === 'match') setMatchFold(false);
            setViews((v) => ({ ...v, [k]: !v[k] }));
          }}
          ghostCount={ghost.length}
          botOrders={botOrders}
          matchOn={match.active}
        />

        {tapeOpen ? (
          <aside className="side">
            <div className="side-head">
              <button
                type="button"
                className="side-toggle"
                onClick={() => setTapeOpen(false)}
                title="歩み値を閉じる（板が広がります）"
              >
                歩み値 <span className="chev">✕</span>
              </button>
              <label className="check small" title="この株数以上を大口として強調">
                <span>大口≧</span>
                <select value={largeSize} onChange={(e) => setLargeSize(Number(e.target.value))}>
                  {LARGE_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {nf.format(s)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Tape tape={replay.tape} largeSize={largeSize} />
          </aside>
        ) : (
          <button
            type="button"
            className="side-rail"
            onClick={() => setTapeOpen(true)}
            title="歩み値を開く"
          >
            歩み値
          </button>
        )}
      </main>

      {chrome.footer ? (
        <Controls
          playing={replay.playing}
          speed={replay.speed}
          onSpeed={replay.setSpeed}
          interval={intervalSec}
          onInterval={setIntervalSec}
          skipGaps={replay.skipGaps}
          onSkipGaps={replay.setSkipGaps}
          cursor={replay.cursor}
          total={replay.total}
          clock={replay.clock || (ticks[0]?.rt ?? 0)}
          onToggle={replay.toggle}
          onSeek={onSeek}
          onStep={replay.stepTick}
          onRandom={onRandom}
          sound={sound}
          onSound={onSound}
          theme={theme}
          onTheme={setTheme}
          onHelp={() => setShowHelp(true)}
          onReset={onReset}
          files={fileOptions}
          current={current}
          onSelectFile={onSelectFile}
          onOpenFile={() => fileRef.current?.click()}
          onCollapse={() => toggleChrome('footer')}
          onBlankClick={blankClose('footer')}
          disabled={disabled}
        />
      ) : (
        <button
          type="button"
          className="chrome-bar"
          onClick={() => toggleChrome('footer')}
          title="フッターを開く"
        >
          ▲ {formatClock(replay.clock || (ticks[0]?.rt ?? 0))} · {current} · ×{replay.speed}
        </button>
      )}

      {views.match && (
        <MatchCard
          match={match}
          player={myRow}
          last={stats.last}
          level={level}
          onLevel={setLevel}
          duration={roundSec}
          onDuration={setRoundSec}
          onStart={onStartMatch}
          historySec={Math.max(0, replay.clock - (ticks[0]?.t ?? 0))}
          onGiveUp={() => giveUpMatch(stats.last)}
          onClose={() => setViews((v) => ({ ...v, match: false }))}
          box={matchBox}
          onBox={setMatchBox}
          collapsed={matchFold}
          onCollapse={setMatchFold}
          botOpen={botOpen}
          onBots={() => {
            setBotOpen(true);
            setBotFold(false);
          }}
          disabled={disabled}
        />
      )}

      {views.match && botOpen && (
        <BotBoard
          bots={match.bots}
          ticks={ticks}
          startN={match.startN}
          nowN={match.nowN}
          interval={intervalSec}
          duration={match.duration}
          last={stats.last}
          box={botBox}
          onBox={setBotBox}
          collapsed={botFold}
          onCollapse={setBotFold}
          onClose={() => setBotOpen(false)}
        />
      )}

      {matchResult && (
        <MatchResult rows={matchResult.rows} last={matchResult.last} onClose={clearResult} />
      )}

      {views.rules && (
        <RulePanel
          rules={trading.rules}
          onChange={trading.changeRule}
          violations={trading.violations}
          onClear={trading.clearViolation}
          onClose={() => setViews((v) => ({ ...v, rules: false }))}
        />
      )}

      {views.daily && (
        <DailyCard
          trades={trading.challengeTrades.length ? trading.challengeTrades : trading.trades}
          onClose={() => setViews((v) => ({ ...v, daily: false }))}
        />
      )}

      {analysisLog && (
        <Analysis
          log={analysisLog}
          ticks={challengeTicksRef.current.length ? challengeTicksRef.current : ticks}
          tickSize={challengeTickSizeRef.current}
          onClose={() => setAnalysisLog(null)}
        />
      )}

      {showOverall && <Overall onClose={() => setShowOverall(false)} />}

      {showHelp && <Help onClose={() => setShowHelp(false)} />}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: string;
  tone?: string;
  big?: boolean;
}) {
  return (
    <div className={`stat${big ? ' big' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${tone ?? ''}`}>{value}</span>
    </div>
  );
}

