import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const DATA_DIR = join(process.cwd(), 'public', 'data')
/** チャレンジの記録置き場。.csv 以外の名前なので再生用CSVの一覧には出ない */
const LOG_DIR = join(DATA_DIR, 'challenges')
/** 日報の置き場。1日 = 1フォルダで、本文 entry.md と画像を同じ場所に置く */
const DIARY_DIR = join(DATA_DIR, 'diary')
const DIARY_FILE = 'entry.md'
/** 日報に添える画像の上限。スクリーンショットなら数MBで足りる */
const MAX_IMAGE = 16 * 1024 * 1024
/** 戦略の図（SVG/PNG/JPEG…）の置き場。git に入れるのでどの端末でも同じ一覧になる */
const STRATEGY_DIR = join(DATA_DIR, 'strategy')
/** 取り込むCSVの上限。歩み値1日分でも数MBなので十分 */
const MAX_UPLOAD = 64 * 1024 * 1024

/** 戦略の図として受け付ける拡張子と、返すときの Content-Type */
const IMAGE_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}
const imageExt = (name: string) => {
  const m = /\.[^.]+$/.exec(name.toLowerCase())
  return m && IMAGE_TYPES[m[0]] ? m[0] : null
}

/**
 * 危険な文字とディレクトリ移動を落として "○○.csv" だけ通す。
 * 濁点・半濁点は結合文字(U+3099/309A)で来る。macOSのファイル名はNFDなので、
 * これを落とすと「ジ」が「シ_」に化けて実ファイルに当たらなくなる。
 */
const NG_CHAR =
  /[^\w.\-\u3005-\u3007\u3041-\u309f\u30a0-\u30ff\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{3134f}]/gu

function safeName(raw: string, ok: (name: string) => boolean = (n) => n.endsWith('.csv')): string | null {
  const name = basename(decodeURIComponent(raw)).replace(NG_CHAR, '_')
  if (!name || name.startsWith('.') || !ok(name.toLowerCase())) return null
  return name
}

/**
 * 実ファイル名を引き当てる。ブラウザからはNFCで来ることがあり、
 * NFDで置かれている実体とは字面が違う。見つからなければそのまま返す（新規保存用）。
 */
async function realName(name: string, dir = DATA_DIR): Promise<string> {
  const names = await readdir(dir).catch(() => [] as string[])
  const want = name.normalize('NFC')
  return names.find((n) => n.normalize('NFC') === want) ?? name
}

async function listCsv() {
  const names = await readdir(DATA_DIR).catch(() => [] as string[])
  return names.filter((n) => n.toLowerCase().endsWith('.csv') && !n.startsWith('.')).sort()
}

/**
 * public/data のCSVを一覧・取得・保存するための開発サーバー用API。
 * ブラウザからはローカルのファイルシステムに書けないので dev サーバーに肩代わりさせる。
 *
 * 取得も Vite の public 配信ではなくここを通す。public 配信は起動時に作った
 * ファイル一覧を見るので、起動後に書いたファイルが index.html にフォールバックしてしまう。
 * 本番ビルド (vite build) には含まれない。
 */
