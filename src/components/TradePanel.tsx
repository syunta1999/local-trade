import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { useTrading } from '../hooks/useTrading';
import { buildBook } from '../lib/book';
import { formatClock } from '../lib/csv';
import { downloadCsv, tradesToCsv } from '../lib/csvfile';
import { computePnl, LOT, orderLabel, type OrderSide } from '../lib/trading';
import { useHints, type HintText } from './Hint';

/** 板に出す気配の本数（現在値を中心に上下） */
const ROWS = 17;

/** 上段のボタンの解説。カーソルを0.5秒重ねると出る */
const HINTS: Record<string, HintText> = {
  challenge: {
    title: 'チャレンジ — 記録のスイッチ',
    body: '押している間の売買が1回分の練習としてまとめて記録されます。終えると自動で保存され、勝率や期待値はこの記録から計算されます。押していない間の売買は残りません。',
  },
  analyze: {
    title: '分析 — 今回の成績表',
    body: '記録中のチャレンジを集計して表示します。勝率・平均利益と平均損失・逆行の大きさ・時間帯ごとの成績など。記録の途中でも押せます。',
  },
  overall: {
    title: '総合 — これまで全部の成績',
    body: '過去のチャレンジをすべて合わせて集計します。傾向を見るならこちら。チャレンジ単位で削除もできます。',
  },
  rules: {
    title: 'ルール — 自分との約束',
    body: '「損切りは20円まで」「1日5回まで」のように決めておくと、破った瞬間にその行が赤く点滅して音が鳴ります。枠は動かせてサイズも変えられます。',
  },
  ghost: {
    title: 'ゴースト — 前回の自分',
    body: '同じCSVでの前回のトレードを、買った場所・売った場所の矢印としてチャートに重ねます。「前回はここで飛び付いた」を見ながら判断できます。',
  },
  daily: {
    title: 'お題 — 今日の目標',
    body: '日替わりの課題が右下に出ます。利益目標・勝率・大負けしない、など。達成すると緑になります。同じ日なら何度開いても同じお題です。',
  },
  limit: {
    title: '指値注文 — 値段を打ち込んで発注',
    body: '板をダブルクリックする代わりに、売買・新規/返済・値段・株数を入力して注文できる小窓が開きます。出している注文の一覧と取消もここでできます。窓は見出しを掴んで移動、右下で大きさ変更、「—」で帯に畳めます。',
  },
  stop: {
    title: '逆指値・利確 — 損切りと利確を自動で置く',
    body: 'オンにしている間は、板・指値注文どちらから出した新規注文にも自動の返済が付きます。損切りは建値から幅ぶん不利な側の逆指値（触れたらそのときの値段で返済）、利確は有利な側の指値です。損と益は別々にオンにできます。',
  },
  match: {
    title: '対戦 — botと同じ相場で競う',
    body: '逆張り・ブレイク・スキャルの3体と、同じ歩み値・同じ約定ルールで損益を競います。botは先読みできず、値段も動かせません。botの未約定の注文は板の端に色の点で出ます。どのbotに負けたかで、その日がどんな相場だったかが分かります。',
  },
};

const nf = new Intl.NumberFormat('ja-JP');
const money = (n: number) => `${n > 0 ? '+' : ''}${nf.format(Math.round(n))}`;
const tone = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

type Props = {
  trading: ReturnType<typeof useTrading>;
  /** 現在値 */
  last: number;
  /** 呼値の刻み */
  tickSize: number;
  /** セッション内の現在時刻(秒) */
  clock: number;
  symbol: string | null;
  dateLabel: string;
  disabled: boolean;
  /** チャレンジ（記録）の状態。null なら未開始 */
  challenge: { recording: boolean; trades: number; seeks: number } | null;
  onToggleChallenge: () => void;
  onAnalyze: () => void;
  onOverall: () => void;
  toggles: {
    rules: boolean;
    ghost: boolean;
    daily: boolean;
    match: boolean;
    limit: boolean;
    stop: boolean;
  };
  onToggleView: (k: 'rules' | 'ghost' | 'daily' | 'match' | 'limit' | 'stop') => void;
  /** 前回のトレードが何件あるか。0ならゴーストは出せない */
  ghostCount: number;
  /** 対戦botが板に出している注文 */
  botOrders: { price: number; side: OrderSide; qty: number; color: string; name: string }[];
  matchOn: boolean;
};

