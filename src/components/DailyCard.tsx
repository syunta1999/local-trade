import { useEffect, useMemo, useRef } from 'react';
import { todaysTask } from '../lib/daily';
import { playCheer } from '../lib/sound';
import type { Trade } from '../lib/trading';

/** 今日のお題。達成すると緑になる */
export function DailyCard({ trades, onClose }: { trades: Trade[]; onClose: () => void }) {
  const task = useMemo(() => todaysTask(), []);
  const state = task.check(trades);
  const wasDone = useRef(false);

  useEffect(() => {
    if (state.done && !wasDone.current) playCheer();
    wasDone.current = state.done;
  }, [state.done]);

  return (
    <div className={`daily${state.done ? ' done' : ''}`}>
      <div className="daily-head">
        <span>今日のお題</span>
        <button type="button" className="rp-x" onClick={onClose} title="閉じる">
          ×
        </button>
      </div>
      <strong className="daily-title">{task.title}</strong>
      <span className="daily-detail">{task.detail}</span>
      <div className="daily-foot">
        <span>{state.progress}</span>
        {state.done && <em>達成</em>}
      </div>
    </div>
  );
}