function dataFilesApi(): Plugin {
  return {
    name: 'data-files-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/data', (req, res, next) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(body))
        }
        const path = (req.url ?? '/').split('?')[0]

        if (req.method === 'GET' && (path === '/' || path === '')) {
          listCsv().then(
            (files) => send(200, { files }),
            (e) => send(500, { error: String(e) }),
          )
          return
        }

        if (req.method === 'GET' && path.startsWith('/file/')) {
          const name = safeName(path.slice('/file/'.length))
          if (!name) return send(400, { error: 'CSVファイル名が不正です' })
          realName(name)
            .then((real) => readFile(join(DATA_DIR, real)))
            .then(
              (buf) => {
                res.statusCode = 200
                res.setHeader('Content-Type', 'text/csv; charset=utf-8')
                res.setHeader('Cache-Control', 'no-store')
                res.end(buf)
              },
              () => send(404, { error: `${name} がありません` }),
            )
          return
        }

        if (req.method === 'PUT') {
          const name = safeName(path.replace(/^\//, ''))
          if (!name) return send(400, { error: 'CSVファイル名が不正です' })

          const chunks: Buffer[] = []
          let size = 0
          let aborted = false
          req.on('data', (c: Buffer) => {
            size += c.length
            if (size > MAX_UPLOAD) {
              aborted = true
              send(413, { error: 'ファイルが大きすぎます' })
              req.destroy()
              return
            }
            chunks.push(c)
          })
          req.on('end', () => {
            if (aborted) return
            const body = Buffer.concat(chunks)
            // 既にある字面（NFD/NFC）に合わせる。合わせないと同じ銘柄が二重に並ぶ
            realName(name)
              .then(async (real) => {
                const target = join(DATA_DIR, real)
                // 同名で中身も同じなら書き直さない
                const same = await readFile(target)
                  .then((cur) => cur.equals(body))
                  .catch(() => false)
                if (!same) await writeFile(target, body)
                send(200, { name: real, saved: !same })
              })
              .catch((e) => send(500, { error: String(e) }))
          })
          return
        }

        next()
      })
    },
  }
}

/**
 * 戦略の図を一覧・取得・保存するAPI。置き場は public/data/strategy。
 * 図は git に入れて端末間で同期するので、ブラウザではなくここに保存する。
 */
function strategyApi(): Plugin {
  return {
    name: 'strategy-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/strategy', (req, res, next) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(body))
        }
        const path = (req.url ?? '/').split('?')[0]

        if (req.method === 'GET' && (path === '/' || path === '')) {
          readdir(STRATEGY_DIR)
            .catch(() => [] as string[])
            .then((names) => send(200, { files: names.filter((n) => !n.startsWith('.') && imageExt(n)).sort() }))
          return
        }

        if (req.method === 'GET' && path.startsWith('/file/')) {
          const name = safeName(path.slice('/file/'.length), (n) => !!imageExt(n))
          if (!name) return send(400, { error: '画像ファイル名が不正です' })
          realName(name, STRATEGY_DIR)
            .then((real) => readFile(join(STRATEGY_DIR, real)))
            .then(
              (buf) => {
                res.statusCode = 200
                res.setHeader('Content-Type', IMAGE_TYPES[imageExt(name)!])
                res.setHeader('Cache-Control', 'no-store')
                res.end(buf)
              },
              () => send(404, { error: `${name} がありません` }),
            )
          return
        }

        if (req.method === 'PUT') {
          const name = safeName(path.replace(/^\//, ''), (n) => !!imageExt(n))
          if (!name) return send(400, { error: 'SVG・PNG・JPEG・GIF・WebP だけ置けます' })

          const chunks: Buffer[] = []
          let size = 0
          let aborted = false
          req.on('data', (c: Buffer) => {
            size += c.length
            if (size > MAX_UPLOAD) {
              aborted = true
              send(413, { error: 'ファイルが大きすぎます' })
              req.destroy()
              return
            }
            chunks.push(c)
          })
          req.on('end', () => {
            if (aborted) return
            const body = Buffer.concat(chunks)
            mkdir(STRATEGY_DIR, { recursive: true })
              .then(() => realName(name, STRATEGY_DIR))
              .then(async (real) => {
                const target = join(STRATEGY_DIR, real)
                // 同名で中身も同じなら書き直さない
                const same = await readFile(target)
                  .then((cur) => cur.equals(body))
                  .catch(() => false)
                if (!same) await writeFile(target, body)
                send(200, { name: real, saved: !same })
              })
              .catch((e) => send(500, { error: String(e) }))
          })
          return
        }

        next()
      })
    },
  }
}

/**
 * チャレンジ（分析用の記録）を溜めるAPI。
 * CSVの整形はクライアント側(csvfile.ts)に任せ、ここは追記だけを受け持つ。
 */
