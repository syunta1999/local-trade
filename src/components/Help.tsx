import { useState } from 'react';

/**
 * 機能の説明。株を触ったことがない人でも分かるよう、
 * 文字より図で説明する。図はすべてインラインSVGで外部画像を持たない。
 */

const UP = '#ef5350';
const DOWN = '#42a5f5';
const LINE = '#4a5361';
const TXT = '#c9d1d9';
const DIM = '#7d8590';

// ---- 図 --------------------------------------------------------------------

/** ローソク足の読み方 */
function CandleArt() {
  return (
    <svg className="art" viewBox="0 0 300 150" role="img" aria-label="ローソク足の読み方">
      {/* 下げ（青） */}
      <line x1="34" y1="30" x2="34" y2="116" stroke={DOWN} strokeWidth="1.5" />
      <rect x="22" y="52" width="24" height="46" fill={DOWN} />
      <text x="34" y="140" fill={DOWN} fontSize="9" textAnchor="middle">下がった（青）</text>
      {/* 上げ（赤） */}
      <line x1="108" y1="16" x2="108" y2="122" stroke={UP} strokeWidth="1.5" />
      <rect x="96" y="46" width="24" height="52" fill={UP} />
      <text x="108" y="140" fill={UP} fontSize="9" textAnchor="middle">上がった（赤）</text>
      {/* 引き出し線（赤いローソクを指す） */}
      <line x1="108" y1="16" x2="150" y2="16" stroke={LINE} strokeDasharray="2 2" />
      <text x="155" y="19" fill={DIM} fontSize="9">高値 いちばん高かった値段</text>
      <line x1="120" y1="46" x2="150" y2="46" stroke={LINE} strokeDasharray="2 2" />
      <text x="155" y="49" fill={TXT} fontSize="9">終値 期間の終わりの値段</text>
      <line x1="120" y1="98" x2="150" y2="98" stroke={LINE} strokeDasharray="2 2" />
      <text x="155" y="101" fill={TXT} fontSize="9">始値 期間のはじめの値段</text>
      <line x1="108" y1="122" x2="150" y2="122" stroke={LINE} strokeDasharray="2 2" />
      <text x="155" y="125" fill={DIM} fontSize="9">安値 いちばん安かった値段</text>
    </svg>
  );
}

/** 板の見方と発注 */
function BoardArt() {
  const rows = [
    { p: '2,671', ask: '1,600', bid: '' },
    { p: '2,670', ask: '900', bid: '' },
    { p: '2,669', ask: '', bid: '', now: true },
    { p: '2,668', ask: '', bid: '1,100' },
    { p: '2,667', ask: '', bid: '2,500' },
  ];
  return (
    <svg className="art" viewBox="0 0 310 150" role="img" aria-label="板の見方">
      <text x="52" y="10" fill={DOWN} fontSize="9" textAnchor="middle">売りたい人</text>
      <text x="130" y="10" fill={DIM} fontSize="9" textAnchor="middle">値段</text>
      <text x="208" y="10" fill={UP} fontSize="9" textAnchor="middle">買いたい人</text>
      {rows.map((r, i) => {
        const y = 18 + i * 20;
        return (
          <g key={r.p}>
            {r.now && <rect x="14" y={y} width="232" height="18" fill="#1b222d" stroke="#f0b429" />}
            {r.ask && <rect x="14" y={y} width="76" height="18" fill="rgba(66,165,245,0.18)" />}
            {r.bid && <rect x="170" y={y} width="76" height="18" fill="rgba(239,83,80,0.18)" />}
            <text x="84" y={y + 13} fill="#a8d5ff" fontSize="9" textAnchor="end">{r.ask}</text>
            <text x="130" y={y + 13} fill={r.now ? '#f0b429' : TXT} fontSize="9" textAnchor="middle" fontWeight={r.now ? 700 : 400}>{r.p}</text>
            <text x="176" y={y + 13} fill="#ffb3b1" fontSize="9">{r.bid}</text>
            {r.now && <text x="252" y={y + 13} fill="#f0b429" fontSize="9">← いまの値段</text>}
          </g>
        );
      })}
      <text x="14" y="134" fill={DOWN} fontSize="9">◀ 左半分をダブルクリック → 売り注文</text>
      <text x="246" y="146" fill={UP} fontSize="9" textAnchor="end">右半分をダブルクリック → 買い注文 ▶</text>
    </svg>
  );
}

