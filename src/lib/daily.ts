import { hash32, mulberry32 } from './jitter';
import type { Trade } from './trading';

/**
 * 今日のお題。日付を種にするので、同じ日なら何度開いても同じ内容が出る。
 * 達成判定はいま記録中のチャレンジの取引だけを見る。
 */

export type TaskProgress = { done: boolean; progress: string };

export type DailyTask = {
  /** YYYY-MM-DD */
  id: string;
  title: string;
  detail: string;
  check: (trades: Trade[]) => TaskProgress;
};

const yen = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n).toLocaleString('ja-JP')}円`;
const sum = (t: Trade[]) => t.reduce((a, x) => a + x.pnl, 0);

/** 日付文字列 YYYY-MM-DD */
export function dayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type Builder = (rand: () => number) => Omit<DailyTask, 'id'>;

const BUILDERS: Builder[] = [
  // 利益目標
  (rand) => {
    const goal = (1 + Math.floor(rand() * 5)) * 5000;
    return {
      title: `${yen(goal)} を稼ぐ`,
      detail: '確定損益の合計が目標に届けば達成。回数は問わない。',
      check: (t) => {
        const p = sum(t);
        return { done: p >= goal, progress: `${yen(p)} / ${yen(goal)}` };
      },
    };
  },
  // 勝率
  (rand) => {
    const n = 4 + Math.floor(rand() * 5);
    const rate = 0.5 + Math.floor(rand() * 3) * 0.1;
    return {
      title: `${n}回以上トレードして勝率${Math.round(rate * 100)}%`,
      detail: '引き分けは母数から除く。数をこなしつつ精度を保つ。',
      check: (t) => {
        const w = t.filter((x) => x.pnl > 0).length;
        const l = t.filter((x) => x.pnl < 0).length;
        const r = w + l ? w / (w + l) : 0;
        return {
          done: t.length >= n && r >= rate,
          progress: `${t.length}回 / 勝率 ${(r * 100).toFixed(0)}%`,
        };
      },
    };
  },
  // 大きく負けない
  (rand) => {
    const cap = (1 + Math.floor(rand() * 4)) * 2000;
    const wins = 2 + Math.floor(rand() * 3);
    return {
      title: `1回も -${cap.toLocaleString('ja-JP')}円 を超えずに ${wins}勝`,
      detail: '大きな負けを1回も出さずに勝ちを重ねる。損切りの練習。',
      check: (t) => {
        const worst = t.length ? Math.min(...t.map((x) => x.pnl)) : 0;
        const w = t.filter((x) => x.pnl > 0).length;
        return {
          done: w >= wins && worst > -cap,
          progress: `${w}勝 / 最大の負け ${yen(worst)}`,
        };
      },
    };
  },
  // 片方向縛り
  (rand) => {
    const short = rand() < 0.5;
    const goal = (1 + Math.floor(rand() * 3)) * 3000;
    return {
      title: `${short ? '売り' : '買い'}だけで ${yen(goal)}`,
      detail: `${short ? 'ショート' : 'ロング'}の損益だけで目標に届けば達成。逆方向は数えない。`,
      check: (t) => {
        const side = t.filter((x) => (short ? x.side === 'short' : x.side === 'long'));
        const p = sum(side);
        return { done: p >= goal, progress: `${yen(p)} / ${yen(goal)}（${side.length}回）` };
      },
    };
  },
  // 規律
  (rand) => {
    const dd = (1 + Math.floor(rand() * 3)) * 3000;
    const goal = (1 + Math.floor(rand() * 3)) * 4000;
    return {
      title: `ドローダウン ${dd.toLocaleString('ja-JP')}円 以内で ${yen(goal)}`,
      detail: '一度も大きく凹まずに勝ち切る。資金曲線をなめらかに保つ。',
      check: (t) => {
        let cum = 0;
        let peak = 0;
        let worst = 0;
        for (const x of t) {
          cum += x.pnl;
          peak = Math.max(peak, cum);
          worst = Math.max(worst, peak - cum);
        }
        return {
          done: cum >= goal && worst <= dd,
          progress: `${yen(cum)} / 最大DD ${Math.round(worst).toLocaleString('ja-JP')}円`,
        };
      },
    };
  },
];

/** その日のお題を1つ返す */
export function todaysTask(date = new Date()): DailyTask {
  const id = dayKey(date);
  const rand = mulberry32(hash32(Number(id.replace(/-/g, ''))));
  const build = BUILDERS[Math.floor(rand() * BUILDERS.length)];
  return { id, ...build(rand) };
}