function challengeApi(): Plugin {
  return {
    name: 'challenge-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/challenges', (req, res, next) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(body))
        }
        const safe = (n: string) => (/^[\w-]+\.csv$/.test(n) ? n : null)
        const path = (req.url ?? '/').split('?')[0]

        if (req.method === 'GET' && (path === '/' || path === '')) {
          readdir(LOG_DIR)
            .catch(() => [] as string[])
            .then(async (names) => {
              const files: Record<string, string> = {}
              for (const n of names.filter((x) => safe(x))) {
                files[n] = await readFile(join(LOG_DIR, n), 'utf8').catch(() => '')
              }
              send(200, { files })
            })
            .catch((e) => send(500, { error: String(e) }))
          return
        }

        // DELETE /api/challenges … 記録置き場をまるごと初期状態（ファイル無し）に戻す。
        // 消したあとはクライアントが読み直し、既定値から書き起こす
        if (req.method === 'DELETE' && (path === '/' || path === '')) {
          readdir(LOG_DIR)
            .catch(() => [] as string[])
            .then(async (names) => {
              const removed: string[] = []
              for (const n of names.filter((x) => safe(x))) {
                await unlink(join(LOG_DIR, n)).catch(() => {})
                removed.push(n)
              }
              send(200, { removed })
            })
            .catch((e) => send(500, { error: String(e) }))
          return
        }

        // DELETE /api/challenges/<id> … そのチャレンジの行を全ファイルから消す
        if (req.method === 'DELETE') {
          const id = decodeURIComponent(path.replace(/^\//, '')).trim()
          if (!/^[\w-]+$/.test(id)) return send(400, { error: 'IDが不正です' })

          readdir(LOG_DIR)
            .catch(() => [] as string[])
            .then(async (names) => {
              let removed = 0
              for (const n of names.filter((x) => safe(x))) {
                const target = join(LOG_DIR, n)
                const text = await readFile(target, 'utf8').catch(() => '')
                if (!text) continue
                const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
                const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
                const head = lines[0]
                const body = lines.slice(1).filter((l) => l.trim() !== '')
                const kept = body.filter((l) => l.split(',')[0] !== id)
                removed += body.length - kept.length
                const next = [head, ...kept].join('\r\n')
                await writeFile(target, `${bom}${next}\r\n`)
              }
              send(200, { id, removed })
            })
            .catch((e) => send(500, { error: String(e) }))
          return
        }

        if (req.method === 'POST') {
          const chunks: Buffer[] = []
          req.on('data', (c: Buffer) => chunks.push(c))
          req.on('end', async () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
                files?: { name: string; header: string; rows: string[]; replace?: boolean }[]
              }
              if (!Array.isArray(body.files)) return send(400, { error: 'files がありません' })
              await mkdir(LOG_DIR, { recursive: true })

              const saved: { name: string; appended: number }[] = []
              for (const f of body.files) {
                const name = safe(f.name ?? '')
                if (!name || !Array.isArray(f.rows)) continue
                const target = join(LOG_DIR, name)

                // replace は毎回まるごと書き直す（ルールのような「いまの状態」向け）
                if (f.replace) {
                  await writeFile(target, `\uFEFF${[f.header, ...f.rows].join('\r\n')}\r\n`)
                  saved.push({ name, appended: f.rows.length })
                  continue
                }

                if (f.rows.length === 0) continue
                const exists = await readFile(target, 'utf8').then(
                  () => true,
                  () => false,
                )
                // 無ければ BOM とヘッダーから書き起こす
                if (!exists) await writeFile(target, `\uFEFF${f.header}\r\n`)
                await appendFile(target, `${f.rows.join('\r\n')}\r\n`)
                saved.push({ name, appended: f.rows.length })
              }
              send(200, { saved })
            } catch (e) {
              send(500, { error: String(e) })
            }
          })
          return
        }

        next()
      })
    },
  }
}