/** ロングとショート */
function SideArt() {
  return (
    <svg className="art" viewBox="0 0 300 180" role="img" aria-label="ロングとショート">
      {/* 買い（ロング） */}
      <text x="8" y="12" fill={UP} fontSize="10" fontWeight="700">買い（ロング）上がると儲かる</text>
      <line x1="24" y1="62" x2="128" y2="28" stroke={UP} strokeWidth="1.5" />
      <circle cx="24" cy="62" r="4" fill={UP} />
      <circle cx="128" cy="28" r="4" fill={UP} />
      <text x="10" y="78" fill={TXT} fontSize="8">① 安く買う</text>
      <text x="136" y="30" fill={TXT} fontSize="8">② 高く売る</text>
      <text x="136" y="48" fill={DIM} fontSize="8">この差額が利益になる</text>

      <line x1="8" y1="92" x2="292" y2="92" stroke={LINE} strokeDasharray="3 3" />

      {/* 売り（ショート） */}
      <text x="8" y="110" fill={DOWN} fontSize="10" fontWeight="700">売り（ショート）下がると儲かる</text>
      <line x1="24" y1="130" x2="128" y2="164" stroke={DOWN} strokeWidth="1.5" />
      <circle cx="24" cy="130" r="4" fill={DOWN} />
      <circle cx="128" cy="164" r="4" fill={DOWN} />
      <text x="10" y="124" fill={TXT} fontSize="8">① 高く売る</text>
      <text x="136" y="166" fill={TXT} fontSize="8">② 安く買い戻す</text>
      <text x="136" y="136" fill={DIM} fontSize="8">持っていない株を先に売って、</text>
      <text x="136" y="148" fill={DIM} fontSize="8">あとで買い戻す</text>
    </svg>
  );
}

/** 建玉と損益 */
function PnlArt() {
  return (
    <svg className="art" viewBox="0 0 260 110" role="img" aria-label="評価損益と確定損益">
      <line x1="16" y1="70" x2="244" y2="70" stroke={LINE} />
      <circle cx="50" cy="70" r="5" fill={UP} />
      <text x="50" y="88" fill={TXT} fontSize="9" textAnchor="middle">新規</text>
      <text x="50" y="99" fill={DIM} fontSize="8" textAnchor="middle">買う / 売る</text>
      <circle cx="210" cy="70" r="5" fill={DIM} />
      <text x="210" y="88" fill={TXT} fontSize="9" textAnchor="middle">返済</text>
      <text x="210" y="99" fill={DIM} fontSize="8" textAnchor="middle">反対売買で閉じる</text>
      <path d="M55 70 L205 70" stroke="#f0b429" strokeWidth="3" />
      <text x="130" y="60" fill="#f0b429" fontSize="9" textAnchor="middle">建玉を持っている間</text>
      <text x="130" y="46" fill={TXT} fontSize="9" textAnchor="middle">値段が動くたび変わる = 評価損益</text>
      <text x="130" y="26" fill={TXT} fontSize="9" textAnchor="middle">返済した瞬間に金額が決まる = 確定損益</text>
      <line x1="210" y1="34" x2="210" y2="64" stroke={LINE} strokeDasharray="2 2" />
    </svg>
  );
}

/** 移動平均線 */
function MaArt() {
  return (
    <svg className="art small" viewBox="0 0 260 80" role="img" aria-label="移動平均線">
      <polyline points="10,60 30,40 50,55 70,30 90,45 110,25 130,38 150,18 170,32 190,14 210,28 230,10 250,22"
        fill="none" stroke={DIM} strokeWidth="1" />
      <polyline points="10,58 50,50 90,42 130,34 170,26 210,20 250,16"
        fill="none" stroke="#06d6a0" strokeWidth="2" />
      <text x="10" y="76" fill="#06d6a0" fontSize="9">なめらかな線＝移動平均線（直近◯本の終値の平均）</text>
      <text x="10" y="14" fill={DIM} fontSize="9">ギザギザ＝実際の値動き</text>
    </svg>
  );
}

