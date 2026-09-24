import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addDiaryImage,
  diaryImageUrl,
  isDiaryDate,
  labelDate,
  listDiary,
  loadDiary,
  removeDiaryImage,
  saveDiary,
  SECTION_IMPROVE,
  SECTION_MEMO,
  todayKey,
  type DiaryEntry,
  type DiaryHead,
  type DiaryLoaded,
} from '../lib/diary';

/**
 * 日報。ヘッダー右の「日報」ボタンで開く。
 *
 * 左に日付の一覧、右にその日の中身。「新規作成」か「編集」で書く画面に切り替わる。
 * 画像は「画像を追加」・ドロップ・貼り付け（⌘V）で添えられる。
 * 添えた画像と外した画像は手元に控えておき、「保存」を押したときにまとめてサーバーへ送る。
 * だから「取消」で元に戻せる。
 */

type Mode = 'view' | 'edit';

/** まだ送っていない画像。url はプレビュー用の object URL */
type Pending = { key: number; name: string; file: File; url: string };

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

const emptyEntry = (): DiaryEntry => ({ date: todayKey(), title: '', improve: '', memo: '' });

const sameText = (a: DiaryEntry, b: DiaryEntry) =>
  a.date === b.date && a.title === b.title && a.improve === b.improve && a.memo === b.memo;

/** 貼り付けた画像には名前が無い（image.png）ので、時刻で名前を付ける */
function pastedName(file: File): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.replace(/^image\//, '').replace('+xml', '') || 'png';
  return `paste-${stamp}.${ext}`;
}

/** ヘッダー右の「日報」ボタン。押すと窓が開く */
export function DiaryButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`btn tool-btn${open ? ' on' : ''}`}
        onClick={() => setOpen(true)}
        title="日報を開く（振り返りを書く・読み返す）"
      >
        日報
      </button>
      {open && <DiaryView onClose={() => setOpen(false)} />}
    </>
  );
}

