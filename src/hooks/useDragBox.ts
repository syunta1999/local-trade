import { useCallback, useEffect, useRef } from 'react';
import type { Box } from '../lib/settings';

/** 動かしたと見なす距離(px)。これ未満なら畳んだ帯のクリック（開く）として扱う */
const SLOP = 4;

/**
 * 掴んで動かせる窓の共通部分。対戦とbotの売買で同じ動きにする。
 *
 * 畳んだときの帯は帯そのものがボタンなので、button を一律に避けると掴めなくなる。
 * .grip だけは例外にして、動いた距離が SLOP 未満のときだけクリックとして扱う。
 */
export function useDragBox(
  box: Box,
  onBox: (b: Box) => void,
  /** 画面の端に必ず残す幅・高さ。窓が完全に外へ出て掴めなくなるのを防ぐ */
  keepX: number,
  keepY: number,
) {
  // ドラッグ中は毎フレーム最新の位置が要るので控えを持つ。
  // 読むのはポインタ操作の中だけなので、同期は副作用で足りる
  const boxRef = useRef(box);
  useEffect(() => {
    boxRef.current = box;
  }, [box]);

  const drag = useRef<{ dx: number; dy: number } | null>(null);
  /** 掴んだあと実際に動いたか。帯のクリックと、動かす操作を見分ける */
  const movedRef = useRef(false);

  const onDown = useCallback((e: React.PointerEvent) => {
    const hit = (e.target as HTMLElement).closest('button, input, select');
    // 閉じる・畳むなどの操作は掴まない。畳んだ帯だけは例外
    if (hit && !hit.closest('.grip')) return;
    movedRef.current = false;
    drag.current = { dx: e.clientX - boxRef.current.x, dy: e.clientY - boxRef.current.y };
    // 捕まえるのは掴んだ要素そのもの。見出し側で捕まえると、
    // 帯を押したときのクリックが帯まで届かず開けなくなる
    ((hit ?? e.currentTarget) as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const b = boxRef.current;
      const x = e.clientX - d.dx;
      const y = e.clientY - d.dy;
      if (!movedRef.current && Math.abs(x - b.x) + Math.abs(y - b.y) < SLOP) return;
      movedRef.current = true;
      onBox({
        ...b,
        x: Math.max(0, Math.min(window.innerWidth - keepX, x)),
        y: Math.max(0, Math.min(window.innerHeight - keepY, y)),
      });
    };
    const up = () => {
      drag.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [onBox, keepX, keepY]);

  return { boxRef, onDown, movedRef };
}