/** ボリンジャーバンド */
function BbArt() {
  return (
    <svg className="art small" viewBox="0 0 260 80" role="img" aria-label="ボリンジャーバンド">
      <polyline points="10,26 60,16 110,22 160,12 210,20 250,10" fill="none" stroke="#dfe6f0" strokeWidth="1.2" />
      <polyline points="10,62 60,56 110,60 160,52 210,58 250,50" fill="none" stroke="#dfe6f0" strokeWidth="1.2" />
      <polyline points="10,44 60,36 110,41 160,32 210,39 250,30" fill="none" stroke="#6f7a8a" strokeWidth="1" strokeDasharray="3 3" />
      <polyline points="10,46 30,30 50,50 70,34 90,52 110,38 130,44 150,30 170,48 190,36 210,50 230,34 250,40"
        fill="none" stroke={DIM} strokeWidth="1" />
      <text x="10" y="76" fill="#dfe6f0" fontSize="9">値段はだいたいこの帯の中に収まる。外れたら行きすぎのサイン</text>
    </svg>
  );
}

/** 3体のbotが強い場面 */
function MatchArt() {
  const panels = [
    {
      x: 0,
      title: 'ヨコに行ったり来たり',
      // レンジ。上下の帯の中で往復する
      path: '12,52 22,34 32,66 42,36 52,64 62,38 72,62 82,40',
      bot: '逆張り',
      color: '#5ec8e5',
    },
    {
      x: 100,
      title: '一方向に伸びる',
      // トレンド。段を作りながら上がる
      path: '12,72 24,68 34,54 46,50 56,38 68,34 78,22 88,18',
      bot: 'ブレイク',
      color: '#f0b429',
    },
    {
      x: 200,
      title: '細かく激しく動く',
      // 出来高が多い。刻みが細かい
      path: '12,50 18,42 24,54 30,44 36,56 42,46 48,58 54,48 60,60 66,50 72,62 78,52 84,64',
      bot: 'スキャル',
      color: '#c792ea',
    },
  ];
  return (
    <svg className="art" viewBox="0 0 300 118" role="img" aria-label="どのbotがどんな相場で強いか">
      {panels.map((p) => (
        <g key={p.bot} transform={`translate(${p.x},0)`}>
          <text x="50" y="11" fill={DIM} fontSize="9" textAnchor="middle">
            {p.title}
          </text>
          <rect x="8" y="16" width="84" height="62" rx="3" fill="#11161e" stroke={DIM} strokeWidth="0.5" />
          <polyline
            points={p.path.replace(/,(\d+)/g, (_m, y) => `,${Number(y) + 8}`)}
            fill="none"
            stroke={p.color}
            strokeWidth="1.6"
          />
          <circle cx="20" cy="96" r="4" fill={p.color} />
          <text x="30" y="99" fill={p.color} fontSize="10" fontWeight="700">
            {p.bot}
          </text>
          <text x="8" y="113" fill={DIM} fontSize="8">
            が強い場面
          </text>
        </g>
      ))}
    </svg>
  );
}

/** RSI */
function RsiArt() {
  return (
    <svg className="art small" viewBox="0 0 260 80" role="img" aria-label="RSI">
      <rect x="10" y="8" width="240" height="52" fill="#10151d" stroke={LINE} />
      <line x1="10" y1="22" x2="250" y2="22" stroke={LINE} strokeDasharray="3 3" />
      <line x1="10" y1="46" x2="250" y2="46" stroke={LINE} strokeDasharray="3 3" />
      <text x="254" y="25" fill={UP} fontSize="8">70 買われすぎ</text>
      <text x="254" y="49" fill={DOWN} fontSize="8">30 売られすぎ</text>
      <polyline points="14,44 44,30 74,18 104,26 134,40 164,50 194,38 224,24 248,32"
        fill="none" stroke="#ffb74d" strokeWidth="1.6" />
      <text x="10" y="74" fill={DIM} fontSize="9">0〜100 で「買われすぎ / 売られすぎ」を測る</text>
    </svg>
  );
}