// ---- 日報 -----------------------------------------------------------------

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg)$/i
const IMG_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

/** 日付はフォルダ名にそのまま使うので、この形しか通さない */
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

/** 画像名。CSVと同じく危険な文字とディレクトリ移動を落とし、画像の拡張子だけ通す */
function safeImageName(raw: string): string | null {
  let name: string
  try {
    name = basename(decodeURIComponent(raw)).normalize('NFC').replace(NG_CHAR, '_')
  } catch {
    return null
  }
  if (!name || name.startsWith('.') || !IMG_EXT.test(name)) return null
  return name
}

/** 同じ名前があれば "-2" "-3" と番号を足して、先にある画像を潰さない */
async function freeImageName(dir: string, name: string): Promise<string> {
  const names = (await readdir(dir).catch(() => [] as string[])).map((n) => n.normalize('NFC'))
  if (!names.includes(name)) return name
  const m = name.match(/^(.*?)(\.[^.]+)$/)
  const [stem, ext] = m ? [m[1], m[2]] : [name, '']
  for (let i = 2; ; i++) {
    const cand = `${stem}-${i}${ext}`
    if (!names.includes(cand)) return cand
  }
}

/** 添えた順に見たいので更新時刻で並べる。同時刻なら名前順 */
async function listImages(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[])
  const imgs = await Promise.all(
    names
      .filter((n) => !n.startsWith('.') && IMG_EXT.test(n))
      .map(async (n) => ({ n, t: (await stat(join(dir, n))).mtimeMs })),
  )
  return imgs.sort((a, b) => a.t - b.t || a.n.localeCompare(b.n)).map((x) => x.n)
}

/** 実ファイル名を引き当てる（CSVと同じ NFC/NFD の事情） */
async function realImageName(dir: string, name: string): Promise<string | null> {
  const names = await readdir(dir).catch(() => [] as string[])
  const want = name.normalize('NFC')
  return names.find((n) => n.normalize('NFC') === want) ?? null
}

/** 一覧に出す見出し。本文の先頭にある front matter の title を拾う */
function pickTitle(text: string): string {
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return ''
  const line = m[1].split(/\r?\n/).find((l) => /^title:/.test(l))
  return line ? line.replace(/^title:\s*/, '').trim() : ''
}

function readBody(req: import('node:http').IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((ok) => {
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) {
        over = true
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => ok(over ? null : Buffer.concat(chunks)))
    req.on('error', () => ok(null))
    req.on('close', () => {
      if (over) ok(null)
    })
  })
}

/**
 * 日報のAPI。public/data/diary/<日付>/ に entry.md と画像を置く。
 * 本文の書式はクライアント側 (src/lib/diary.ts) が決め、ここは文字列をそのまま預かるだけ。
 *
 * GET    /api/diary                       一覧（日付・タイトル・画像の枚数）
 * GET    /api/diary/<日付>                 本文と画像名の一覧
 * PUT    /api/diary/<日付>                 本文を保存 { text, from? }。from があればその日付から移す
 * GET    /api/diary/<日付>/images/<名前>    画像そのもの
 * PUT    /api/diary/<日付>/images/<名前>    画像を追加（本体をそのまま送る）。同名なら番号を足す
 * DELETE /api/diary/<日付>/images/<名前>    画像を外す
 *
 * 日報そのものを消すAPIは用意していない。記録は残す方針。
 */