export function TradePanel({
  trading,
  last,
  tickSize,
  clock,
  symbol,
  dateLabel,
  disabled,
  challenge,
  onToggleChallenge,
  onAnalyze,
  onOverall,
  toggles,
  onToggleView,
  ghostCount,
  botOrders,
  matchOn,
}: Props) {
  const { long, short, orders, trades, mode, lot, flash, stopCfg } = trading;
  const pnl = useMemo(
    () => computePnl({ long, short, realized: trading.realized }, last),
    [long, short, trading.realized, last],
  );

  /**
   * 板を1回クリックすると、その時点の値段で板を止める。
   * 止めないとダブルクリックの2回目までに行が動いて別の値段に発注してしまう。
   * 発注するか、板の外をクリックすると解除する。
   */
  const [frozen, setFrozen] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const freeze = useCallback(() => {
    // 2回目のクリックで固定し直すと、その間の値動きで板がずれてしまう
    setFrozen((cur) => (cur === null ? last : cur));
  }, [last]);

  useEffect(() => {
    if (frozen === null) return;
    const onDown = (e: PointerEvent) => {
      if (bodyRef.current?.contains(e.target as Node)) return;
      setFrozen(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [frozen]);

  // 固定中でなければ現在値が中央。現在値の行は画面上で動かない
  const rows = buildBook(last, frozen ?? last, tickSize, ROWS, Math.floor(clock));

  /**
   * 値段ごとの注文を引けるようにまとめる。指値と逆指値は別のチップにするので別々に持つ。
   * armed は「逆指値付きの新規」が混ざっているか（チップに印を付ける）
   */
  type Cell = { qty: number; ids: number[]; kind: string; armed: boolean };
  const bySide = new Map<string, Cell>();
  const stopAt = new Map<string, Cell>();
  for (const o of orders) {
    const key = `${o.side}@${o.price}`;
    const m = o.type === 'stop' ? stopAt : bySide;
    const e = m.get(key) ?? { qty: 0, ids: [], kind: o.kind, armed: false };
    e.qty += o.qty;
    e.ids.push(o.id);
    if (o.stop !== undefined || o.profit !== undefined) e.armed = true;
    m.set(key, e);
  }

  const order = (side: OrderSide, price: number) => {
    setFrozen(null);
    if (disabled) return;
    trading.place(side, price, Math.floor(clock));
  };

  const cancelAt = (side: OrderSide, price: number, stop = false) => {
    const e = (stop ? stopAt : bySide).get(`${side}@${price}`);
    if (!e) return;
    for (const id of e.ids) trading.cancel(id);
  };

  const onSave = () => {
    if (trades.length === 0) return;
    const name = `trades-${symbol ?? 'unknown'}-${dateLabel.replace(/-/g, '')}.csv`;
    downloadCsv(tradesToCsv(trades, symbol, dateLabel), name);
  };

  // 値段が走って板の外へ出た注文。見えないと取り消せないので別枠で出す
  const visible = new Set(rows.map((r) => r.price));
  const offBoard = orders.filter((o) => !visible.has(o.price));
  // botの利確の指値は現在値から離れたところに置かれるので、板には映らないことが多い。
  // どこで待ち構えているかが見えないと対戦にならないので、ここに出す
  const offBots = botOrders.filter((o) => !visible.has(o.price));

  // 一括取消の対象件数。板の外に出た注文も含める
  /** 値段ごとにbotの注文をまとめておく。板の行から引くだけにする */
  const botAt = useMemo(() => {
    const m = new Map<number, { color: string; name: string; side: OrderSide }[]>();
    for (const o of botOrders) {
      const key = o.price;
      const list = m.get(key);
      if (list) list.push(o);
      else m.set(key, [o]);
    }
    return m;
  }, [botOrders]);

  const sellCount = orders.filter((o) => o.side === 'sell').length;
  const buyCount = orders.filter((o) => o.side === 'buy').length;

  const recording = challenge?.recording ?? false;
  // 前回の記録が無いときは、押しても何も起きない理由を書き足す
  const hints = useMemo(
    () =>
      ghostCount
        ? HINTS
        : {
            ...HINTS,
            ghost: {
              ...HINTS.ghost,
              body: (
                <>
                  {HINTS.ghost.body}
                  <br />
                  このCSVでの前回の記録がまだ無いので、いまは重ねるものがありません。
                </>
              ),
            },
          },
    [ghostCount],
  );
  const hint = useHints(hints);

  return (
    <aside className="trade">
      <div className="ch">
        <button
          type="button"
          className={`ch-btn${recording ? ' on' : ''}`}
          onClick={onToggleChallenge}
          disabled={disabled}
          {...hint.bind('challenge')}
        >
          <span className="ch-dot" />
          {recording ? '記録中' : 'チャレンジ'}
          {challenge && challenge.trades > 0 && <em>{challenge.trades}</em>}
        </button>
        <button
          type="button"
          className="mini"
          onClick={onAnalyze}
          disabled={!challenge}
          {...hint.bind('analyze')}
        >
          分析
        </button>
        <button
          type="button"
          className="mini"
          onClick={onOverall}
          {...hint.bind('overall')}
        >
          総合
        </button>
      </div>

      <div className="ch sub">
        <button
          type="button"
          className={`mini${toggles.rules ? ' on' : ''}`}
          onClick={() => onToggleView('rules')}
          {...hint.bind('rules')}
        >
          ルール
        </button>
        <button
          type="button"
          className={`mini${toggles.ghost ? ' on' : ''}`}
          onClick={() => onToggleView('ghost')}
          {...hint.bind('ghost')}
        >
          ゴースト{ghostCount ? ` ${ghostCount}` : ''}
        </button>
        <button
          type="button"
          className={`mini${toggles.daily ? ' on' : ''}`}
          onClick={() => onToggleView('daily')}
          {...hint.bind('daily')}
        >
          お題
        </button>
        <button
          type="button"
          className={`mini${toggles.match ? ' on' : ''}${matchOn ? ' live' : ''}`}
          onClick={() => onToggleView('match')}
          {...hint.bind('match')}
        >
          対戦{matchOn ? ' ●' : ''}
        </button>
      </div>

      {hint.node}

      <div className="pl">
        <div className="pl-row">
          <PlCell label="評価損益" value={pnl.unrealized} />
          <PlCell label="確定損益" value={pnl.realized} />
        </div>
        <div className="pl-total">
          <span>合計</span>
          <strong className={tone(pnl.total)}>{money(pnl.total)}</strong>
        </div>
      </div>

      <div className="holds">
        <div className={`hold buy${long.qty ? ' on' : ''}`}>
          <span className="hold-k">買建</span>
          <span className="hold-q">{long.qty ? `${nf.format(long.qty)}株` : '—'}</span>
          <span className="hold-a">{long.qty ? `@${nf.format(Math.round(long.avg))}` : ''}</span>
          <span className={`hold-p ${tone(pnl.long)}`}>{long.qty ? money(pnl.long) : ''}</span>
        </div>
        <div className={`hold sell${short.qty ? ' on' : ''}`}>
          <span className="hold-k">売建</span>
          <span className="hold-q">{short.qty ? `${nf.format(short.qty)}株` : '—'}</span>
          <span className="hold-a">{short.qty ? `@${nf.format(Math.round(short.avg))}` : ''}</span>
          <span className={`hold-p ${tone(pnl.short)}`}>{short.qty ? money(pnl.short) : ''}</span>
        </div>
      </div>

      <div className="trade-ctl">
        <div className="seg" role="group" aria-label="注文の種類">
          <button
            type="button"
            className={`seg-btn${mode === 'open' ? ' on' : ''}`}
            onClick={() => trading.setMode('open')}
            disabled={disabled}
          >
            新規
          </button>
          <button
            type="button"
            className={`seg-btn${mode === 'close' ? ' on' : ''}`}
            onClick={() => trading.setMode('close')}
            disabled={disabled}
          >
            返済
          </button>
        </div>

        <div className="lot">
          <button
            type="button"
            className="lot-btn"
            onClick={() => trading.changeLot(lot - LOT)}
            disabled={disabled || lot <= LOT}
            title="100株減らす"
          >
            ▼
          </button>
          <input
            type="number"
            step={LOT}
            min={LOT}
            value={lot}
            onChange={(e) => trading.changeLot(Number(e.target.value))}
            disabled={disabled}
            aria-label="ロット(株)"
          />
          <button
            type="button"
            className="lot-btn"
            onClick={() => trading.changeLot(lot + LOT)}
            disabled={disabled}
            title="100株増やす"
          >
            ▲
          </button>
        </div>
      </div>

      <div className="bk">
        <div className="bk-tools">
          <button
            type="button"
            className={`ordbtn${toggles.limit ? ' on' : ''}`}
            onClick={() => onToggleView('limit')}
            disabled={disabled}
            {...hint.bind('limit')}
          >
            指値注文
          </button>
          <button
            type="button"
            className={`ordbtn${toggles.stop ? ' on' : ''}${stopCfg.on || stopCfg.profitOn ? ' live' : ''}`}
            onClick={() => onToggleView('stop')}
            disabled={disabled}
            {...hint.bind('stop')}
          >
            逆指値
            {(stopCfg.on || stopCfg.profitOn) &&
              ` ${[
                stopCfg.on ? `損${nf.format(stopCfg.width)}` : '',
                stopCfg.profitOn ? `益${nf.format(stopCfg.profitWidth)}` : '',
              ]
                .filter(Boolean)
                .join('/')}`}
          </button>
          <button
            type="button"
            className="bulk sell"
            onClick={() => trading.cancelBySide('sell')}
            disabled={sellCount === 0}
            title="売り注文（新規・返済・逆指値とも）をすべて取り消す"
          >
            一括取消{sellCount ? ` ${sellCount}` : ''}
          </button>
          <button
            type="button"
            className="bulk buy"
            onClick={() => trading.cancelBySide('buy')}
            disabled={buyCount === 0}
            title="買い注文（新規・返済・逆指値とも）をすべて取り消す"
          >
            一括取消{buyCount ? ` ${buyCount}` : ''}
          </button>
        </div>
        <div className="bk-head">
          <span>注文</span>
          <span>売気配</span>
          <span className={frozen === null ? '' : 'frozen'}>
            {frozen === null ? '値段' : '固定中'}
          </span>
          <span>買気配</span>
          <span>注文</span>
        </div>
        <div
          className={`bk-body${frozen === null ? '' : ' frozen'}`}
          ref={bodyRef}
          onPointerDown={freeze}
        >
          {rows.map((r) => {
            const sellOrder = bySide.get(`sell@${r.price}`);
            const buyOrder = bySide.get(`buy@${r.price}`);
            const sellStop = stopAt.get(`sell@${r.price}`);
            const buyStop = stopAt.get(`buy@${r.price}`);
            const hit = flash && flash.price === r.price ? ` flash-${flash.side}` : '';
            const bots = botAt.get(r.price);
            return (
              <div key={r.price} className={`bk-row${r.isLast ? ' last' : ''}${hit}`}>
                {(['sell', 'buy'] as const).map((s) => {
                  const mine = bots?.filter((b) => b.side === s) ?? [];
                  if (mine.length === 0) return null;
                  return (
                    <span key={s} className={`bk-bot ${s}`}>
                      {mine.map((b) => (
                        <i
                          key={b.name}
                          style={{ background: b.color }}
                          title={`${b.name}の${s === 'buy' ? '買い' : '売り'}注文 ${nf.format(r.price)}`}
                        />
                      ))}
                    </span>
                  );
                })}
                <button
                  type="button"
                  className="bk-hit sell"
                  onDoubleClick={() => order('sell', r.price)}
                  disabled={disabled}
                  tabIndex={-1}
                  aria-label={`${r.price}円で売り注文`}
                  title={`ダブルクリックで ${mode === 'open' ? '売り新規' : '買建の返済'} ${nf.format(r.price)}`}
                />
                <button
                  type="button"
                  className="bk-hit buy"
                  onDoubleClick={() => order('buy', r.price)}
                  disabled={disabled}
                  tabIndex={-1}
                  aria-label={`${r.price}円で買い注文`}
                  title={`ダブルクリックで ${mode === 'open' ? '買い新規' : '売建の返済'} ${nf.format(r.price)}`}
                />
                <span className="bk-ord sell">
                  {sellOrder && (
                    <button
                      type="button"
                      className={`chip ${sellOrder.kind}${sellOrder.armed ? ' armed' : ''}`}
                      onClick={() => cancelAt('sell', r.price)}
                      title={`${nf.format(sellOrder.qty)}株の${sellOrder.kind === 'open' ? '新規売り' : '買建の返済'}${sellOrder.armed ? '（損切り・利確付き）' : ''} — クリックで取消`}
                    >
                      {nf.format(sellOrder.qty)}
                    </button>
                  )}
                  {sellStop && (
                    <button
                      type="button"
                      className="chip stop"
                      onClick={() => cancelAt('sell', r.price, true)}
                      title={`逆指値 ${nf.format(sellStop.qty)}株の買建の返済（${nf.format(r.price)}以下で発動） — クリックで取消`}
                    >
                      {nf.format(sellStop.qty)}
                    </button>
                  )}
                </span>
                <span className="bk-ask">{r.ask ? nf.format(r.ask) : ''}</span>
                <span className="bk-price">{nf.format(r.price)}</span>
                <span className="bk-bid">{r.bid ? nf.format(r.bid) : ''}</span>
                <span className="bk-ord buy">
                  {buyOrder && (
                    <button
                      type="button"
                      className={`chip ${buyOrder.kind}${buyOrder.armed ? ' armed' : ''}`}
                      onClick={() => cancelAt('buy', r.price)}
                      title={`${nf.format(buyOrder.qty)}株の${buyOrder.kind === 'open' ? '新規買い' : '売建の返済'}${buyOrder.armed ? '（損切り・利確付き）' : ''} — クリックで取消`}
                    >
                      {nf.format(buyOrder.qty)}
                    </button>
                  )}
                  {buyStop && (
                    <button
                      type="button"
                      className="chip stop"
                      onClick={() => cancelAt('buy', r.price, true)}
                      title={`逆指値 ${nf.format(buyStop.qty)}株の売建の返済（${nf.format(r.price)}以上で発動） — クリックで取消`}
                    >
                      {nf.format(buyStop.qty)}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {offBots.length > 0 && (
        <div className="off-board bots" title="botが板の外に置いている注文">
          <span>botの待ち</span>
          {offBots.map((o) => (
            <span
              key={`${o.name}-${o.side}-${o.price}`}
              className="bot-chip"
              style={{ borderColor: o.color, color: o.color }}
              title={`${o.name}の${o.side === 'buy' ? '買い' : '売り'}注文 ${nf.format(o.price)}円 ${nf.format(o.qty)}株`}
            >
              {nf.format(o.price)}
              {o.side === 'buy' ? '買' : '売'}
            </span>
          ))}
        </div>
      )}

      {offBoard.length > 0 && (
        <div className="off-board" title="現在値から離れて板に映らなくなった注文">
          <span>板外の注文</span>
          {offBoard.map((o) => (
            <button
              type="button"
              key={o.id}
              className={`chip ${o.type === 'stop' ? 'stop' : o.kind}${o.stop !== undefined || o.profit !== undefined ? ' armed' : ''}`}
              onClick={() => trading.cancel(o.id)}
              title={`${orderLabel(o)}${o.stop !== undefined ? ` 損切り ${nf.format(o.stop)}` : ''}${o.profit !== undefined ? ` 利確 ${nf.format(o.profit)}` : ''} — クリックで取消`}
            >
              {nf.format(o.price)}
              {o.side === 'buy' ? '買' : '売'}
              {o.type === 'stop' ? '逆' : o.kind === 'close' && o.from !== undefined ? '利' : ''}
            </button>
          ))}
        </div>
      )}

      {trading.message && <div className="trade-msg">{trading.message}</div>}

      <div className="hist">
        <div className="hist-head">
          <span>取引履歴 {trades.length}件</span>
          <strong className={tone(pnl.realized)} title="取引履歴の損益合計">
            {trades.length ? money(pnl.realized) : ''}
          </strong>
          <button
            type="button"
            className="mini"
            onClick={onSave}
            disabled={trades.length === 0}
            title="取引履歴をCSVで保存"
          >
            CSV
          </button>
        </div>
        <div className="hist-body">
          {trades.length === 0 ? (
            <div className="hist-empty">板をダブルクリックで発注</div>
          ) : (
            [...trades].reverse().map((t) => (
              <div
                key={t.id}
                className="hist-row"
                title={`${formatClock(t.entryAt)} 建 → ${formatClock(t.exitAt)} 返済`}
              >
                <span className={`hist-side ${t.side === 'long' ? 'buy' : 'sell'}`}>
                  {t.side === 'long' ? '買' : '売'}
                </span>
                <span className="hist-q">{nf.format(t.qty)}</span>
                <span className="hist-px">
                  {nf.format(Math.round(t.entry))}→{nf.format(Math.round(t.exit))}
                  {t.exitBy === 'stop' && (
                    <i className="hist-stop" title="逆指値（損切り）で返済">
                      逆
                    </i>
                  )}
                  {t.exitBy === 'profit' && (
                    <i className="hist-stop tp" title="自動の利確で返済">
                      利
                    </i>
                  )}
                </span>
                <span className={`hist-p ${tone(t.pnl)}`}>{money(t.pnl)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

function PlCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="pl-cell">
      <span className="pl-label">{label}</span>
      <span className={`pl-value ${tone(value)}`}>{money(value)}</span>
    </div>
  );
}
