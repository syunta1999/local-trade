import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chart } from './components/Chart';
import { Controls } from './components/Controls';
import { Tape } from './components/Tape';
import { useReplay, type ReplaySink } from './hooks/useReplay';
import { decodeCsv, parseCsv } from './lib/csv';
import type { ParsedCsv } from './lib/types';

const DEFAULT_CSV = `${import.meta.env.BASE_URL}data/qr-6330-20260828.csv`;
const LARGE_SIZES = [1000, 3000, 5000, 10000];

const nf = new Intl.NumberFormat('ja-JP');

export default function App() {
  const [data, setData] = useState<ParsedCsv | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [intervalSec, setIntervalSec] = useState(60);
  const [largeSize, setLargeSize] = useState(5000);

  const sinkRef = useRef<ReplaySink | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const ticks = useMemo(() => data?.ticks ?? [], [data]);
  const replay = useReplay(ticks, intervalSec, sinkRef);

  const load = useCallback(async (buf: ArrayBuffer, name: string) => {
    setLoading(true);
    setError(null);
    try {
      const parsed = parseCsv(decodeCsv(buf), name);
      if (parsed.ticks.length === 0) throw new Error('約定行を読み取れませんでした');
      setData(parsed);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(DEFAULT_CSV);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const buf = await res.arrayBuffer();
        if (!alive) return;
        await load(buf, DEFAULT_CSV.split('/').pop() ?? 'data.csv');
      } catch (e) {
        if (!alive) return;
        setLoading(false);
        setError(
          `既定のCSVを読み込めませんでした (${e instanceof Error ? e.message : e})。ファイルを選択してください。`,
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const onPickFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await load(await file.arrayBuffer(), file.name);
      e.target.value = '';
    },
    [load],
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>Tick Replay</strong>
          <span className="sub">
            {data ? `${data.symbol ?? '—'} · ${data.dateLabel}` : 'CSV未読込'}
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

        <div className="file">
          <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>
            CSVを開く
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onPickFile}
            hidden
          />
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}
      {loading && <div className="banner">読み込み中…</div>}

      <main className="main">
        <section className="chart-wrap">
          <Chart ref={sinkRef} />
        </section>

        <aside className="side">
          <div className="side-head">
            <span>歩み値</span>
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
      </main>

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
        onSeek={replay.seek}
        onStep={replay.stepTick}
        disabled={disabled}
      />
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

