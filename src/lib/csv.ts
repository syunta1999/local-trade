import { assignReplayTimes } from './jitter';
import type { ParsedCsv, Tick } from './types';

/**
 * 証券会社の歩み値CSVは UTF-8(BOM付き) と Shift_JIS が混在するため、
 * UTF-8 で置換文字が出たら Shift_JIS で読み直す。
 */
export function decodeCsv(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return stripBom(utf8);
  try {
    return stripBom(new TextDecoder('shift_jis').decode(buf));
  } catch {
    return stripBom(utf8);
  }
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

const ALIASES = {
  price: ['値段', '価格', '約定値', '約定価格', 'price'],
  size: ['株数', '数量', '約定株数', '出来高', 'size', 'qty', 'volume'],
  value: ['金額', '代金', '約定代金', 'value', 'amount'],
  time: ['時刻', '時間', '約定時刻', 'time'],
} as const;

type ColMap = { price: number; size: number; value: number; time: number };

function detectColumns(headerCells: string[]): ColMap | null {
  const norm = headerCells.map((c) => c.trim().replace(/^"|"$/g, ''));
  const find = (keys: readonly string[]) =>
    norm.findIndex((c) => keys.some((k) => c === k || c.includes(k)));
  const price = find(ALIASES.price);
  const size = find(ALIASES.size);
  const time = find(ALIASES.time);
  if (price < 0 || size < 0 || time < 0) return null;
  return { price, size, value: find(ALIASES.value), time };
}

/** "15:30:00" / "15:30" / "15:30:00.5" → 秒 */
function parseClock(raw: string): number | null {
  const parts = raw.trim().replace(/^"|"$/g, '').split(':');
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const s = parts.length > 2 ? Number(parts[2]) : 0;
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
  return h * 3600 + m * 60 + Math.floor(s);
}

function toNumber(raw: string | undefined): number {
  if (raw == null) return 0;
  const n = Number(raw.replace(/[",\s円]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** ファイル名から日付(8桁)と銘柄コード(4桁)を推定する。例: qr-6330-20260828.csv */
function inferMeta(fileName: string): { symbol: string | null; y: number; m: number; d: number } {
  const tokens = fileName.replace(/\.[^.]+$/, '').split(/[^0-9]+/).filter(Boolean);
  let y = 0;
  let m = 0;
  let d = 0;
  for (const tk of tokens) {
    if (tk.length !== 8) continue;
    const yy = Number(tk.slice(0, 4));
    const mm = Number(tk.slice(4, 6));
    const dd = Number(tk.slice(6, 8));
    if (yy >= 1990 && yy <= 2999 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      y = yy;
      m = mm;
      d = dd;
      break;
    }
  }
  if (!y) {
    const now = new Date();
    y = now.getFullYear();
    m = now.getMonth() + 1;
    d = now.getDate();
  }
  const symbol = tokens.find((tk) => tk.length === 4 && tk !== String(y)) ?? null;
  return { symbol, y, m, d };
}

export function parseCsv(text: string, fileName: string): ParsedCsv {
  const { symbol, y, m, d } = inferMeta(fileName);
  const dayBase = Date.UTC(y, m - 1, d) / 1000;

  const lines = text.split(/\r?\n/);
  let cols: ColMap = { price: 0, size: 1, value: 2, time: 3 };
  let start = 0;

  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const detected = detectColumns(line.split(','));
    if (detected) {
      cols = detected;
      start = i + 1;
    } else {
      start = i;
    }
    break;
  }

  const ticks: Tick[] = [];
  let skipped = 0;

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = line.split(',');
    const sec = parseClock(cells[cols.time] ?? '');
    const price = toNumber(cells[cols.price]);
    const size = toNumber(cells[cols.size]);
    if (sec == null || price <= 0 || size <= 0) {
      skipped++;
      continue;
    }
    const value = cols.value >= 0 ? toNumber(cells[cols.value]) : price * size;
    const t = dayBase + sec;
    ticks.push({ n: 0, t, rt: t, price, size, value: value || price * size, dir: 0 });
  }

  // 歩み値CSVは新しい順（降順）で出力されることが多いので時系列に直す。
  if (ticks.length > 1 && ticks[0].t > ticks[ticks.length - 1].t) ticks.reverse();
  // Array.prototype.sort は安定ソートなので同一秒内の並びは保たれる。
  ticks.sort((a, b) => a.t - b.t);

  for (let i = 0; i < ticks.length; i++) {
    ticks[i].n = i;
    if (i === 0) continue;
    const diff = ticks[i].price - ticks[i - 1].price;
    ticks[i].dir = diff > 0 ? 1 : diff < 0 ? -1 : 0;
  }

  // 同一秒のティックをコンマ秒に散らす（再生の見た目だけ。t は実時刻のまま）
  assignReplayTimes(ticks);

  const dateLabel = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { ticks, symbol, dateLabel, fileName, skipped };
}

/** 壁時計表示（チャートと同じくUTCとして解釈） */
export function formatClock(t: number, withSeconds = true): string {
  const dt = new Date(t * 1000);
  const hh = String(dt.getUTCHours()).padStart(2, '0');
  const mm = String(dt.getUTCMinutes()).padStart(2, '0');
  if (!withSeconds) return `${hh}:${mm}`;
  return `${hh}:${mm}:${String(dt.getUTCSeconds()).padStart(2, '0')}`;
}
