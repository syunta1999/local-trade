import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Analysis as Result, ChallengeLog, SideStats } from '../lib/analysis';
import { analyze, analyzeFrom } from '../lib/analysis';
import { formatClock } from '../lib/csv';
import {
  deleteChallenge,
  downloadChallenge,
  loadChallenges,
  type StoredChallenges,
} from '../lib/csvfile';
import type { Tick } from '../lib/types';

/** 母数がこれ未満だと数字が偶然に振り回される */
const MIN_SAMPLE = 20;

const nf = new Intl.NumberFormat('ja-JP');
const money = (n: number) => `${n > 0 ? '+' : ''}${nf.format(Math.round(n))}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const pt = (n: number) => `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)}pt`;
const tone = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');
const num = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');

function dur(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const s = Math.round(sec);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分${s % 60}秒`;
  return `${Math.floor(m / 60)}時間${m % 60}分`;
}

type ViewProps = {
  result: Result;
  subtitle: string;
  /** 数字を鵜呑みにできない事情。空なら出さない */
  warn?: string;
  onSave?: () => void;
  onClose: () => void;
  /** 総合表示のときだけ足すチャレンジ一覧など */
  children?: React.ReactNode;
};

/** 集計結果の見せ方。1回ぶんでも総合でも同じ画面を使う */
function AnalysisView({ result: a, subtitle, warn, onSave, onClose, children }: ViewProps) {
  const totalMfe = a.exec.items.reduce((x, i) => x + i.mfeMoney, 0);

  return (
    <div className="an-back" onClick={onClose}>
      <div className="an" onClick={(e) => e.stopPropagation()}>
        <header className="an-head">
          <div>
            <strong>{onSave ? '分析結果' : '総合分析'}</strong>
            <span className="an-sub">{subtitle}</span>
          </div>
          <div className="an-acts">
            {onSave && (
              <button type="button" className="mini" onClick={onSave}>
                CSV保存
              </button>
            )}
            <button type="button" className="mini" onClick={onClose}>
              閉じる
            </button>
          </div>
        </header>

        <div className="an-body">
          {a.all.count === 0 ? (
            <>
              <p className="an-empty">まだ取引がありません。板で発注して返済すると記録されます。</p>
              {children}
            </>
          ) : (
            <>
              <section className={`verdict ${a.all.edge > 0 ? 'good' : 'bad'}`}>
                <div className="verdict-main">
                  {a.all.edge > 0 ? '優位性あり' : '優位性なし'}
                  <span className="verdict-note">
                    勝率 {pct(a.all.winRate)} に対し、このリスクリワード（{num(a.all.riskReward)}
                    ）でトントンになる勝率は {pct(a.all.breakEvenWinRate)}。差は {pt(a.all.edge)}
                  </span>
                </div>
                <div className={`verdict-pnl ${tone(a.all.pnl)}`}>{money(a.all.pnl)}</div>
              </section>

              {warn && <p className="an-warn">{warn}</p>}

              <Section title="資金曲線">
                <Equity values={a.risk.equity} />
              </Section>

              <Section title="A 基本成績">
                <table className="an-table">
                  <thead>
                    <tr>
                      <th></th><th>全体</th><th>買（ロング）</th><th>売（ショート）</th>
                    </tr>
                  </thead>
                  <tbody>
                    <Row label="取引数" pick={(s) => nf.format(s.count)} a={a} />
                    <Row label="勝 / 負 / 分" pick={(s) => `${s.wins} / ${s.losses} / ${s.evens}`} a={a} />
                    <Row label="勝率" pick={(s) => (s.wins + s.losses ? pct(s.winRate) : '—')} a={a} strong />
                    <Row label="損益" pick={(s) => money(s.pnl)} a={a} colour strong />
                    <Row label="平均損益" pick={(s) => (s.count ? money(s.avgPnl) : '—')} a={a} colour />
                    <Row label="総利益" pick={(s) => nf.format(Math.round(s.grossProfit))} a={a} />
                    <Row label="総損失" pick={(s) => nf.format(Math.round(s.grossLoss))} a={a} />
                    <Row label="最大利益" pick={(s) => (s.maxWin ? money(s.maxWin) : '—')} a={a} />
                    <Row label="最大損失" pick={(s) => (s.maxLoss ? money(s.maxLoss) : '—')} a={a} />
                  </tbody>
                </table>
                <p className="an-note">
                  平均ロット {nf.format(Math.round(a.totalQty / Math.max(1, a.all.count)))}株 ／
                  総売買代金 {nf.format(Math.round(a.turnover))}円
                </p>
              </Section>

              <Section title="B 期待値・優位性">
                <div className="cards">
                  <Card label="プロフィットファクター" value={num(a.all.profitFactor)} tone={a.all.profitFactor >= 1 ? 'up' : 'down'} note="総利益÷総損失。1未満なら負け" />
                  <Card label="リスクリワード比" value={num(a.all.riskReward)} note="平均利益÷平均損失" />
                  <Card label="1取引あたり期待値" value={money(a.all.expectancy)} tone={tone(a.all.expectancy)} note="これがプラスなら回すほど増える" />
                  <Card label="損益分岐勝率" value={a.all.breakEvenWinRate ? pct(a.all.breakEvenWinRate) : '—'} note="このRRでトントンになる勝率" />
                  <Card label="優位性" value={a.all.breakEvenWinRate ? pt(a.all.edge) : '—'} tone={tone(a.all.edge)} note="実勝率 − 損益分岐勝率" />
                  <Card label="平均利益 / 平均損失" value={`${nf.format(Math.round(a.all.avgWin))} / ${nf.format(Math.round(a.all.avgLoss))}`} note="" />
                </div>
                <Hist bins={a.hist} />
              </Section>

              <Section title="C リスク">
                <div className="cards">
                  <Card label="最大ドローダウン" value={money(-a.risk.maxDrawdown)} tone={a.risk.maxDrawdown ? 'down' : 'flat'} note={a.risk.maxDrawdownPct ? `ピークから ${pct(a.risk.maxDrawdownPct)}` : ''} />
                  <Card label="最大連勝" value={`${a.risk.maxWinStreak}`} note="" />
                  <Card label="最大連敗" value={`${a.risk.maxLoseStreak}`} note="ここでメンタルが折れる" />
                  <Card label="損益の標準偏差" value={nf.format(Math.round(a.risk.stdev))} note="ばらつきの大きさ" />
                  <Card label="リスク調整後" value={num(a.risk.sharpe)} tone={tone(a.risk.sharpe)} note="平均損益÷標準偏差" />
                  <Card label="リカバリーファクター" value={num(a.risk.recoveryFactor)} note="総損益÷最大DD" />
                </div>
              </Section>

              <Section title="D 時間">
                <div className="cards">
                  <Card label="平均保有時間" value={dur(a.time.avgHold)} note="" />
                  <Card label="勝ちの保有" value={dur(a.time.avgHoldWin)} tone="up" note="" />
                  <Card label="負けの保有" value={dur(a.time.avgHoldLose)} tone="down" note={a.time.avgHoldLose > a.time.avgHoldWin ? '負けを長く持っている（損大利小）' : '負けを早く切れている'} />
                  <Card label="取引の間隔" value={dur(a.time.avgInterval)} note="短すぎるとオーバートレード" />
                  <Card label="発注→約定" value={dur(a.time.avgWait)} note="指値が刺さるまで" />
                  <Card label="取消した注文" value={`${a.time.cancelled}件 (${pct(a.time.cancelRate)})`} note="迷いの多さ" />
                </div>
                <table className="an-table">
                  <thead><tr><th>時間帯</th><th>取引</th><th>勝率</th><th>損益</th></tr></thead>
                  <tbody>
                    {a.time.buckets.map((b) => (
                      <tr key={b.label} className={b.count ? '' : 'dim'}>
                        <td>{b.label}</td>
                        <td>{b.count || '—'}</td>
                        <td>{b.count ? pct(b.winRate) : '—'}</td>
                        <td className={tone(b.pnl)}>{b.count ? money(b.pnl) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              <Section title="E 執行の質">
                <div className="cards">
                  <Card label="平均の最大順行 (MFE)" value={`${num(a.exec.avgMfe, 1)}円`} note="含み益がどこまで乗ったか" />
                  <Card label="平均の最大逆行 (MAE)" value={`${num(a.exec.avgMae, 1)}円`} note="含み損をどこまで抱えたか" />
                  <Card label="利益の収穫率" value={totalMfe > 0 ? pct(a.exec.captureRate) : '—'} tone={a.exec.captureRate > 0.5 ? 'up' : 'down'} note={totalMfe > 0 ? `取れたはず ${nf.format(Math.round(totalMfe))}円 → 実際 ${money(a.all.pnl)}円` : ''} />
                  <Card
                    label="負けの逆行 → 損切り"
                    value={`${num(a.exec.loseMae, 1)} → ${num(a.exec.loseLoss, 1)}円`}
                    note={
                      a.exec.loseMae > a.exec.loseLoss + 0.001
                        ? `${num(a.exec.loseMae - a.exec.loseLoss, 1)}円戻したところで切れている`
                        : '一番悪いところで切っている'
                    }
                  />
                  <Card label="勝ちでも耐えた逆行" value={`${num(a.exec.winMae, 1)}円`} note="勝ちトレードで抱えた含み損" />
                  <Card label="含み益があったのに負け" value={`${a.exec.gaveBack}件`} tone={a.exec.gaveBack ? 'down' : 'flat'} note="一番もったいないパターン" />
                  <Card label="逆行に耐えて勝ち" value={`${a.exec.endured}件`} note="偶然かもしれない" />
                </div>

                <div className="sweeps">
                  <Sweep title="この幅で利確していたら" rows={a.exec.tpSweep} sign="+" actual={a.all.pnl} />
                  <Sweep title="この幅で損切りしていたら" rows={a.exec.slSweep} sign="−" actual={a.all.pnl} />
                </div>
                <p className="an-note">
                  ※ 幅に到達した時点で必ず約定した前提の概算。利確と損切りのどちらが先に触れたかまでは見ていない。
                </p>
              </Section>

              {children}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type Props = {
  log: ChallengeLog;
  ticks: Tick[];
  tickSize: number;
  onClose: () => void;
};

/** 再生中のチャレンジ1回ぶん */
export function Analysis({ log, ticks, tickSize, onClose }: Props) {
  const a = useMemo(() => analyze(log, ticks, tickSize), [log, ticks, tickSize]);
  const thin = a.all.count > 0 && a.all.count < MIN_SAMPLE;
  const warn = [
    thin ? `取引が${a.all.count}件しかありません。${MIN_SAMPLE}件を超えるまで数字は偶然に振り回されます。` : '',
    log.seeks > 0 ? `巻き戻しが${log.seeks}回あります。やり直したぶん成績は甘く出ています。` : '',
  ].join('');

  return (
    <AnalysisView
      result={a}
      subtitle={`${log.symbol ?? '—'} · ${log.dateLabel} · ${formatClock(log.fromClock)}〜${formatClock(log.toClock)} · ${log.fileName}`}
      warn={warn}
      onSave={() => downloadChallenge(log, a)}
      onClose={onClose}
    />
  );
}

/** これまでのチャレンジを全部まとめたもの。一覧から削除もできる */
export function Overall({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<StoredChallenges | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const next = await loadChallenges();
    setData(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await loadChallenges();
      if (!alive) return;
      setData(next);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const a = useMemo(
    () => analyzeFrom(data?.items ?? [], data?.cancelled ?? 0, 1),
    [data],
  );

  if (loading) {
    return (
      <div className="an-back" onClick={onClose}>
        <div className="an" onClick={(e) => e.stopPropagation()}>
          <div className="an-body">
            <p className="an-empty">読み込み中…</p>
          </div>
        </div>
      </div>
    );
  }

  const list = data?.summaries ?? [];
  const symbols = [...new Set(list.map((c) => c.symbol).filter(Boolean))];
  const seeks = list.reduce((x, c) => x + c.seeks, 0);
  const thin = a.all.count > 0 && a.all.count < MIN_SAMPLE;

  const remove = async () => {
    if (!picked) return;
    await deleteChallenge(picked);
    setPicked(null);
    setConfirming(false);
    await load();
  };

  const warn = [
    !data ? '記録を読み込めませんでした（開発サーバーで動かしてください）。' : '',
    thin ? `取引が${a.all.count}件しかありません。${MIN_SAMPLE}件を超えるまで数字は偶然に振り回されます。` : '',
    seeks > 0 ? `巻き戻しが通算${seeks}回あります。やり直したぶん成績は甘く出ています。` : '',
    symbols.length > 1
      ? `${symbols.length}銘柄（${symbols.join('・')}）が混ざっています。損益は合算できますが、MFE/MAEなど「円/株」の数字は値段の水準が違うものを平均しています。`
      : '',
  ].join('');

  return (
    <AnalysisView
      result={a}
      subtitle={`${list.length}回のチャレンジ · ${a.all.count}取引${symbols.length ? ` · ${symbols.join('・')}` : ''}`}
      warn={warn}
      onClose={onClose}
    >
      <Section title="チャレンジ一覧">
        {list.length === 0 ? (
          <p className="an-note">まだ記録がありません。</p>
        ) : (
          <>
            <table className="an-table pick">
              <thead>
                <tr><th>日時</th><th>銘柄</th><th>日付</th><th>取引</th><th>損益</th><th>シーク</th></tr>
              </thead>
              <tbody>
                {[...list].reverse().map((c) => (
                  <tr
                    key={c.id}
                    className={picked === c.id ? 'on' : ''}
                    onClick={() => {
                      setPicked(picked === c.id ? null : c.id);
                      setConfirming(false);
                    }}
                  >
                    <td>{c.startedAt}</td>
                    <td>{c.symbol || '—'}</td>
                    <td>{c.dateLabel}</td>
                    <td>{c.trades}</td>
                    <td className={tone(c.pnl)}>{money(c.pnl)}</td>
                    <td>{c.seeks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="an-del">
              {picked ? (
                confirming ? (
                  <>
                    <span>このチャレンジの記録をすべて消します。戻せません。</span>
                    <button type="button" className="mini danger" onClick={remove}>
                      本当に削除する
                    </button>
                    <button type="button" className="mini" onClick={() => setConfirming(false)}>
                      やめる
                    </button>
                  </>
                ) : (
                  <>
                    <span>{list.find((c) => c.id === picked)?.startedAt} を選択中</span>
                    <button type="button" className="mini danger" onClick={() => setConfirming(true)}>
                      削除
                    </button>
                  </>
                )
              ) : (
                <span>行をクリックすると削除できます</span>
              )}
            </div>
          </>
        )}
        <p className="an-note">記録は public/data/challenges/ に溜まります。</p>
      </Section>
    </AnalysisView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="an-sec">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Row({
  label,
  pick,
  a,
  colour,
  strong,
}: {
  label: string;
  pick: (s: SideStats) => string;
  a: Result;
  colour?: boolean;
  strong?: boolean;
}) {
  const cell = (s: SideStats) => (
    <td className={`${colour ? tone(s.pnl) : ''}${strong ? ' strong' : ''}`}>{pick(s)}</td>
  );
  return (
    <tr>
      <th>{label}</th>
      {cell(a.all)}
      {cell(a.long)}
      {cell(a.short)}
    </tr>
  );
}

function Card({ label, value, note, tone: t }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div className="card">
      <span className="card-l">{label}</span>
      <span className={`card-v ${t ?? ''}`}>{value}</span>
      {note && <span className="card-n">{note}</span>}
    </div>
  );
}

/** 累積損益の折れ線 */
function Equity({ values }: { values: number[] }) {
  if (values.length < 2) return <p className="an-note">取引が2件以上になると曲線が出ます。</p>;
  const W = 640;
  const H = 130;
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / span) * H;
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  return (
    <svg className="eq" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="累積損益">
      <line x1="0" y1={y(0)} x2={W} y2={y(0)} stroke="#3a4250" strokeWidth="1" strokeDasharray="3 3" />
      <path d={d} fill="none" stroke={last >= 0 ? '#ef5350' : '#42a5f5'} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Hist({ bins }: { bins: { from: number; to: number; count: number }[] }) {
  if (bins.length < 2) return null;
  const max = Math.max(...bins.map((b) => b.count));
  return (
    <div className="hist">
      {bins.map((b) => (
        <div key={b.from} className="hist-col" title={`${money(b.from)} 〜 ${money(b.to)}: ${b.count}件`}>
          <div
            className={`hist-bar ${b.to <= 0 ? 'down' : b.from >= 0 ? 'up' : 'flat'}`}
            style={{ height: `${(b.count / max) * 100}%` }}
          />
          <span>{Math.round(b.from / 1000)}k</span>
        </div>
      ))}
    </div>
  );
}

function Sweep({
  title,
  rows,
  sign,
  actual,
}: {
  title: string;
  rows: { level: number; pnl: number; delta: number }[];
  sign: string;
  actual: number;
}) {
  if (rows.length === 0) return null;
  const best = rows.reduce((m, r) => (r.pnl > m.pnl ? r : m), rows[0]);
  return (
    <table className="an-table sweep">
      <thead>
        <tr><th>{title}</th><th>総損益</th><th>実際との差</th></tr>
      </thead>
      <tbody>
        <tr className="actual">
          <td>実際</td>
          <td className={tone(actual)}>{money(actual)}</td>
          <td>—</td>
        </tr>
        {rows.map((r) => (
          <tr key={r.level} className={r === best ? 'best' : ''}>
            <td>{sign}{r.level}円</td>
            <td className={tone(r.pnl)}>{money(r.pnl)}</td>
            <td className={tone(r.delta)}>{money(r.delta)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