function DiaryView({ onClose }: { onClose: () => void }) {
  const [heads, setHeads] = useState<DiaryHead[]>([]);
  const [ready, setReady] = useState(false);
  /** 開いている日報の保存済みの姿。新規作成中は null */
  const [loaded, setLoaded] = useState<DiaryLoaded | null>(null);
  /** 何も無ければそのまま新規作成になる。読み終わるまでは ready が false で中身は出さない */
  const [mode, setMode] = useState<Mode>('edit');
  const [draft, setDraft] = useState<DiaryEntry>(emptyEntry);
  const [pending, setPending] = useState<Pending[]>([]);
  /** 保存したら外す既存の画像 */
  const [dropped, setDropped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ url: string; name: string } | null>(null);
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const pendingRef = useRef<Pending[]>([]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  // 閉じるときにプレビュー用の object URL を返す
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const dirty =
    mode === 'edit' &&
    (pending.length > 0 ||
      dropped.length > 0 ||
      (loaded ? !sameText(draft, loaded) : !sameText(draft, { ...emptyEntry(), date: draft.date })));

  const clearPending = useCallback(() => {
    pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    setPending([]);
    setDropped([]);
  }, []);

  /** 書きかけを捨ててよいか確かめる。よければ後片付けもする */
  const leave = useCallback(() => {
    if (dirty && !window.confirm('書きかけの内容を捨てますか？')) return false;
    clearPending();
    return true;
  }, [dirty, clearPending]);

  const refresh = useCallback(async () => {
    const list = await listDiary();
    setHeads(list);
    return list;
  }, []);

  const open = useCallback(async (date: string) => {
    setBusy(true);
    setError(null);
    try {
      const e = await loadDiary(date);
      setLoaded(e);
      setDraft({ date: e.date, title: e.title, improve: e.improve, memo: e.memo });
      setMode('view');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const startNew = useCallback(() => {
    if (!leave()) return;
    setLoaded(null);
    setDraft(emptyEntry());
    setMode('edit');
    setError(null);
  }, [leave]);

  // 開いたら一覧を読み、いちばん新しい日を出す。何も無ければ新規作成のまま
  useEffect(() => {
    let alive = true;
    const boot = async () => {
      try {
        const list = await refresh();
        if (!alive) return;
        if (list.length > 0) await open(list[0].date);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setReady(true);
      }
    };
    void boot();
    return () => {
      alive = false;
    };
  }, [refresh, open]);

  const close = useCallback(() => {
    if (leave()) onClose();
  }, [leave, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (zoom) setZoom(null);
      else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom, close]);

  const startEdit = () => {
    if (!loaded) return;
    setDraft({ date: loaded.date, title: loaded.title, improve: loaded.improve, memo: loaded.memo });
    setMode('edit');
    setError(null);
  };

  const cancel = () => {
    if (!leave()) return;
    if (loaded) {
      setDraft({ date: loaded.date, title: loaded.title, improve: loaded.improve, memo: loaded.memo });
      setMode('view');
    } else if (heads.length > 0) {
      void open(heads[0].date);
    } else {
      setDraft(emptyEntry());
    }
    setError(null);
  };

  /** 同じ日付の日報がほかにあるか。あれば上書きになるので保存させない */
  const clash = mode === 'edit' && draft.date !== loaded?.date && heads.some((h) => h.date === draft.date);

  const save = async () => {
    if (!isDiaryDate(draft.date)) {
      setError('日付を入れてください');
      return;
    }
    if (clash) {
      setError(`${labelDate(draft.date)} の日報はすでにあります。一覧から開いて編集してください`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveDiary(draft, loaded?.date);
      for (const n of dropped) await removeDiaryImage(draft.date, n);
      for (const p of pending) await addDiaryImage(draft.date, p.file, p.name);
      clearPending();
      await refresh();
      await open(draft.date);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addFiles = (files: FileList | File[] | null) => {
    const imgs = [...(files ?? [])].filter((f) => f.type.startsWith('image/') || IMG_EXT.test(f.name));
    if (imgs.length === 0) {
      setError('画像ファイル（PNG・JPEG・GIF・WebP・SVG）を選んでください');
      return;
    }
    setError(null);
    setPending((cur) => [
      ...cur,
      ...imgs.map((f) => ({
        key: ++seq.current,
        name: IMG_EXT.test(f.name) ? f.name.normalize('NFC') : pastedName(f),
        file: f,
        url: URL.createObjectURL(f),
      })),
    ]);
  };

  const dropPending = (key: number) => {
    setPending((cur) => {
      const hit = cur.find((p) => p.key === key);
      if (hit) URL.revokeObjectURL(hit.url);
      return cur.filter((p) => p.key !== key);
    });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (mode !== 'edit') return;
    addFiles(e.dataTransfer.files);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (mode !== 'edit') return;
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  };

  const kept = loaded ? loaded.images.filter((n) => !dropped.includes(n)) : [];
  /** 保存済みの画像は、まだ日付を変えていても元のフォルダにある */
  const imgDate = loaded?.date ?? draft.date;
  /** 線画のSVGは黒文字が多いので白い紙に載せる */
  const svg = (n: string) => (/\.svg$/i.test(n) ? 'svg' : undefined);
  const onDate = loaded?.date ?? null;

  return (
    <div
      className="an-back"
      onClick={(e) => {
        e.stopPropagation();
        close();
      }}
    >
      <div className="diary" onClick={(e) => e.stopPropagation()}>
        <header className="an-head">
          <div>
            <strong>日報</strong>
            <span className="an-sub">
              {!ready ? '読み込み中…' : mode === 'edit' ? (loaded ? `${labelDate(loaded.date)} を編集中` : '新しい日報') : 'その日の振り返りを残す'}
            </span>
          </div>
          <div className="an-acts">
            {ready && mode === 'view' && loaded && (
              <button type="button" className="mini" onClick={startEdit} disabled={busy}>
                編集
              </button>
            )}
            {ready && mode === 'edit' && (
              <>
                <button type="button" className="mini on" onClick={() => void save()} disabled={busy || clash}>
                  {busy ? '保存中…' : '保存'}
                </button>
                <button type="button" className="mini" onClick={cancel} disabled={busy}>
                  取消
                </button>
              </>
            )}
            <button type="button" className="mini" onClick={close}>
              閉じる
            </button>
          </div>
        </header>

        <div className="diary-main">
          <nav className="diary-side">
            <button type="button" className="diary-new" onClick={startNew} disabled={busy}>
              ＋ 新規作成
            </button>
            <div className="diary-list">
              {heads.map((h) => (
                <button
                  key={h.date}
                  type="button"
                  className={`diary-item${h.date === onDate ? ' on' : ''}`}
                  onClick={() => {
                    if (h.date === onDate && mode === 'view') return;
                    if (!leave()) return;
                    void open(h.date);
                  }}
                  disabled={busy}
                  title={h.title}
                >
                  <b>{labelDate(h.date)}</b>
                  <span>{h.title || '（無題）'}</span>
                  {h.images > 0 && <em>画像 {h.images}</em>}
                </button>
              ))}
              {ready && heads.length === 0 && <p className="diary-none">まだ日報はありません</p>}
            </div>
          </nav>

          <section
            className={`diary-pane${over ? ' over' : ''}`}
            onDragOver={(e) => {
              if (mode !== 'edit') return;
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            onPaste={onPaste}
          >
            {!ready ? (
              <p className="diary-none">読み込み中…</p>
            ) : mode === 'edit' ? (
              <div className="diary-edit">
                <div className="diary-row">
                  <label className="diary-in">
                    <span>日付</span>
                    <input
                      type="date"
                      value={draft.date}
                      onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                    />
                  </label>
                  <label className="diary-in grow">
                    <span>タイトル</span>
                    <input
                      type="text"
                      value={draft.title}
                      placeholder="例: -7800 マクロ下げ、上げチャート狙い"
                      onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                    />
                  </label>
                </div>
                {clash && (
                  <p className="diary-warn">
                    {labelDate(draft.date)} の日報はすでにあります。一覧から開いて編集してください
                  </p>
                )}
                <label className="diary-field">
                  <span>{SECTION_IMPROVE}</span>
                  <textarea
                    rows={7}
                    value={draft.improve}
                    placeholder={'・エントリーミスの場合は損切りも早くする\n・ブレイク狙いはしなかった時点で切る'}
                    onChange={(e) => setDraft((d) => ({ ...d, improve: e.target.value }))}
                  />
                </label>
                <label className="diary-field">
                  <span>{SECTION_MEMO}</span>
                  <textarea
                    rows={8}
                    value={draft.memo}
                    placeholder="今日の相場・自分の動き・気づいたこと"
                    onChange={(e) => setDraft((d) => ({ ...d, memo: e.target.value }))}
                  />
                </label>

                <div className="diary-imgs-head">
                  <span>画像</span>
                  <button type="button" className="mini" onClick={() => pick.current?.click()} disabled={busy}>
                    画像を追加
                  </button>
                  <span className="diary-hint">ここにドロップ、または貼り付け（⌘V）でも添えられます</span>
                </div>
                {kept.length + pending.length > 0 ? (
                  <div className="diary-imgs">
                    {kept.map((n) => (
                      <figure key={n} className="diary-img">
                        <button
                          type="button"
                          onClick={() => setZoom({ url: diaryImageUrl(imgDate, n), name: n })}
                          title="大きく見る"
                        >
                          <img className={svg(n)} src={diaryImageUrl(imgDate, n)} alt={n} />
                        </button>
                        <figcaption>{n}</figcaption>
                        <button
                          type="button"
                          className="diary-img-x"
                          onClick={() => setDropped((d) => [...d, n])}
                          title="この画像を外す（保存で確定）"
                        >
                          ✕
                        </button>
                      </figure>
                    ))}
                    {pending.map((p) => (
                      <figure key={p.key} className="diary-img new">
                        <button type="button" onClick={() => setZoom({ url: p.url, name: p.name })} title="大きく見る">
                          <img className={svg(p.name)} src={p.url} alt={p.name} />
                        </button>
                        <figcaption>{p.name}</figcaption>
                        <button
                          type="button"
                          className="diary-img-x"
                          onClick={() => dropPending(p.key)}
                          title="添えるのをやめる"
                        >
                          ✕
                        </button>
                      </figure>
                    ))}
                  </div>
                ) : (
                  <button type="button" className="diary-drop" onClick={() => pick.current?.click()} disabled={busy}>
                    画像はまだありません。クリックして選ぶか、ここにドロップ
                  </button>
                )}
              </div>
            ) : loaded ? (
              <article className="diary-view">
                <h3 className="diary-title">{loaded.title || '（無題）'}</h3>
                <p className="diary-date">{labelDate(loaded.date)}</p>
                <section className="diary-sec">
                  <h4>{SECTION_IMPROVE}</h4>
                  {loaded.improve ? <pre>{loaded.improve}</pre> : <p className="diary-blank">（なし）</p>}
                </section>
                <section className="diary-sec">
                  <h4>{SECTION_MEMO}</h4>
                  {loaded.memo ? <pre>{loaded.memo}</pre> : <p className="diary-blank">（なし）</p>}
                </section>
                {loaded.images.length > 0 && (
                  <section className="diary-sec">
                    <h4>画像</h4>
                    <div className="diary-imgs">
                      {loaded.images.map((n) => (
                        <figure key={n} className="diary-img">
                          <button
                            type="button"
                            onClick={() => setZoom({ url: diaryImageUrl(loaded.date, n), name: n })}
                            title="大きく見る"
                          >
                            <img className={svg(n)} src={diaryImageUrl(loaded.date, n)} alt={n} />
                          </button>
                          <figcaption>{n}</figcaption>
                        </figure>
                      ))}
                    </div>
                  </section>
                )}
              </article>
            ) : (
              <p className="diary-none">左の一覧から日付を選ぶか、新規作成を押してください</p>
            )}
          </section>
        </div>

        {error && <p className="strat-err">{error}</p>}

        <input
          ref={pick}
          type="file"
          accept="image/*,.svg"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {zoom && (
          <div className="diary-zoom" onClick={() => setZoom(null)} title="クリックで戻る">
            <img className={svg(zoom.name)} src={zoom.url} alt={zoom.name} />
            <span>{zoom.name}</span>
          </div>
        )}
      </div>
    </div>
  );
}
