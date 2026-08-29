import { useCallback, useEffect, useRef } from 'react';
import { BOTS, LEVELS, totalOf, type Level } from '../lib/bot';
import { DURATIONS, type MatchView, type Standing } from '../hooks/useMatch';
import type { Box } from '../lib/settings';

const nf = new Intl.NumberFormat('ja-JP');
const money = (n: number) => `${n > 0 ? '+' : ''}${nf.format(Math.round(n))}`;
const tone = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

/** 秒を mm:ss にする。ラウンドは相場の時間で数える */
function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

type Row = { name: string; color: string; total: number; trades: number; wins: number; hold: string };

type Props = {
  match: MatchView;
  /** プレイヤーの現在の成績 */
  player: { total: number; trades: number; wins: number; hold: string };
  last: number;
  level: Level;
  onLevel: (v: Level) => void;
  duration: number;
  onDuration: (v: number) => void;
  onStart: () => void;
  /** ここまでに再生した相場の時間(秒)。botの助走に使える長さ */
  historySec: number;
  onGiveUp: () => void;
  onClose: () => void;
  /** 位置と大きさ。動かすたびに親へ返して保存してもらう */
  box: Box;
  onBox: (b: Box) => void;
  /** botの売買パネルが開いているか */
  botOpen: boolean;
  onBots: () => void;
  disabled: boolean;
};

