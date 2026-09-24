/**
 * 日報。1日ぶんを public/data/diary/<日付>/entry.md に、画像を同じフォルダに置く。
 * 保存は開発サーバーのAPI（vite.config.ts の diaryApi）に肩代わりさせる。
 *
 * 本文はテキストエディタでもそのまま読めるよう、front matter と見出しだけの素朴な書式にした。
 *
 *   ---
 *   date: 2026-09-10
 *   title: -7800 マクロ下げ、上げチャート狙い
 *   ---
 *
 *   ## 改善リスト
 *   ・エントリーミスの場合は損切りも早くする
 *
 *   ## メモ
 *   エントリーミスが目立つ。
 */

export type DiaryEntry = {
  /** YYYY-MM-DD。フォルダ名にもなる */
  date: string;
  title: string;
  /** 改善リスト */
  improve: string;
  /** メモ */
  memo: string;
};

export type DiaryHead = { date: string; title: string; images: number };
export type DiaryLoaded = DiaryEntry & { images: string[] };

export const SECTION_IMPROVE = '改善リスト';
export const SECTION_MEMO = 'メモ';

const HEAD_IMPROVE = `## ${SECTION_IMPROVE}`;
const HEAD_MEMO = `## ${SECTION_MEMO}`;

export const isDiaryDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** きょうの日付（端末のローカル時刻） */
export function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** 2026-09-10 → 2026/09/10（木） */
export function labelDate(date: string): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return date;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const w = Number.isNaN(d.getTime()) ? '' : `（${WEEK[d.getDay()]}）`;
  return `${m[1]}/${m[2]}/${m[3]}${w}`;
}

const trimBlank = (s: string) => s.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '');

export function formatEntry(e: DiaryEntry): string {
  const title = e.title.replace(/[\r\n]+/g, ' ').trim();
  return [
    '---',
    `date: ${e.date}`,
    `title: ${title}`,
    '---',
    '',
    HEAD_IMPROVE,
    trimBlank(e.improve),
    '',
    HEAD_MEMO,
    trimBlank(e.memo),
    '',
  ].join('\n');
}

/**
 * 本文を読み戻す。手で書き換えた行も失わないよう、
 * 知らない見出しや見出しより前の文はそのままメモに寄せる。
 */
export function parseEntry(date: string, text: string): DiaryEntry {
  let body = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let title = '';

  const fm = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m && m[1] === 'title') title = m[2].trim();
    }
    body = body.slice(fm[0].length);
  }

  const buckets: Record<'improve' | 'memo', string[]> = { improve: [], memo: [] };
  const preface: string[] = [];
  let cur: 'improve' | 'memo' | null = null;
  for (const line of body.split('\n')) {
    const head = line.trim();
    if (head === HEAD_IMPROVE) {
      cur = 'improve';
      continue;
    }
    if (head === HEAD_MEMO) {
      cur = 'memo';
      continue;
    }
    (cur ? buckets[cur] : preface).push(line);
  }

  const improve = trimBlank(buckets.improve.join('\n'));
  const pre = trimBlank(preface.join('\n'));
  const memo = trimBlank([pre, buckets.memo.join('\n')].filter(Boolean).join('\n\n'));
  return { date, title, improve, memo };
}

// ---- API -------------------------------------------------------------------

const base = (date: string) => `/api/diary/${encodeURIComponent(date)}`;

export const diaryImageUrl = (date: string, name: string) =>
  `${base(date)}/images/${encodeURIComponent(name)}`;

async function fail(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? `${fallback}（${res.status}）`);
}

/** APIが無い（ビルド後など）ときは HTML が返ってくるので、そこで気づけるようにする */
async function asJson<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) return fail(res, fallback);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    throw new Error('日報は開発サーバー（npm run dev）でだけ使えます');
  }
  return (await res.json()) as T;
}

export async function listDiary(): Promise<DiaryHead[]> {
  const res = await fetch('/api/diary', { cache: 'no-store' });
  const body = await asJson<{ entries: DiaryHead[] }>(res, '一覧を読めませんでした');
  return body.entries;
}

export async function loadDiary(date: string): Promise<DiaryLoaded> {
  const res = await fetch(base(date), { cache: 'no-store' });
  const body = await asJson<{ text: string; images: string[] }>(res, '日報を読めませんでした');
  return { ...parseEntry(date, body.text), images: body.images };
}

/** from を渡すと、その日付のフォルダを新しい日付へ移してから書く */
export async function saveDiary(e: DiaryEntry, from?: string): Promise<void> {
  const res = await fetch(base(e.date), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: formatEntry(e), from: from && from !== e.date ? from : undefined }),
  });
  await asJson(res, '保存できませんでした');
}

/** 実際に付いた名前を返す（同名があると番号が足される） */
export async function addDiaryImage(date: string, file: Blob, name: string): Promise<string> {
  const res = await fetch(diaryImageUrl(date, name), {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const body = await asJson<{ name: string }>(res, '画像を保存できませんでした');
  return body.name;
}

export async function removeDiaryImage(date: string, name: string): Promise<void> {
  const res = await fetch(diaryImageUrl(date, name), { method: 'DELETE' });
  if (res.status === 404) return;
  await asJson(res, '画像を外せませんでした');
}
