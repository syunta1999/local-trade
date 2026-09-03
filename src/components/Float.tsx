import { useEffect, useRef, type ReactNode } from 'react';
import { useDragBox } from '../hooks/useDragBox';
import type { Box } from '../lib/settings';

/**
 * 掴んで動かせる小窓の共通部分。指値注文と逆指値設定で同じ動きにする。
 *
 * 対戦・botの売買と同じ作法：見出しを掴んで移動、右下をつまんで大きさ変更、
 * 「—」で見出しの帯だけに畳む（帯は押すと開き、掴めば動く）。
 * 位置と大きさは親に返して settings.csv に覚えてもらう。
 */

/** 画面の端に必ず残す幅・高さ。窓が完全に外へ出て掴めなくなるのを防ぐ */
const KEEP_X = 160;
const KEEP_Y = 30;

type Props = {
  /** 見た目の差し分け用。根の要素に `flt ${kind}` で付く */
  kind: string;
  title: ReactNode;
  /** 畳んだ帯に出す中身。省くと title と同じ */
  grip?: ReactNode;
  /** 見出しの右側に置く補足（件数など） */
  aside?: ReactNode;
  box: Box;
  onBox: (b: Box) => void;
  collapsed: boolean;
  onCollapse: (v: boolean) => void;
  onClose: () => void;
  /** 初回（座標が 0 のとき）の置き場所。窓の幅・高さを渡すので画面の中に収められる */
  place: (w: number, h: number) => { x: number; y: number };
  children: ReactNode;
};

export function Float({
  kind,
  title,
  grip,
  aside,
  box,
  onBox,
  collapsed,
  onCollapse,
  onClose,
  place,
  children,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const { boxRef, onDown, movedRef } = useDragBox(box, onBox, KEEP_X, KEEP_Y);

  // 初回の置き場所と、画面の外に出ていたときの引き戻し
  useEffect(() => {
    const b = boxRef.current;
    const w = b.w || el.current?.offsetWidth || 280;
    const h = b.h || el.current?.offsetHeight || 240;
    const first = place(w, h);
    const x = b.x > 0 ? b.x : first.x;
    const y = b.y > 0 ? b.y : first.y;
    const fixed = {
      ...b,
      x: Math.max(0, Math.min(window.innerWidth - KEEP_X, x)),
      y: Math.max(8, Math.min(window.innerHeight - KEEP_Y, y)),
    };
    if (fixed.x !== b.x || fixed.y !== b.y) onBox(fixed);
  }, [onBox, boxRef, place]);

  // 大きさは CSS の resize がインラインに書くので、当てるのは畳み方が変わったときだけ。
  // 畳んでいる間は中身に合わせたいので、指定そのものを外す
  useEffect(() => {
    const e = el.current;
    if (!e) return;
    if (collapsed) {
      e.style.width = '';
      e.style.height = '';
      return;
    }
    e.style.width = boxRef.current.w ? `${boxRef.current.w}px` : '';
    e.style.height = boxRef.current.h ? `${boxRef.current.h}px` : '';
  }, [collapsed, boxRef]);

  useEffect(() => {
    const e = el.current;
    if (!e || collapsed) return;
    const ro = new ResizeObserver(() => {
      const w = Math.round(e.offsetWidth);
      const h = Math.round(e.offsetHeight);
      const b = boxRef.current;
      if (b.w === w && b.h === h) return;
      onBox({ ...b, w, h });
    });
    ro.observe(e);
    return () => ro.disconnect();
  }, [collapsed, onBox, boxRef]);

  const style = { left: box.x, top: box.y > 0 ? box.y : undefined };

  if (collapsed) {
    return (
      <div className={`flt ${kind} collapsed`} ref={el} style={style}>
        <header onPointerDown={onDown}>
          <button
            type="button"
            className="grip"
            onClick={() => {
              // 動かしただけのときは開かない
              if (!movedRef.current) onCollapse(false);
            }}
            title="押すと開く / 掴んで移動"
          >
            {grip ?? title}
          </button>
        </header>
      </div>
    );
  }

  return (
    <div className={`flt ${kind}`} ref={el} style={style}>
      <header onPointerDown={onDown}>
        <strong>{title}</strong>
        {aside && <span className="flt-aside">{aside}</span>}
        <button type="button" className="x" onClick={() => onCollapse(true)} title="細く畳む">
          —
        </button>
        <button type="button" className="x" onClick={onClose} title="閉じる">
          ✕
        </button>
      </header>
      <div className="flt-body">{children}</div>
    </div>
  );
}
