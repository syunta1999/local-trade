import { memo } from 'react';
import { formatClock } from '../lib/csv';
import type { Tick } from '../lib/types';

type Props = {
  tape: Tick[];
  /** これ以上の株数を大口としてハイライト */
  largeSize: number;
  rows?: number;
};

function dirClass(dir: Tick['dir']) {
  return dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat';
}

export const Tape = memo(function Tape({ tape, largeSize, rows = 160 }: Props) {
  const visible = tape.length > rows ? tape.slice(0, rows) : tape;

  return (
    <div className="tape">
      <div className="tape-head">
        <span>時刻</span>
        <span className="num">値段</span>
        <span className="num">株数</span>
      </div>
      <div className="tape-body">
        {visible.length === 0 && <div className="tape-empty">再生すると約定が流れます</div>}
        {visible.map((tk, i) => (
          <div
            key={tk.n}
            className={`tape-row ${dirClass(tk.dir)}${i === 0 ? ' latest' : ''}${
              tk.size >= largeSize ? ' large' : ''
            }`}
          >
            <span className="t">{formatClock(tk.t)}</span>
            <span className="num p">{tk.price.toLocaleString('ja-JP')}</span>
            <span className="num s">{tk.size.toLocaleString('ja-JP')}</span>
          </div>
        ))}
      </div>
    </div>
  );
});
