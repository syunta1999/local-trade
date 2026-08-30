import type { Analysis, ChallengeLog, Excursion } from './analysis';
import { formatClock } from './csv';
import type { PositionSide, Trade } from './trading';

/** 取引履歴をCSV文字列にする。Excelで開けるよう UTF-8 BOM を付ける */
export function tradesToCsv(trades: Trade[], symbol: string | null, dateLabel: string): string {
  const head = '銘柄,日付,番号,方向,数量,建玉時刻,建値,返済時刻,返済値,損益,累計損益';
  let acc = 0;
  const rows = trades.map((t) => {
    acc += t.pnl;
    return [
      symbol ?? '',
      dateLabel,
      t.id,
      t.side === 'long' ? '買' : '売',
      t.qty,
      formatClock(t.entryAt),
      round2(t.entry),
      formatClock(t.exitAt),
      round2(t.exit),
      round2(t.pnl),
      round2(acc),
    ].join(',');
  });
  return `﻿${[head, ...rows].join('\r\n')}\r\n`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 文字列をCSVファイルとしてダウンロードさせる */
export function downloadCsv(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke が早すぎるとダウンロードが始まらないブラウザがある
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- チャレンジの記録 ----------------------------------------------------

export const CHALLENGE_FILE = 'challenges.csv';
export const CHALLENGE_TRADES_FILE = 'trades.csv';

const CHALLENGE_HEAD =
  'ID,開始日時,終了日時,銘柄,日付,ファイル,開始時刻,終了時刻,取引数,勝ち,負け,勝率,総損益,PF,RR,期待値,損益分岐勝率,優位性,最大DD,最大連勝,最大連敗,平均保有秒,勝ち保有秒,負け保有秒,平均MFE,平均MAE,負け逆行,負け損切,勝ち逆行,収穫率,取消数,シーク数';

const CHALLENGE_TRADES_HEAD =
  'チャレンジID,銘柄,日付,番号,方向,数量,建玉時刻,建値,返済時刻,返済値,損益,保有秒,MFE,MAE,建玉待ち秒,返済待ち秒';

const stamp = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const pct = (n: number) => round2(n * 100);

/** チャレンジ1回ぶんの要約を1行にする */
export function challengeRow(log: ChallengeLog, a: Analysis): string {
  return [
    log.id,
    stamp(log.startedAt),
    stamp(log.endedAt),
    log.symbol ?? '',
    log.dateLabel,
    log.fileName,
    formatClock(log.fromClock),
    formatClock(log.toClock),
    a.all.count,
    a.all.wins,
    a.all.losses,
    pct(a.all.winRate),
    round2(a.all.pnl),
    round2(a.all.profitFactor),
    round2(a.all.riskReward),
    round2(a.all.expectancy),
    pct(a.all.breakEvenWinRate),
    pct(a.all.edge),
    round2(a.risk.maxDrawdown),
    a.risk.maxWinStreak,
    a.risk.maxLoseStreak,
    Math.round(a.time.avgHold),
    Math.round(a.time.avgHoldWin),
    Math.round(a.time.avgHoldLose),
    round2(a.exec.avgMfe),
    round2(a.exec.avgMae),
    round2(a.exec.loseMae),
    round2(a.exec.loseLoss),
    round2(a.exec.winMae),
    pct(a.exec.captureRate),
    a.time.cancelled,
    log.seeks,
  ].join(',');
}

/** チャレンジ内の各取引を1行ずつにする */
export function challengeTradeRows(log: ChallengeLog, a: Analysis): string[] {
  const ex = new Map(a.exec.items.map((i) => [i.trade.id, i]));
  return log.trades.map((t) => {
    const e = ex.get(t.id);
    return [
      log.id,
      log.symbol ?? '',
      log.dateLabel,
      t.id,
      t.side === 'long' ? '買' : '売',
      t.qty,
      formatClock(t.entryAt),
      round2(t.entry),
      formatClock(t.exitAt),
      round2(t.exit),
      round2(t.pnl),
      Math.max(0, t.exitAt - t.entryAt),
      round2(e?.mfe ?? 0),
      round2(e?.mae ?? 0),
      Math.round(t.entryWait),
      Math.round(t.exitWait),
    ].join(',');
  });
}

/**
 * リセットを始めたら以後の書き戻しを止める。
 * 消した直後に、画面が持っている古い設定やルールが書き直されるのを防ぐ。
 */
let frozen = false;

/** 開発サーバーに記録を溜める。APIが無ければ黙って諦める */
export async function saveChallenge(log: ChallengeLog, a: Analysis): Promise<boolean> {
  if (frozen) return false;
  try {
    const res = await fetch('/api/challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [
          { name: CHALLENGE_FILE, header: CHALLENGE_HEAD, rows: [challengeRow(log, a)] },
          { name: CHALLENGE_TRADES_FILE, header: CHALLENGE_TRADES_HEAD, rows: challengeTradeRows(log, a) },
        ],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 分析結果を手元にCSVで落とす */
export function downloadChallenge(log: ChallengeLog, a: Analysis): void {
  const text = [
    CHALLENGE_HEAD,
    challengeRow(log, a),
    '',
    CHALLENGE_TRADES_HEAD,
    ...challengeTradeRows(log, a),
  ].join('\r\n');
  const name = `challenge-${log.symbol ?? 'unknown'}-${log.dateLabel.replace(/-/g, '')}-${log.id}.csv`;
  downloadCsv(`\uFEFF${text}\r\n`, name);
}

// ---- 溜めた記録の読み出し ------------------------------------------------

/** チャレンジ1回ぶんの要約（一覧表示と削除に使う） */
export type ChallengeSummary = {
  id: string;
  startedAt: string;
  symbol: string;
  dateLabel: string;
  fileName: string;
  trades: number;
  pnl: number;
  seeks: number;
};

export type StoredChallenges = {
  summaries: ChallengeSummary[];
  /** 全チャレンジの取引。MAE/MFE も記録済みなのでティック無しで集計できる */
  items: Excursion[];
  /** 取消の合計 */
  cancelled: number;
};

/** ヘッダー名で列を引く。将来列が増えても壊れないように */
function parseCsvRows(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const head = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    head.forEach((h, i) => (row[h] = cells[i] ?? ''));
    return row;
  });
}

const toNum = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** "2026-08-28" と "09:05:12" を、壁時計をUTCとして符号化した秒に戻す */
function toEpoch(dateLabel: string, clock: string): number {
  const [y, m, d] = dateLabel.split('-').map(Number);
  const [hh, mm, ss] = clock.split(':').map(Number);
  if (!y || !m || !d || !Number.isFinite(hh)) return 0;
  return Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0) / 1000;
}

/** 溜まっているCSVを読んで、集計にかけられる形にする */
export async function loadChallenges(): Promise<StoredChallenges | null> {
  let files: Record<string, string>;
  try {
    const res = await fetch('/api/challenges');
    if (!res.ok) return null;
    files = ((await res.json()) as { files?: Record<string, string> }).files ?? {};
  } catch {
    return null;
  }

  const summaries: ChallengeSummary[] = parseCsvRows(files[CHALLENGE_FILE] ?? '').map((r) => ({
    id: r['ID'],
    startedAt: r['開始日時'],
    symbol: r['銘柄'],
    dateLabel: r['日付'],
    fileName: r['ファイル'],
    trades: toNum(r['取引数']),
    pnl: toNum(r['総損益']),
    seeks: toNum(r['シーク数']),
  }));
  const cancelled = parseCsvRows(files[CHALLENGE_FILE] ?? '').reduce(
    (a, r) => a + toNum(r['取消数']),
    0,
  );

  let n = 0;
  const items: Excursion[] = parseCsvRows(files[CHALLENGE_TRADES_FILE] ?? '').map((r) => {
    const side: PositionSide = r['方向'] === '売' ? 'short' : 'long';
    const qty = toNum(r['数量']);
    const date = r['日付'];
    const trade: Trade = {
      id: ++n,
      side,
      qty,
      entry: toNum(r['建値']),
      exit: toNum(r['返済値']),
      entryAt: toEpoch(date, r['建玉時刻']),
      exitAt: toEpoch(date, r['返済時刻']),
      entryN: 0,
      exitN: 0,
      entryWait: toNum(r['建玉待ち秒']),
      exitWait: toNum(r['返済待ち秒']),
      pnl: toNum(r['損益']),
    };
    const mfe = toNum(r['MFE']);
    const mae = toNum(r['MAE']);
    return { trade, mae, mfe, maeMoney: mae * qty, mfeMoney: mfe * qty };
  });

  return { summaries, items, cancelled };
}

/**
 * data/challenges を初期状態に戻す。ファイルごと消すので、
 * 次に読むときは既定値になる。呼び出し側は画面を作り直すこと。
 */
export async function resetChallenges(): Promise<boolean> {
  frozen = true;
  try {
    const res = await fetch('/api/challenges', { method: 'DELETE' });
    const body = res.ok
      ? ((await res.json().catch(() => null)) as { removed?: string[] } | null)
      : null;
    // APIの無いところ（ビルド後の配信など）では index.html が返る。
    // 消した一覧が返ってきたときだけ成功とみなす
    if (Array.isArray(body?.removed)) return true;
    frozen = false;
    return false;
  } catch {
    frozen = false;
    return false;
  }
}

/** チャレンジ1件ぶんの記録を消す */
export async function deleteChallenge(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/challenges/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

// ---- ゴーストリプレイ ----------------------------------------------------

/** 前回の自分の1トレード。チャートに薄く重ねる用 */
export type GhostTrade = {
  side: PositionSide;
  qty: number;
  entryAt: number;
  exitAt: number;
  entry: number;
  exit: number;
  pnl: number;
};

/**
 * 同じCSVで最後にやったチャレンジの取引を返す。
 * 「前回の自分」をチャートに重ねてレースするため。
 */
export async function loadGhost(fileName: string): Promise<GhostTrade[]> {
  let files: Record<string, string>;
  try {
    const res = await fetch('/api/challenges');
    if (!res.ok) return [];
    files = ((await res.json()) as { files?: Record<string, string> }).files ?? {};
  } catch {
    return [];
  }

  const mine = parseCsvRows(files[CHALLENGE_FILE] ?? '').filter(
    (r) => r['ファイル'] === fileName && toNum(r['取引数']) > 0,
  );
  if (mine.length === 0) return [];
  // ID は開始時刻(ms)なので、いちばん大きいものが直近
  const latest = mine.reduce((a, b) => (toNum(a['ID']) >= toNum(b['ID']) ? a : b));

  return parseCsvRows(files[CHALLENGE_TRADES_FILE] ?? '')
    .filter((r) => r['チャレンジID'] === latest['ID'])
    .map((r) => ({
      side: (r['方向'] === '売' ? 'short' : 'long') as PositionSide,
      qty: toNum(r['数量']),
      entryAt: toEpoch(r['日付'], r['建玉時刻']),
      exitAt: toEpoch(r['日付'], r['返済時刻']),
      entry: toNum(r['建値']),
      exit: toNum(r['返済値']),
      pnl: toNum(r['損益']),
    }));
}

// ---- 設定の保存（ルール・画面の設定） ------------------------------------

/** 「いまの状態」なので追記ではなく丸ごと差し替える */
export async function saveStateCsv(rows: string[], header: string, name: string): Promise<boolean> {
  if (frozen) return false;
  try {
    const res = await fetch('/api/challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ name, header, rows, replace: true }] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function loadStateCsv(name: string): Promise<string | null> {
  try {
    const res = await fetch('/api/challenges');
    if (!res.ok) return null;
    const files = ((await res.json()) as { files?: Record<string, string> }).files ?? {};
    return files[name] ?? null;
  } catch {
    return null;
  }
}