// ---- 中身 ------------------------------------------------------------------

type Item = { title: string; art?: React.ReactNode; body: React.ReactNode };
type Tab = { name: string; items: Item[] };

const TABS: Tab[] = [
  {
    name: '画面の見かた',
    items: [
      {
        title: 'ローソク足',
        art: <CandleArt />,
        body: (
          <>
            <p>一定時間の値動きを1本にまとめた図です。太い部分は始まりと終わりの値段、上下のヒゲはその間に付いた最高値と最安値を表します。</p>
            <p>日本では<b>上がったら赤、下がったら青</b>です（海外は逆のことが多い）。下部の「足」で1本の長さを1秒〜5分に変えられます。</p>
          </>
        ),
      },
      {
        title: '歩み値（右のリスト）',
        body: (
          <>
            <p>売買が成立した記録が1件ずつ流れます。<b>これがこのアプリの元データ</b>で、ローソク足も板もここから作っています。</p>
            <p>直前より高く成立したら赤、安ければ青。大口（既定は5,000株以上）の株数は色を変えて目立たせています。</p>
            <p>見出しの「歩み値 ✕」を押すと閉じられます。<b>閉じたぶんだけ板が広がる</b>ので、板だけ見たいときはたたんでおくと押しやすくなります。右端に残る細い帯を押せば戻ります。</p>
          </>
        ),
      },
      {
        title: '板（気配値）',
        art: <BoardArt />,
        body: (
          <>
            <p>「いくらで何株買いたい／売りたい人がいるか」の一覧です。真ん中が値段、左が売りたい人、右が買いたい人。</p>
            <p className="warn">
              ※ 元のCSVには板の情報が入っていないので、<b>数量はこのアプリが作った架空の数字</b>です。値段の刻みだけは実データから割り出しています。
            </p>
          </>
        ),
      },
    ],
  },
  {
    name: '売買のしかた',
    items: [
      {
        title: '買いと売り',
        art: <SideArt />,
        body: (
          <>
            <p>安く買って高く売れば儲かります（買い＝ロング）。逆に、<b>持っていない株を先に売って、安くなってから買い戻す</b>こともできます（売り＝ショート）。下がる相場でも儲けられます。</p>
            <p>このアプリでは買いと売りを<b>同時に持てます</b>（両建て）。</p>
          </>
        ),
      },
      {
        title: '注文の出し方',
        body: (
          <>
            <p>板の行の<b>左半分をダブルクリックで売り注文</b>、<b>右半分で買い注文</b>です。</p>
            <p>板の上の「新規 / 返済」で意味が変わります。新規は建玉を作る注文、返済は持っている建玉を閉じる注文です。</p>
            <p>行を<b>1回クリックすると板が止まります</b>。値段が動いて狙いがずれないようにするためで、発注するか板の外を押すと解除されます。</p>
            <p>出した注文は板の両端にチップで出ます。クリックで1件取消、板の上の「一括取消」で片側まとめて取消です。</p>
          </>
        ),
      },
      {
        title: '約定するタイミング',
        body: (
          <>
            <p>このアプリの注文はすべて<b>指値</b>（値段を指定する注文）です。歩み値がその値段に触れたら成立します。</p>
            <p>買い注文は指定より<b>安い</b>値段が付いたとき、売り注文は<b>高い</b>値段が付いたときに成立します。いまの値段より有利でない側に置けば、その場ですぐ成立します。</p>
          </>
        ),
      },
      {
        title: '評価損益と確定損益',
        art: <PnlArt />,
        body: (
          <>
            <p><b>評価損益</b>は、まだ持っている建玉の「いま返済したらいくらか」。値段が動くたびに変わります。</p>
            <p><b>確定損益</b>は、返済して金額が決まったぶんの合計です。</p>
            <p className="warn">※ 手数料や金利は計算に入れていないので、実際よりよい数字が出ます。</p>
          </>
        ),
      },
    ],
  },
  {
    name: 'インジケーター',
    items: [
      {
        title: '移動平均線（MA）',
        art: <MaArt />,
        body: (
          <>
            <p>直近◯本ぶんの終値を平均してつないだ線です。ギザギザした値動きをならして、<b>大きな流れがどちらを向いているか</b>を見ます。</p>
            <p>本数のボタンで何本ぶんの平均かを選べます。数字が大きいほどゆっくり動き、長い流れを表します。</p>
          </>
        ),
      },
      {
        title: 'ボリンジャーバンド（BB）',
        art: <BbArt />,
        body: (
          <>
            <p>移動平均線の上下に「値動きのばらつき」ぶんの帯を描いたものです。値段はだいたいこの帯の中に収まります。</p>
            <p>1σ / 2σ / 3σ は帯の広さです。<b>2σなら約95%がこの中</b>に入る計算なので、外に出たら行きすぎと見ます。帯が狭いときは値動きが小さく、広がると荒れています。</p>
          </>
        ),
      },
      {
        title: 'RSI',
        art: <RsiArt />,
        body: (
          <>
            <p>直近の値動きのうち上げがどれだけを占めるかを0〜100で表します。<b>70より上は買われすぎ、30より下は売られすぎ</b>の目安です。</p>
            <p>価格とはスケールが違うので、チャートの下に専用の枠を開いて描いています。</p>
          </>
        ),
      },
    ],
  },
  {
    name: '練習機能',
    items: [
      {
        title: '再生とランダム再生',
        body: (
          <>
            <p>▶で再生、倍速は×1〜×300。⏭は1約定ずつ進めるコマ送りです。<b>⚙ 設定</b>の「昼休み」を入れると、昼休みなど売買の無い時間を飛ばします。</p>
            <p><b>🎲 ランダム再生</b>を押すと、値動きの多い9:00〜10:00のどこかから再生し直します。同じ場面を繰り返すと展開を覚えてしまうので、それを防ぐためのものです。</p>
            <p className="warn">※ 巻き戻すと建玉・注文・その回の履歴は破棄されます（先の値動きを知った状態では持ち越せないため）。</p>
          </>
        ),
      },
      {
        title: 'チャレンジ・分析・総合',
        body: (
          <>
            <p><b>チャレンジ</b>を押すと記録が始まります。トレードした内容が溜まり、もう一度押すと終了して保存されます。</p>
            <p><b>分析</b>は今回の成績、<b>総合</b>はこれまで全部をまとめた成績です。勝率や損益だけでなく、「どれだけ利益を取りこぼしたか」「負けを長く持っていないか」まで出ます。</p>
            <p>総合の画面からは、チャレンジ1回ぶんの記録を選んで削除できます。</p>
          </>
        ),
      },
      {
        title: 'マイルール',
        body: (
          <>
            <p>自分で決めたルールを登録しておくと、<b>破った瞬間に赤く点滅して警告音が鳴ります</b>。行をクリックすると点滅が消えます。</p>
            <p>注文自体は止めません。止めるためではなく「破ったと気づく」ためのものです。パネルはヘッダーを掴んで移動、右下をつまんで大きさを変えられます。</p>
          </>
        ),
      },
      {
        title: 'ゴースト',
        body: (
          <>
            <p>同じCSVで<b>前回やったときの自分のトレード</b>を、チャート上に薄いマーカーで重ねます。「前回はここで買っていた」を見ながら判断できます。</p>
            <p>レースゲームのゴーストと同じで、過去の自分と競うためのものです。</p>
          </>
        ),
      },
      {
        title: '対戦',
        art: <MatchArt />,
        body: (
          <>
            <p><b>3体のbotと、同じ相場で損益を競います。</b>難易度と時間（10 / 30 / 60分）を選んで「この場面から開始」を押すと始まります。時間が来たら、そのときの値段で全員を評価して順位が出ます。</p>
            <p>botはあなたと<b>まったく同じ約定ルール</b>で売買します。先読みはできず、値段も動かせません。違うのは判断だけです。ロットもあなたの設定に合わせます。</p>
            <p>難易度で変わるのは<b>反応の遅れ</b>です。むずかしいほど合図が出てから動くのが速くなります。ズルはしません。</p>
            <p>botの未約定の注文は、<b>板の端に色の点</b>で出ます。板の外で待っているものは板の下に一覧で出ます。どこで待ち構えているか見えるので、乗るか・逆を取るかを選べます。</p>
            <p>売買の中身は<b>「botの売買」パネル</b>に出ます。botごとに小さな<b>ローソク足</b>があり（足の種類はメインのチャートと同じ）、その上に<b>建てた値段から返した値段まで1本の線</b>が引かれます。赤が勝ち、青が負け、建玉中は破線です。下の一覧には <b>いくらで建てて、いくらで返して、1株あたり何円、合計何円</b> が並びます。</p>
            <p>スコアボードも売買パネルも<b>ヘッダーを掴んで移動、右下をつまんで大きさ変更</b>ができます。売買パネルは <b>—</b> を押すと細い帯まで畳めます。置き場所も畳んだ状態も次に開いたときに覚えています。</p>
            <p><b>どのbotに負けたかで、その日がどんな相場だったかが分かります。</b>結果の画面にその読み方が出ます。</p>
            <p className="warn">※ 巻き戻したりCSVを変えると、同じ条件で走っていないことになるので対戦は無効になります。</p>
          </>
        ),
      },
      {
        title: '3体のbotが何をしているか',
        body: (
          <>
            <p>3体とも、判断に使うのは<b>1分足</b>と<b>直近の歩み値</b>だけです。撤退・利確の幅は「直近14本の1分足の平均値幅」（＝そのときの荒さ）の倍数で決めます。値動きの大きさが違う銘柄でも同じ性格で動くようにするためです。</p>

            <h5 style={{ color: '#5ec8e5' }}>逆張り — 行きすぎたら戻ると考える</h5>
            <ul>
              <li><b>買う</b>：値段が<b>ボリンジャーバンド（10本・1.7σ）の下</b>に出たとき</li>
              <li><b>売る</b>：値段が<b>バンドの上</b>に出たとき</li>
              <li><b>注文の置き方</b>：合図から1.6秒待って、<b>いまの値段より1ティック有利な側</b>（買いなら1つ下、売りなら1つ上）に指値。行きすぎがもう一段進んだところで拾う形です</li>
              <li><b>利確</b>：バンドの中心（10本の平均）まで戻ったら。ただし平均値幅の2.2倍より遠いときは手前で切ります</li>
              <li><b>撤退</b>：平均値幅の0.8倍だけ逆行したら / 7分持ったら</li>
              <li><b>休み</b>：手仕舞い後30秒</li>
            </ul>

            <h5 style={{ color: '#f0b429' }}>ブレイク — 抜けたら付いていく</h5>
            <ul>
              <li><b>買う</b>：<b>直前6本（＝6分）の高値</b>を、平均値幅の0.2倍だけ上回ったとき</li>
              <li><b>売る</b>：同じく<b>6本の安値</b>を下回ったとき</li>
              <li><b>やらない</b>：その6本の値幅が平均値幅の2倍に満たないとき。狭い持ち合いの「抜け」はただのノイズなので手を出しません</li>
              <li><b>注文の置き方</b>：合図から1.2秒待って、<b>いまの値段より1ティック先</b>（買いなら1つ上）に指値。3体で唯一、追いかけて即座に約定させにいきます</li>
              <li><b>利確</b>：平均値幅の1.6倍</li>
              <li><b>撤退</b>：平均値幅の1.2倍だけ逆行したら / 5分持ったら</li>
              <li><b>休み</b>：手仕舞い後45秒</li>
            </ul>

            <h5 style={{ color: '#c792ea' }}>スキャル — 歩み値の偏りに乗る</h5>
            <ul>
              <li><b>買う</b>：直近240約定のうち、<b>値上がりで成立した株数が62%を超えた</b>とき</li>
              <li><b>売る</b>：同じく<b>38%を下回った</b>とき（値下がり側が62%超）</li>
              <li><b>やらない</b>：その240約定の合計が2,000株に満たないとき。薄いところの偏りは当てになりません</li>
              <li><b>注文の置き方</b>：合図から0.6秒待って、逆張りと同じく<b>1ティック有利な側</b>に指値</li>
              <li><b>利確</b>：平均値幅の0.3倍（数ティック）</li>
              <li><b>撤退</b>：平均値幅の0.4倍だけ逆行したら / 1分半持ったら</li>
              <li><b>休み</b>：手仕舞い後20秒</li>
            </ul>

            <p>注文を出しても値段が来なければ、<b>逆張りは25秒・ブレイクは15秒・スキャルは8秒</b>で引っ込めます。撤退するときは逆指値の代わりに、条件が続くあいだ<b>いまの値段に指値を置き直し続けます</b>。</p>
            <p>「〜秒待って」の部分が難易度です。<b>かんたんは2.4倍・むずかしいは0.4倍</b>になります。条件そのものは変わりません。</p>
          </>
        ),
      },
      {
        title: '今日のお題',
        body: (
          <>
            <p>日替わりの目標です。同じ日なら何度開いても同じ内容が出ます。達成するとカードが緑になります。</p>
            <p>「+15,000円を稼ぐ」「8回以上トレードして勝率60%」「1回も-4,000円を超えずに3勝」など、利益だけでなく<b>やり方も縛る</b>お題が出ます。</p>
          </>
        ),
      },
      {
        title: '設定の記憶と画面を広く使う',
        body: (
          <>
            <p>インジケーター・足・再生速度・音・歩み値・対戦・配色の設定は<b>自動で保存されます</b>。次に開いたときは前回のままなので、毎回選び直す必要はありません。</p>
            <p>音・配色・昼休みスキップは、説明ボタンの右の <b>⚙ 設定</b> にまとまっています。<b>配色は5つから選べます</b>（midnight・spring・summer・fall・winter）。春と冬は白地です。チャートも板も歩み値も同時に切り替わります。</p>
            <p className="warn">※ 設定の<b>リセット</b>は、data/challenges の記録（チャレンジ・取引・ルール・画面の設定）をまとめて消して、はじめの状態に戻します。押すと確認が出て、そこで「はい」を押したときだけ消えます。<b>元には戻せません。</b></p>
            <p>ヘッダーの右端の <b>▲</b> と、フッターの <b>▼</b> を押すと、それぞれ畳めます。畳んだぶんチャートが広がり、残った細い帯を押すと戻ります。畳んでいる間も帯に現在値や時刻は出ています。</p>
            <p>歩み値も見出しの「歩み値 ✕」で閉じられます。全部畳むとチャートの高さが約16%増えます。</p>
          </>
        ),
      },
      {
        title: '音とBGM',
        body: (
          <>
            <p>説明ボタンの右の <b>⚙ 設定</b> を押すと、<b>BGM / 値動き / 約定</b> の3つを別々に切り替えられます。</p>
            <p><b>値動き</b>は売買が成立するたびに鳴ります。株数が多いほど低く大きく鳴るので、大口が入ったのが耳で分かります。<b>約定</b>は自分の売買が成立したとき・ルール違反・お題の達成で鳴ります。</p>
            <p><b>BGM</b>は再生中だけ流れます。ふだんは静かなパッドだけですが、<b>チャレンジ中はベースとリズムが加わって音が厚くなります</b>。切り替わる瞬間には合図の音が入るので、記録し忘れ・切り忘れに耳で気づけます。</p>
          </>
        ),
      },
    ],
  },
];

export function Help({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState(0);

  return (
    <div className="an-back" onClick={onClose}>
      <div className="help" onClick={(e) => e.stopPropagation()}>
        <header className="an-head">
          <div>
            <strong>機能の説明</strong>
            <span className="an-sub">株がはじめてでも読めるように書いています</span>
          </div>
          <button type="button" className="mini" onClick={onClose}>
            閉じる
          </button>
        </header>

        <div className="help-main">
          <nav className="help-nav">
            {TABS.map((t, i) => (
              <button
                type="button"
                key={t.name}
                className={i === tab ? 'on' : ''}
                onClick={() => setTab(i)}
              >
                {t.name}
              </button>
            ))}
          </nav>

          <div className="help-body">
            {TABS[tab].items.map((it) => (
              <section key={it.title} className="help-item">
                <h4>{it.title}</h4>
                {it.art}
                <div className="help-text">{it.body}</div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
