/**
 * 音まわり。すべてその場で合成するので音源ファイルの依存は無い。
 * AudioContext はユーザー操作の中でしか起こせないので、最初のクリックで unlockSound() を呼ぶ。
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** 音の種類。それぞれ独立にオン・オフできる */
export type SoundChannel = 'bgm' | 'tape' | 'fill';
export type SoundPrefs = Record<SoundChannel, boolean>;

/** 既定は全部オン。ただし AudioContext はユーザー操作があるまで動き出さない */
const prefs: SoundPrefs = { bgm: true, tape: true, fill: true };

export function soundPrefs(): SoundPrefs {
  return { ...prefs };
}

export function isSoundOn(ch: SoundChannel): boolean {
  return prefs[ch];
}

/** 高倍速で音が洪水にならないよう、1秒あたりの発音数を抑える */
const MAX_PER_SEC = 18;
let budget = MAX_PER_SEC;
let budgetAt = 0;

/** ユーザー操作の中から呼ぶこと。ブラウザの自動再生制限を外す */
export function unlockSound(): void {
  if (ctx) {
    void ctx.resume();
    return;
  }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.12;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

export function setSoundChannel(ch: SoundChannel, on: boolean): void {
  prefs[ch] = on;
  if (on) unlockSound();
  if (ch === 'bgm' && !on) setBgm('off');
}

function beep(freq: number, ms: number, gain: number, type: OscillatorType = 'sine'): void {
  if (!ctx || !master || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  // 立ち上がりを一瞬にしてクリック音を避ける
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(gain, now + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
  osc.connect(env).connect(master);
  osc.start(now);
  osc.stop(now + ms / 1000 + 0.02);
}

function spend(): boolean {
  if (!ctx) return false;
  const sec = Math.floor(ctx.currentTime);
  if (sec !== budgetAt) {
    budgetAt = sec;
    budget = MAX_PER_SEC;
  }
  if (budget <= 0) return false;
  budget--;
  return true;
}

/** 大口とみなす株数。この値で音の重みが決まる */
let largeSize = 5000;

export function setLargeSize(n: number): void {
  largeSize = Math.max(1, n);
}

/** 値動きの音。株数が多いほど低く大きく、値段が上がったら高めに鳴らす */
export function playTape(size: number, dir: -1 | 0 | 1): void {
  if (!prefs.tape || !spend()) return;
  const weight = Math.min(1, size / Math.max(largeSize, 1));
  const base = dir > 0 ? 880 : dir < 0 ? 660 : 770;
  // 大口ほど低い音にして存在感を出す
  const freq = base * (1 - weight * 0.45);
  beep(freq, 26 + weight * 60, 0.16 + weight * 0.5, 'triangle');
}

/** 自分の注文が約定したとき */
export function playFill(side: 'buy' | 'sell'): void {
  if (!prefs.fill) return;
  beep(side === 'buy' ? 523 : 392, 90, 0.8, 'square');
  window.setTimeout(() => beep(side === 'buy' ? 784 : 262, 110, 0.6, 'square'), 70);
}

/** 対戦botの約定。自分の約定と紛れないよう、低くて短い2発にする */
export function playBotFill(): void {
  if (!prefs.fill) return;
  beep(196, 55, 0.28, 'triangle');
  window.setTimeout(() => beep(147, 70, 0.22, 'triangle'), 55);
}

/** ルール違反 */
export function playAlert(): void {
  if (!prefs.fill) return;
  beep(240, 160, 0.9, 'sawtooth');
  window.setTimeout(() => beep(180, 240, 0.8, 'sawtooth'), 150);
}

/** お題の達成 */
export function playCheer(): void {
  if (!prefs.fill) return;
  [523, 659, 784, 1047].forEach((f, i) =>
    window.setTimeout(() => beep(f, 140, 0.7, 'triangle'), i * 90),
  );
}

// ---- BGM ------------------------------------------------------------------

/**
 * BGMもその場で合成する。音源ファイルを持たないので配布物が増えず、ライセンスの心配も無い。
 *
 * 2つのモードは和音進行とテンポを共有したまま、編成をはっきり変える。
 *   通常     … パッドだけ。暗く沈んだアンビエント
 *   チャレンジ … 明るいパッド + ベース + ハイハット + アルペジオ。倍の音量で駆動する
 * 切り替えの瞬間には短い合図（上昇 / 下降）を挟むので、見ていなくても気づける。
 */

export type BgmMode = 'off' | 'calm' | 'challenge';

/** Am → F → C → G。4小節でループする */
const CHORDS = [
  { pad: [220.0, 261.63, 329.63], bass: 110.0 },
  { pad: [174.61, 220.0, 261.63], bass: 87.31 },
  { pad: [261.63, 329.63, 392.0], bass: 130.81 },
  { pad: [196.0, 246.94, 293.66], bass: 98.0 },
];

/** 1コードあたりの刻み数 */
const STEPS_PER_CHORD = 16;
/**
 * 刻みの長さ。両モードで同じにしてあるので、切り替えても拍がずれない。
 * 「チャレンジ中は速い」という体感は、テンポではなく音数で作る。
 */
const STEP_DUR = 0.375;
/** 先読みしてスケジュールする秒数 */
const LOOKAHEAD = 0.35;
/** モードごとの音量。チャレンジ中ははっきり大きくする */
const BGM_GAIN: Record<Exclude<BgmMode, 'off'>, number> = { calm: 0.075, challenge: 0.17 };

let bgm: GainNode | null = null;
let mode: BgmMode = 'off';
let pendingMode: BgmMode = 'off';
let timer = 0;
let nextAt = 0;
let step = 0;

/** ハイハット用のホワイトノイズ。使い回す */
let noiseBuf: AudioBuffer | null = null;

function noiseBuffer(): AudioBuffer | null {
  if (!ctx) return null;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** ふわっと立ち上がって長く伸びる和音 */
function pad(freqs: number[], at: number, dur: number, bright: boolean): void {
  if (!ctx || !bgm) return;
  for (const f of freqs) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.value = f;
    lp.type = 'lowpass';
    // 通常は布をかぶせたようにこもらせ、チャレンジ中は開けて前に出す
    lp.frequency.value = bright ? 2400 : 620;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(0.1, at + dur * 0.35);
    env.gain.linearRampToValueAtTime(0.075, at + dur * 0.7);
    env.gain.linearRampToValueAtTime(0, at + dur);
    osc.connect(lp).connect(env).connect(bgm);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }
}

/** 短い音。ベースにもアルペジオにも使う */
function pluck(freq: number, at: number, dur: number, gain: number, type: OscillatorType): void {
  if (!ctx || !bgm) return;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(env).connect(bgm);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** ハイハット。拍を刻んで「動いている感」を出す */
function hat(at: number, gain: number): void {
  const buf = noiseBuffer();
  if (!ctx || !bgm || !buf) return;
  const src = ctx.createBufferSource();
  const hp = ctx.createBiquadFilter();
  const env = ctx.createGain();
  src.buffer = buf;
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.055);
  src.connect(hp).connect(env).connect(bgm);
  src.start(at, 0, 0.08);
}

/** 切り替わりの合図。上がるとチャレンジ開始、下がると終了 */
function stinger(up: boolean): void {
  if (!ctx || !bgm) return;
  const notes = up ? [329.63, 440.0, 587.33, 880.0] : [587.33, 440.0, 329.63];
  const at = ctx.currentTime + 0.02;
  notes.forEach((f, i) => pluck(f, at + i * 0.075, 0.32, up ? 0.22 : 0.14, 'triangle'));
}

function schedule(): void {
  if (!ctx || mode === 'off') return;
  while (nextAt < ctx.currentTime + LOOKAHEAD) {
    // 拍がずれないので、モードの変更は次の刻みですぐ効く
    mode = pendingMode;
    if (mode === 'off') {
      stopBgm();
      return;
    }
    const chord = CHORDS[Math.floor(step / STEPS_PER_CHORD) % CHORDS.length];
    const hot = mode === 'challenge';

    if (step % STEPS_PER_CHORD === 0) {
      pad(chord.pad, nextAt, STEPS_PER_CHORD * STEP_DUR * 1.05, hot);
    }
    if (!hot) {
      // 通常はゆっくりした低い脈だけ。無音と間違えない程度に鳴らしておく
      if (step % 8 === 0) pluck(chord.bass / 2, nextAt, 1.6, 0.09, 'sine');
    }
    if (hot) {
      // ベース・ハイハット・アルペジオを重ねる。編成の差で「記録中」と分かる
      if (step % 4 === 0) pluck(chord.bass, nextAt, 0.55, 0.2, 'sawtooth');
      if (step % 4 === 2) pluck(chord.bass * 2, nextAt, 0.22, 0.1, 'sawtooth');
      hat(nextAt, step % 4 === 0 ? 0.1 : 0.05);
      const arp = chord.pad[step % 3] * 2;
      if (step % 2 === 1) pluck(arp, nextAt, 0.2, 0.075, 'square');
    }

    nextAt += STEP_DUR;
    step++;
  }
}

/** BGMを切り替える。off で止まる */
export function setBgm(next: BgmMode): void {
  if (!prefs.bgm && next !== 'off') return;
  if (next !== 'off') unlockSound();
  if (!ctx) return;

  const prev = pendingMode;
  pendingMode = next;
  if (next === 'off') {
    // 鳴っている和音の余韻を残しつつ、0.6秒で消す
    if (bgm) {
      const now = ctx.currentTime;
      bgm.gain.cancelScheduledValues(now);
      bgm.gain.setValueAtTime(bgm.gain.value, now);
      bgm.gain.linearRampToValueAtTime(0, now + 0.6);
    }
    if (mode === 'off') stopBgm();
    return;
  }

  if (!bgm) {
    bgm = ctx.createGain();
    bgm.connect(ctx.destination);
  }
  const now = ctx.currentTime;
  bgm.gain.cancelScheduledValues(now);
  bgm.gain.setValueAtTime(bgm.gain.value, now);
  bgm.gain.linearRampToValueAtTime(BGM_GAIN[next], now + 0.3);

  // 通常 ⇄ チャレンジ を跨いだときだけ合図を鳴らす
  if (prev !== 'off' && prev !== next) stinger(next === 'challenge');

  if (mode !== 'off') return;
  mode = next;
  step = 0;
  nextAt = now + 0.08;
  window.clearInterval(timer);
  timer = window.setInterval(schedule, 90);
  schedule();
}

export function stopBgm(): void {
  window.clearInterval(timer);
  timer = 0;
  mode = 'off';
  pendingMode = 'off';
  step = 0;
}

export function bgmMode(): BgmMode {
  return mode;
}