function diaryApi(): Plugin {
  return {
    name: 'diary-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/diary', (req, res, next) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(body))
        }
        const path = (req.url ?? '/').split('?')[0]
        const parts = path.split('/').filter(Boolean)
        const method = req.method ?? 'GET'

        // GET /api/diary
        if (method === 'GET' && parts.length === 0) {
          readdir(DIARY_DIR)
            .catch(() => [] as string[])
            .then(async (names) => {
              const entries: { date: string; title: string; images: number }[] = []
              for (const date of names.filter(isDate)) {
                const dir = join(DIARY_DIR, date)
                const text = await readFile(join(dir, DIARY_FILE), 'utf8').catch(() => null)
                if (text === null) continue
                entries.push({ date, title: pickTitle(text), images: (await listImages(dir)).length })
              }
              entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
              send(200, { entries })
            })
            .catch((e) => send(500, { error: String(e) }))
          return
        }

        const date = decodeURIComponent(parts[0] ?? '')
        if (!isDate(date)) return send(400, { error: '日付は YYYY-MM-DD の形で指定してください' })
        const dir = join(DIARY_DIR, date)

        // GET /api/diary/<date>
        if (method === 'GET' && parts.length === 1) {
          readFile(join(dir, DIARY_FILE), 'utf8')
            .then(
              async (text) => send(200, { date, text, images: await listImages(dir) }),
              () => send(404, { error: `${date} の日報がありません` }),
            )
            .catch((e) => send(500, { error: String(e) }))
          return
        }

        // PUT /api/diary/<date>
        if (method === 'PUT' && parts.length === 1) {
          readBody(req, MAX_IMAGE)
            .then(async (buf) => {
              if (!buf) return send(413, { error: '本文が大きすぎます' })
              const body = JSON.parse(buf.toString('utf8')) as { text?: string; from?: string }
              if (typeof body.text !== 'string') return send(400, { error: 'text がありません' })

              const from = typeof body.from === 'string' ? body.from : ''
              if (from && from !== date) {
                if (!isDate(from)) return send(400, { error: '移す元の日付が不正です' })
                const exists = await stat(dir).then(() => true, () => false)
                if (exists) return send(409, { error: `${date} の日報はすでにあります` })
                const src = join(DIARY_DIR, from)
                const has = await stat(src).then(() => true, () => false)
                if (has) await rename(src, dir)
              }

              await mkdir(dir, { recursive: true })
              await writeFile(join(dir, DIARY_FILE), body.text)
              send(200, { date, images: await listImages(dir) })
            })
            .catch((e) => send(500, { error: String(e) }))
          return
        }

        // /api/diary/<date>/images/<name>
        if (parts.length === 3 && parts[1] === 'images') {
          const name = safeImageName(parts[2])
          if (!name) return send(400, { error: '画像の名前が不正です（png / jpg / gif / webp / svg）' })

          if (method === 'GET') {
            realImageName(dir, name)
              .then(async (real) => {
                if (!real) return send(404, { error: `${name} がありません` })
                const buf = await readFile(join(dir, real))
                const ext = real.split('.').pop()?.toLowerCase() ?? ''
                res.statusCode = 200
                res.setHeader('Content-Type', IMG_MIME[ext] ?? 'application/octet-stream')
                res.setHeader('Cache-Control', 'no-store')
                res.end(buf)
              })
              .catch((e) => send(500, { error: String(e) }))
            return
          }

          if (method === 'PUT') {
            readBody(req, MAX_IMAGE)
              .then(async (buf) => {
                if (!buf) return send(413, { error: '画像が大きすぎます（16MBまで）' })
                if (buf.length === 0) return send(400, { error: '画像が空です' })
                await mkdir(dir, { recursive: true })
                const saved = await freeImageName(dir, name)
                await writeFile(join(dir, saved), buf)
                send(200, { name: saved })
              })
              .catch((e) => send(500, { error: String(e) }))
            return
          }

          if (method === 'DELETE') {
            realImageName(dir, name)
              .then(async (real) => {
                if (!real) return send(404, { error: `${name} がありません` })
                await unlink(join(dir, real))
                send(200, { name: real })
              })
              .catch((e) => send(500, { error: String(e) }))
            return
          }
        }

        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dataFilesApi(), strategyApi(), challengeApi(), diaryApi()],
  server: {
    // public/data への保存でページ全体がリロードされると再生位置が飛ぶので監視から外す
    watch: { ignored: ['**/public/data/**'] },
  },
})