export function MatchCard({
  match,
  player,
  last,
  level,
  onLevel,
  duration,
  onDuration,
  onStart,
  historySec,
  onGiveUp,
  onClose,
  box,
  onBox,
  botOpen,
  onBots,
  disabled,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  // ドラッグ中は毎フレーム最新の位置が要るので控えを持つ。
  // 読むのはポインタ操作の中だけなので、同期は副作用で足りる
  const boxRef = useRef(box);
  useEffect(() => {
    boxRef.current = box;
  }, [box]);

  const onDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    drag.current = { dx: e.clientX - boxRef.current.x, dy: e.clientY - boxRef.current.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      onBox({
        ...boxRef.current,
        x: Math.max(0, Math.min(window.innerWidth - 120, e.clientX - d.dx)),
        y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - d.dy)),
      });
    };
    const up = () => {
      drag.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [onBox]);

  // 置き場所を決める。初回は左下、画面の外に出ていたら引き戻す
  useEffect(() => {
    const b = boxRef.current;
    const h = el.current?.offsetHeight ?? 320;
    const y = b.y > 0 ? b.y : window.innerHeight - 92 - h;
    const fixed = {
      ...b,
      x: Math.max(0, Math.min(window.innerWidth - 120, b.x)),
      y: Math.max(8, Math.min(window.innerHeight - 40, y)),
    };
    if (fixed.x !== b.x || fixed.y !== b.y) onBox(fixed);
  }, [onBox]);

  /**
   * 大きさは CSS の resize でブラウザが直接インラインに書くので、
   * 保存してある値を当てるのは表示の切り替わり時だけにして、あとは触らない。
   * 高さは対戦中だけ覚える（設定画面は中身の量が違うため）。
   */
  const live = match.active;
  useEffect(() => {
    const e = el.current;
    if (!e) return;
    e.style.width = boxRef.current.w ? `${boxRef.current.w}px` : '';
    e.style.height = live && boxRef.current.h ? `${boxRef.current.h}px` : '';
  }, [live]);

  useEffect(() => {
    const e = el.current;
    if (!e) return;
    const ro = new ResizeObserver(() => {
      const w = Math.round(e.offsetWidth);
      const h = Math.round(e.offsetHeight);
      const b = boxRef.current;
      const nextH = live ? h : b.h;
      if (b.w === w && b.h === nextH) return;
      onBox({ ...b, w, h: nextH });
    });
    ro.observe(e);
    return () => ro.disconnect();
  }, [live, onBox]);

  const style = { left: box.x, top: box.y > 0 ? box.y : undefined };

  if (!match.active) {
    return (
      <div className="match setup" ref={el} style={style}>
        <header onPointerDown={onDown}>
          <strong>対戦</strong>
          <button type="button" className="x" onClick={onClose} title="閉じる">
            ✕
          </button>
        </header>

        <p className="match-lead">
          同じ相場を、同じ約定ルールで3体のbotと競います。botは先読みできず、
          値段も動かせません。<b>違うのは判断だけ</b>です。
        </p>

        <div className="match-bots">
          {BOTS.map((b) => (
            <div key={b.id} className="match-bot">
              <span className="dot" style={{ background: b.color }} />
              <div>
                <strong>{b.name}</strong>
                <span>{b.tagline}</span>
                <span className="match-weak">
                  強い: {b.strong} / 弱い: {b.weak}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="match-opt">
          <span>難易度</span>
          <div className="seg">
            {LEVELS.map((l) => (
              <button
                type="button"
                key={l.id}
                className={`seg-btn${l.id === level ? ' on' : ''}`}
                onClick={() => onLevel(l.id)}
                title={l.note}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <div className="match-opt">
          <span>時間</span>
          <div className="seg">
            {DURATIONS.map((d) => (
              <button
                type="button"
                key={d.sec}
                className={`seg-btn${d.sec === duration ? ' on' : ''}`}
                onClick={() => onDuration(d.sec)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <p className="match-note">
          難易度は先読みではなく<b>反応の遅れ</b>で変わります。
          {LEVELS.find((l) => l.id === level)?.note}。
        </p>

        {historySec < 1200 && (
          <p className="match-warn">
            まだ {Math.floor(historySec / 60)}分ぶんしか再生していません。botは直前の足から
            バンドや値動きの大きさを作るので、<b>20分ほど進めてから</b>（9時20分）始めるか
            🎲 を押すと、3体ともきちんと動きます。
          </p>
        )}

        <button type="button" className="btn play match-go" onClick={onStart} disabled={disabled}>
          この場面から開始
        </button>
      </div>
    );
  }

  const rows: Row[] = [
    { name: 'あなた', color: '#f0b429', ...player },
    ...match.bots.map((b) => ({
      name: b.name,
      color: b.color,
      total: totalOf(b, last),
      trades: b.trades.length,
      wins: b.wins,
      hold: b.side === 'long' ? `買 ${nf.format(b.qty)}` : b.side === 'short' ? `売 ${nf.format(b.qty)}` : '—',
    })),
  ].sort((a, b) => b.total - a.total);

  return (
    <div className="match live" ref={el} style={style}>
      <header onPointerDown={onDown}>
        <strong>対戦</strong>
        <span className="match-clock">残り {mmss(match.remain)}</span>
        <button type="button" className="x" onClick={onClose} title="閉じる（対戦は続きます）">
          ✕
        </button>
      </header>
      <div className="match-rows">
        {rows.map((r, i) => (
          <div key={r.name} className={`match-row${r.name === 'あなた' ? ' me' : ''}`}>
            <span className="rank">{i + 1}</span>
            <span className="dot" style={{ background: r.color }} />
            <span className="who">{r.name}</span>
            <span className="hold">{r.hold}</span>
            <span className={`total ${tone(r.total)}`}>{money(r.total)}</span>
          </div>
        ))}
      </div>
      <div className="match-foot">
        <button type="button" className="mini" onClick={onGiveUp}>
          ここで終える
        </button>
        {!botOpen && (
          <button type="button" className="mini" onClick={onBots} title="botの売買を開く">
            botの売買
          </button>
        )}
      </div>
    </div>
  );
}

/** 決着の画面 */
export function MatchResult({
  rows,
  last,
  onClose,
}: {
  rows: Standing[];
  last: number;
  onClose: () => void;
}) {
  const me = rows.findIndex((r) => r.isPlayer);
  const top = rows[0];
  const gap = rows[me].total - top.total;

  return (
    <div className="an-back" onClick={onClose}>
      <div className="match-res" onClick={(e) => e.stopPropagation()}>
        <header className="an-head">
          <div>
            <strong>{me === 0 ? '勝ち' : `${me + 1}位`}</strong>
            <span className="an-sub">
              {last ? `${nf.format(last)}円で全員を評価` : ''}
              {me === 0 ? ' — botに勝ちました' : ` — 1位の${top.name}に ${nf.format(Math.round(-gap))}円 届かず`}
            </span>
          </div>
          <button type="button" className="mini" onClick={onClose}>
            閉じる
          </button>
        </header>

        <div className="res-rows">
          {rows.map((r, i) => (
            <div key={r.name} className={`res-row${r.isPlayer ? ' me' : ''}`}>
              <span className="rank">{i + 1}</span>
              <span className="dot" style={{ background: r.color }} />
              <span className="who">{r.name}</span>
              <span className="sub">
                {r.trades ? `${r.trades}回 / ${r.wins}勝 (${Math.round((r.wins / r.trades) * 100)}%)` : '取引なし'}
              </span>
              <span className={`total ${tone(r.total)}`}>{money(r.total)}</span>
            </div>
          ))}
        </div>

        <p className="res-note">
          {verdict(rows, me)}
        </p>
      </div>
    </div>
  );
}

/** どのbotに負けたかで、その日がどんな相場だったかを言い当てる */
function verdict(rows: Standing[], me: number): string {
  const winner = rows[0];
  if (me === 0) {
    const best = rows.slice(1).find((r) => !r.isPlayer);
    return best && best.total > 0
      ? `${best.name}も勝っています。同じ流れを読めていたということです。`
      : 'botが全滅した場面で勝ち切りました。';
  }
  const by: Record<string, string> = {
    逆張り: 'レンジでした。行き過ぎた値段は戻る場面だったので、追いかけずに逆を取るのが正解です。',
    ブレイク: 'トレンドでした。抜けたところに素直に付いていく場面で、戻りを待つと置いていかれます。',
    スキャル: '歩み値の偏りが素直に出る場面でした。細かく取って細かく逃げるのが効く相場です。',
  };
  return `${winner.name}に負けました。${by[winner.name] ?? ''}`;
}
