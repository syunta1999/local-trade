import { useCallback, useEffect, useRef, useState } from 'react';
import {
  minToTime,
  RULE_DEFS,
  timeToMin,
  type RuleId,
  type Rules,
  type RuleState,
} from '../lib/rules';

/**
 * 自分ルールの一覧。トレード画面の上に浮かせて置き、
 * ドラッグで動かし、右下をつまんで大きさを変えられる。
 */

type Props = {
  rules: Rules;
  onChange: (id: RuleId, patch: Partial<RuleState>) => void;
  /** いま破っているルール。赤く点滅させる */
  violations: RuleId[];
  onClear: (id: RuleId) => void;
  onClose: () => void;
};

export function RulePanel({ rules, onChange, violations, onClear, onClose }: Props) {
  const [pos, setPos] = useState({ x: 14, y: 120 });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const onDown = useCallback(
    (e: React.PointerEvent) => {
      // ボタンや入力の上から掴んだときは動かさない
      if ((e.target as HTMLElement).closest('button, input')) return;
      dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [pos],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 120, e.clientX - d.dx)),
        y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - d.dy)),
      });
    };
    const up = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const activeCount = RULE_DEFS.filter((d) => rules[d.id].enabled).length;

  return (
    <div className="rp" style={{ left: pos.x, top: pos.y }}>
      <div className="rp-head" onPointerDown={onDown}>
        <span>
          マイルール <em>{activeCount}</em>
        </span>
        <button type="button" className="rp-x" onClick={onClose} title="閉じる">
          ×
        </button>
      </div>

      <div className="rp-body">
        {RULE_DEFS.map((d) => {
          const st = rules[d.id];
          const bad = violations.includes(d.id);
          return (
            <div
              key={d.id}
              className={`rp-row${st.enabled ? ' on' : ''}${bad ? ' viol' : ''}`}
              onClick={bad ? () => onClear(d.id) : undefined}
              title={bad ? 'クリックで点滅を消す' : d.note}
            >
              <button
                type="button"
                className={`rp-chk${st.enabled ? ' on' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(d.id, { enabled: !st.enabled });
                }}
                aria-label={`${d.label}を${st.enabled ? '無効' : '有効'}にする`}
              >
                {st.enabled ? '✓' : ''}
              </button>
              <span className="rp-label">{d.label}</span>
              {d.kind === 'time' ? (
                <input
                  type="time"
                  className="rp-val"
                  value={minToTime(st.value)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onChange(d.id, { value: timeToMin(e.target.value) })}
                />
              ) : (
                <input
                  type="number"
                  className="rp-val"
                  value={st.value}
                  min={d.min}
                  max={d.max}
                  step={d.step}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) onChange(d.id, { value: v });
                  }}
                />
              )}
              <span className="rp-fmt">{d.fmt(st.value)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
