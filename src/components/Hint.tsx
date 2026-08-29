import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/** カーソルを重ねてから解説が出るまで */
const DELAY = 500;
/** .hint の max-width と揃える。画面からはみ出さないよう中心位置を丸めるのに使う */
const MAX_W = 264;

type Shown = { key: string; x: number; y: number };

export type HintText = { title: string; body: ReactNode };

/**
 * ボタンに解説を付ける。要素は包まず、返ってきた props をそのまま広げて使う。
 * レイアウトに手を入れずに済むので、既存の flex 行がそのまま動く。
 */
export function useHints(texts: Record<string, HintText>) {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef(0);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    setShown(null);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const bind = useCallback(
    (key: string) => ({
      onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
        // タッチでは長押しの邪魔になるので出さない
        if (e.pointerType === 'touch') return;
        const el = e.currentTarget;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          const b = el.getBoundingClientRect();
          const half = MAX_W / 2 + 8;
          setShown({
            key,
            x: Math.min(Math.max(b.left + b.width / 2, half), window.innerWidth - half),
            y: b.bottom + 8,
          });
        }, DELAY);
      },
      // 押したら用は済んでいるので引っ込める
      onPointerLeave: hide,
      onPointerDown: hide,
      onBlur: hide,
    }),
    [hide],
  );

  const text = shown ? texts[shown.key] : null;
  const node =
    shown && text ? (
      <div className="hint" style={{ left: shown.x, top: shown.y }} role="tooltip">
        <strong>{text.title}</strong>
        <p>{text.body}</p>
      </div>
    ) : null;

  return { bind, node };
}
