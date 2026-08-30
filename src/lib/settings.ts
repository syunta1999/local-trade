/**
 * 画面の設定をまとめて CSV に保存する。
 *
 * 起動のたびにインジケーターや音を選び直すのが面倒なので、
 * ルールと同じ仕組み（public/data/challenges/ に置く1枚のCSV）で丸ごと覚えておく。
 * 「項目,値」の2列だけ。配列は | で区切る。
 */

import type { Level } from './bot';
import { DEFAULT_THEME, THEMES } from './themes';
import type { SoundPrefs } from './sound';
import type { IndicatorUi } from './types';

export const SETTINGS_FILE = 'settings.csv';
export const SETTINGS_HEAD = '項目,値';

/** 対戦のスコアボードの位置と大きさ */
export type Box = { x: number; y: number; w: number; h: number };

export type Settings = {
  /** インジケーター */
  ind: IndicatorUi;
  /** 足の秒数 */
  interval: number;
  /** 再生倍速 */
  speed: number;
  /** 昼休みスキップ */
  skipGaps: boolean;
  /** 音の種類ごとのオン・オフ */
  sound: SoundPrefs;
  /** 歩み値パネル */
  tapeOpen: boolean;
  largeSize: number;
  /** 対戦 */
  level: Level;
  roundSec: number;
  matchBox: Box;
  /** 対戦の窓を帯だけに畳んでいるか */
  matchFold: boolean;
  /** botの売買パネルの位置・大きさ・畳んでいるか */
  botBox: Box;
  botOpen: boolean;
  botFold: boolean;
  /** ヘッダー・フッターを開いているか */
  header: boolean;
  footer: boolean;
  /** 配色テーマ */
  theme: string;
};

export const DEFAULT_SETTINGS: Settings = {
  ind: {
    maOn: true,
    maPeriods: [5, 25, 75],
    bbOn: true,
    bbPeriod: 20,
    bbSigma: 2,
    rsiOn: false,
    rsiPeriod: 14,
  },
  interval: 60,
  speed: 1,
  skipGaps: true,
  sound: { bgm: true, tape: true, fill: true },
  tapeOpen: true,
  largeSize: 5000,
  level: 'normal',
  roundSec: 1800,
  matchBox: { x: 12, y: 0, w: 290, h: 0 },
  matchFold: false,
  botBox: { x: 0, y: 0, w: 560, h: 420 },
  botOpen: true,
  botFold: false,
  header: true,
  footer: true,
  theme: DEFAULT_THEME,
};

const b = (v: boolean) => (v ? '1' : '0');

export function settingsToRows(s: Settings): string[] {
  const m = s.matchBox;
  return [
    `ind.ma,${b(s.ind.maOn)}`,
    `ind.maPeriods,${s.ind.maPeriods.join('|')}`,
    `ind.bb,${b(s.ind.bbOn)}`,
    `ind.bbPeriod,${s.ind.bbPeriod}`,
    `ind.bbSigma,${s.ind.bbSigma}`,
    `ind.rsi,${b(s.ind.rsiOn)}`,
    `ind.rsiPeriod,${s.ind.rsiPeriod}`,
    `interval,${s.interval}`,
    `speed,${s.speed}`,
    `skipGaps,${b(s.skipGaps)}`,
    `sound.bgm,${b(s.sound.bgm)}`,
    `sound.tape,${b(s.sound.tape)}`,
    `sound.fill,${b(s.sound.fill)}`,
    `tape.open,${b(s.tapeOpen)}`,
    `tape.large,${s.largeSize}`,
    `match.level,${s.level}`,
    `match.sec,${s.roundSec}`,
    `match.box,${[m.x, m.y, m.w, m.h].join('|')}`,
    `match.fold,${b(s.matchFold)}`,
    `bot.box,${[s.botBox.x, s.botBox.y, s.botBox.w, s.botBox.h].join('|')}`,
    `bot.open,${b(s.botOpen)}`,
    `bot.fold,${b(s.botFold)}`,
    `chrome.header,${b(s.header)}`,
    `chrome.footer,${b(s.footer)}`,
    `theme,${s.theme}`,
  ];
}

/** 読めた項目だけ上書きする。増減しても壊れないようにキー引きにしてある */
export function settingsFromCsv(text: string): Settings {
  const map = new Map<string, string>();
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/).slice(1)) {
    const i = line.indexOf(',');
    if (i > 0) map.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }

  const s: Settings = {
    ...DEFAULT_SETTINGS,
    ind: { ...DEFAULT_SETTINGS.ind, maPeriods: [...DEFAULT_SETTINGS.ind.maPeriods] },
    sound: { ...DEFAULT_SETTINGS.sound },
    matchBox: { ...DEFAULT_SETTINGS.matchBox },
    botBox: { ...DEFAULT_SETTINGS.botBox },
  };

  const bool = (k: string, fb: boolean) => {
    const v = map.get(k);
    return v === undefined ? fb : v === '1';
  };
  const num = (k: string, fb: number) => {
    const raw = map.get(k);
    // 空欄は「書いていない」と同じ扱い。Number('') は 0 になってしまうため
    if (raw === undefined || raw.trim() === '') return fb;
    const v = Number(raw);
    return Number.isFinite(v) ? v : fb;
  };
  /** 0以下だと画面が止まる項目用 */
  const pos = (k: string, fb: number) => {
    const v = num(k, fb);
    return v > 0 ? v : fb;
  };

  s.ind.maOn = bool('ind.ma', s.ind.maOn);
  const ma = (map.get('ind.maPeriods') ?? '')
    .split('|')
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ma.length) s.ind.maPeriods = ma;
  s.ind.bbOn = bool('ind.bb', s.ind.bbOn);
  s.ind.bbPeriod = pos('ind.bbPeriod', s.ind.bbPeriod);
  s.ind.bbSigma = pos('ind.bbSigma', s.ind.bbSigma);
  s.ind.rsiOn = bool('ind.rsi', s.ind.rsiOn);
  s.ind.rsiPeriod = pos('ind.rsiPeriod', s.ind.rsiPeriod);

  s.interval = pos('interval', s.interval);
  s.speed = pos('speed', s.speed);
  s.skipGaps = bool('skipGaps', s.skipGaps);

  s.sound.bgm = bool('sound.bgm', s.sound.bgm);
  s.sound.tape = bool('sound.tape', s.sound.tape);
  s.sound.fill = bool('sound.fill', s.sound.fill);

  s.tapeOpen = bool('tape.open', s.tapeOpen);
  s.largeSize = pos('tape.large', s.largeSize);

  const lv = map.get('match.level');
  if (lv === 'easy' || lv === 'normal' || lv === 'hard') s.level = lv;
  s.roundSec = pos('match.sec', s.roundSec);
  const readBox = (k: string, fb: Box): Box => {
    const v = (map.get(k) ?? '').split('|').map(Number);
    return v.length === 4 && v.every((n) => Number.isFinite(n))
      ? { x: v[0], y: v[1], w: v[2], h: v[3] }
      : fb;
  };
  s.matchBox = readBox('match.box', s.matchBox);
  s.matchFold = bool('match.fold', s.matchFold);
  s.botBox = readBox('bot.box', s.botBox);
  s.botOpen = bool('bot.open', s.botOpen);
  s.botFold = bool('bot.fold', s.botFold);

  s.header = bool('chrome.header', s.header);
  s.footer = bool('chrome.footer', s.footer);
  const th = map.get('theme');
  if (th && THEMES.some((t) => t.id === th)) s.theme = th;
  return s;
}
