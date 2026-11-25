// dsh-whale-ledger · 宿主半边
//
// 干什么：把「钱花在哪、谁还醒着、服务活没活」三件事读成一屏。
//
// 三条数据源，按「有没有」自己接：
//   ① DSH 自己 —— 会话投影缓存（storages/session_projcache）+ 会话事件（sessions/*.jsonl.zstd）
//                 人人都有，所以这一条永远在。
//   ② SurfCore —— 今日账本、按会话分账、每日上限、沉睡状态（可选）
//   ③ 端口探测 —— SnowLuma / 语音服务 / 控制台（可选）
//
// 全是只读：不写 SurfCore、不写会话记录、不写配置。
// 读不到就退：不报错、不显示空面板（前端按 sources 决定画哪块）。

import { readFileSync, readdirSync, statSync, existsSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, basename, sep } from 'node:path'
import { homedir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'
import net from 'node:net'

export const name = 'whale-ledger'
export const inject = ['webServer']

const 家 = process.env.DSH_HOME || join(homedir(), '.dsh')
const 数据目录 = join(家, 'whale-ledger')

// 默认价（元 / 百万 token）。跟 SurfCore config 里 pricing.models 的写法一致。
// 只在「没装 SurfCore」时用来把 token 折算成钱 —— 那时候只能估算，面板上会标「估算」。
const 默认价 = { cacheMiss: 3, cacheHit: 0.5, output: 9 }

// ── 小工具 ─────────────────────────────────────────────

function 读JSON(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function 读文本(p, 上限 = 400000) {
  try {
    const s = readFileSync(p, 'utf8')
    return s.length > 上限 ? s.slice(-上限) : s
  } catch {
    return ''
  }
}

function 数(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function 今日串(时 = Date.now()) {
  const d = new Date(时)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function 今日零点(时 = Date.now()) {
  const d = new Date(时)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function 去前缀(文) {
  // 会话标题经常是「【当前时间】2026/11/25 21:33:20（Asia/Shanghai）」这种注入头，
  // 直接当标题摆出来没法看。去掉所有【…】、时间戳、时区尾巴，留正文。
  let s = String(文 || '')
  s = s.replace(/【[^】]{0,20}】/g, ' ')
  s = s.replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2})?/g, ' ')
  s = s.replace(/[（(]\s*Asia\/Shanghai\s*[）)]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  // 剥完只剩括号 / 标点，等于没标题
  if (s && !/[0-9A-Za-z\u4e00-\u9fa5]/.test(s)) s = ''
  return s
}

// ── ① DSH 自己的会话统计 ──────────────────────────────
//
// 用 DSH 自己维护的投影缓存（它给侧栏列表用的那份），不自己去解压会话事件：
//   键位来自 record.rows.<row>.val —— 每行都带 ver/seq，结构变了也不会瞎猜。
// 每行都当「可能没有」处理，缺一个字段不能整页崩。

function 读会话缓存() {
  const 目录 = join(家, 'storages', 'session_projcache', 'sessions')
  let 文件们 = []
  try {
    文件们 = readdirSync(目录).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const 出 = []
  for (const f of 文件们) {
    const o = 读JSON(join(目录, f))
    const 记 = o && o.record
    if (!记 || !记.identity) continue
    const 行 = 记.rows || {}
    const 取 = (k) => (行[k] && 行[k].val !== undefined ? 行[k].val : undefined)
    const id = String(f).replace(/\.json$/, '')
    const 用量 = 取('tokenUsage') || {}
    const 总 = 用量.totals || {}
    const 统计 = 取('sessionStats') || {}
    const 选模 = 取('modelSelection') || {}
    const 最后 = 选模.lastUsed || {}
    const 标题行 = 取('title')
    const 大纲 = 取('turnOutline') || {}
    const 头 = 记.identity || {}
    const 列表 = 取('sessionListMetadata') || {}
    const tokens =
      数(总.uncachedInputTokens) + 数(总.cacheReadTokens) + 数(总.cacheWriteTokens) + 数(总.outputTokens)
    const 首问 = Array.isArray(大纲.turns) && 大纲.turns.length ? 大纲.turns[0].prompt : ''
    let 标题 = ''
    if (typeof 标题行 === 'string') 标题 = 去前缀(标题行)    // DSH 自己的标题可能是被它截断过的（尾巴一个「…」），那种不如不用
    const 像标题 = 标题 && 标题.length >= 4 && !/[….]+$/.test(标题)
    const 首问净 = 去前缀(首问).slice(0, 40)
    出.push({
      id,
      title: 像标题 ? 标题.slice(0, 60) : '',
      首问: 首问净,
      cwd: 头.cwd || 取('workingDirectory') || '',
      createdAt: 数(头.createdAt),
      preset: 取('agentPreset') || '',
      model: 最后.model || '',
      turns: 数(统计.turns),
      steps: 数(统计.steps),
      tokens,
      lastAt: 数(列表.lastPromptAt) || 数(头.createdAt),
    })
  }
  return 出
}

// 今天的 token（只在没有 SurfCore 时用）：解压今天动过的会话事件，按 assistant/message 上的
// usage + time 累加。带一份磁盘缓存（按 大小+修改时间 认），改过的文件才重读。
//
// 速度参考：本机 23 个会话 / 63MB / 约 0.5 秒；命中缓存时是 0。

const 缓存文件 = join(数据目录, 'scan-cache.json')

function 读缓存() {
  const o = 读JSON(缓存文件)
  if (!o || o.v !== 1 || !o.files || typeof o.files !== 'object') return { v: 1, day: '', files: {} }
  return o
}

function 存缓存(o) {
  try {
    mkdirSync(数据目录, { recursive: true })
    writeFileSync(缓存文件, JSON.stringify(o))
  } catch {}
}

function 扫今日会话(起点) {
  const 根 = join(家, 'sessions')
  const 日 = 今日串(起点)
  const 缓存 = 读缓存()
  const 旧 = 缓存.day === 日 ? 缓存.files : {}
  const 新 = {}
  let 重读 = 0
  let 命中 = 0

  const 走 = (目录, 深) => {
    let 名们 = []
    try {
      名们 = readdirSync(目录, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of 名们) {
      const p = join(目录, e.name)
      if (e.isDirectory()) {
        if (深 < 2) 走(p, 深 + 1)
        continue
      }
      if (e.name !== 'session.v4.jsonl.zstd') continue
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.mtimeMs < 起点) continue
      const 记号 = st.size + ':' + Math.round(st.mtimeMs)
      const 老 = 旧[p]
      if (老 && 老.k === 记号) {
        新[p] = 老
        命中++
        continue
      }
      重读++
      新[p] = { k: 记号, ...扫一个会话(p, 起点) }
    }
  }
  走(根, 0)
  if (重读 || 缓存.day !== 日) 存缓存({ v: 1, day: 日, files: 新 })
  return { files: 新, 重读, 命中 }
}

function 扫一个会话(路径, 起点) {
  const 出 = { tokens: 0, cost: 0, msgs: 0, turns: 0, input: 0, cacheRead: 0, output: 0 }
  let 文 = ''
  try {
    const 压 = readFileSync(路径)
    文 = zstdDecompressSync(压).toString('utf8')
  } catch {
    return 出
  }
  // 逐条走「assistant/message」：只有它同时带 time 和 usage。
  // 不整行 JSON.parse —— 这些行有几十 KB 的正文，只取头部的时间与 usage 就够。
  const 标 = '{"type":"assistant/message"'
  const 轮 = new Set()
  let i = 文.indexOf(标)
  while (i >= 0) {
    const 尾 = 文.indexOf('\n', i)
    const 行 = 文.slice(i, 尾 < 0 ? undefined : 尾)
    i = 尾 < 0 ? -1 : 尾 + 1
    const 头 = 行.slice(0, 220)
    const mt = /"time":(\d+)/.exec(头)
    if (!mt) continue
    const 时 = Number(mt[1])
    if (时 < 起点) continue
    const ui = 行.indexOf('"usage":{"inputTokens":')
    if (ui < 0) continue
    const um = /"usage":\{"inputTokens":(\d+),"outputTokens":(\d+),"cacheReadTokens":(\d+),"cacheWriteTokens":(\d+),"totalTokens":(\d+)\}/.exec(
      行.slice(ui, ui + 220),
    )
    if (!um) continue
    出.input += Number(um[1])
    出.output += 数(um[2])
    出.cacheRead += 数(um[3])
    出.tokens += 数(um[5])
    出.msgs++
    const dt = /"data":\{"turn":(\d+)/.exec(头)
    if (dt) 轮.add(dt[1])
  }
  出.turns = 轮.size
  return 出
}

function 折钱(t) {
  const 万 = 1e6
  return (
    (数(t.input) / 万) * 默认价.cacheMiss +
    (数(t.cacheRead) / 万) * 默认价.cacheHit +
    (数(t.output) / 万) * 默认价.output
  )
}

// .../sessions/<工作区>/<会话id>/session.v4.jsonl.zstd → 会话 id
function 会话id来自路径(p) {
  const id = basename(dirname(p))
  if (!id || id === 'sessions') return ''
  return id
}

// ── ② SurfCore（可选）──────────────────────────────────
//
// 位置不写死：先从 profile 的 node_modules/surfcore 反查真实安装根（core/plugins/surfcore
// → core），再退回 DSH_HOME/plugins/surfcore。找不到就整块不出。

function 找SurfCore(config) {
  if (config && config.noSurfcore) return null
  // 只是想看看「没装 SurfCore 长什么样」时用：设这个环境变量重启即可
  if (String(process.env.WHALE_LEDGER_NO_CORE || '') === '1') return null
  const 候选 = []
  if (config && config.surfcoreCore) 候选.push(String(config.surfcoreCore))
  const 推 = (p) => {
    try {
      const 真 = realpathSync(p)
      if (basename(真).toLowerCase() === 'surfcore') {
        const 上 = dirname(真)
        if (basename(上).toLowerCase() === 'plugins') 候选.push(dirname(上))
      }
    } catch {}
  }
  try {
    const 档 = join(家, 'profiles')
    for (const p of readdirSync(档)) 推(join(档, p, 'node_modules', 'surfcore'))
  } catch {}
  推(join(家, 'plugins', 'surfcore'))

  for (const 核 of 候选) {
    const 配 = join(核, 'config.json')
    if (!existsSync(配)) continue
    const cfg = 读JSON(配)
    if (!cfg) continue
    return {
      core: 核,
      configPath: 配,
      config: cfg,
      stateDir: join(核, 'state'),
    }
  }
  return null
}

function 读SurfCore(config) {
  const 出 = {
    on: false,
    config: false,
    usage: false,
    social: false,
    log: false,
    核: null,
    cfg: null,
    day: '',
    cost: 0,
    tokens: 0,
    分来源: [],
    上限: null,
    按会话: {},
    会话: [],
    对话: {},
    错误: [],
  }
  const 找 = 找SurfCore(config)
  if (!找) return 出
  出.on = true
  出.config = true
  出.核 = 找.core
  const cfg = 找.config || {}
  出.cfg = cfg

  // 用量：DSH_HOME/surfcore/token-usage-daily.json（SurfCore 插件写的地方）
  const 用量目录 = [
    join(家, 'surfcore'),
    找.stateDir,
  ]
  let 日 = null
  let 态 = null
  for (const d of 用量目录) {
    if (!日) 日 = 读JSON(join(d, 'token-usage-daily.json'))
    if (!态) 态 = 读JSON(join(d, 'token-usage-state.json'))
  }
  if (日) {
    出.usage = true
    出.day = String(日.day || '')
    出.cost = 数(日.total && 日.total.cost)
    出.tokens = 数(日.total && 日.total.tokens)
    出.分来源 = ['qq', 'bili', 'other']
      .filter((k) => 日[k])
      .map((k) => ({ key: k, cost: 数(日[k].cost), tokens: 数(日[k].tokens) }))
    const 护 = (cfg.socialV2 && cfg.socialV2.tokenGuard) || {}
    if (数(护.maxDailyCostCNY) > 0) {
      出.上限 = {
        daily: 数(护.maxDailyCostCNY),
        left: Math.max(0, 数(护.maxDailyCostCNY) - 出.cost),
        perGroup: 数(护.perGroupDailyCostCNY) || 0,
      }
    }
  }

  // 按会话分账：token-usage-state.json 里每个会话的 dayCost / dayTokens（今天）
  if (态 && 态.sessions && typeof 态.sessions === 'object') {
    for (const [id, s] of Object.entries(态.sessions)) {
      if (!s || typeof s !== 'object') continue
      const c = 数(s.dayCost)
      const tk = 数(s.dayTokens)
      if (c <= 0 && tk <= 0) continue
      出.按会话[id] = {
        cost: c,
        tokens: tk,
        category: String(s.category || 'other'),
        model: String(s.model || ''),
        preset: String(s.preset || ''),
        lastAt: 数(s.lastSeenAt),
      }
    }
  }

  // 会话 ↔ 对话（群 / 私聊）对照：SurfCore 自己记的，用来给没标题的会话起个能认的名字
  const 映 = 读JSON(join(找.stateDir, 'sessions.json'))
  if (映 && 映.sessions && typeof 映.sessions === 'object') {
    for (const [键, sid] of Object.entries(映.sessions)) {
      if (sid) 出.对话[String(sid)] = String(键)
    }
  }

  // 谁醒着：social-v2.json 的会话状态
  const 社 = 读JSON(join(找.stateDir, 'social-v2.json'))
  if (社 && 社.conversations && typeof 社.conversations === 'object') {
    出.social = true
    const 现在 = Date.now()
    for (const [key, c] of Object.entries(社.conversations)) {
      if (!c || typeof c !== 'object') continue
      const w = c.wakeConfig || {}
      const 停 = 数(c.wakeSuspendedUntil)
      const 睡 = 数(w.sleepUntil)
      const 活 = Boolean(w.triggers && w.triggers.anyMessage) || w.mode === 'active'
      let 态名 = 'diving'
      if (停 > 现在) 态名 = 'suspended'
      else if (活) 态名 = 'active'
      else if (w.infinite === false && 睡 > 现在) 态名 = 'sleeping'
      const 未读 = 数(c.unread && (c.unread.count !== undefined ? c.unread.count : c.unread.length))
      出.会话.push({
        key,
        label: key.replace(/^group:/, '群 ').replace(/^private:/, '私聊 '),
        state: 态名,
        mode: String(w.mode || ''),
        infinite: w.infinite !== false,
        sleepUntil: 睡,
        suspendedUntil: 停,
        lastReplyAt: 数(c.lastAiReplyAt),
        lastIncomingAt: 数(c.lastIncomingAt),
        unread: 未读,
        tokens: 数(c.sessionTokens),
        turns: 数(c.sessionTurns),
        wakeCount: 数(w.wakeCount),
      })
    }
  }

  // 最近错误：bridge.log 尾巴
  const 日志 = 读文本(join(找.stateDir, 'bridge.log'), 200000)
  if (日志) {
    出.log = true
    const 行们 = 日志.split(/\r?\n/).filter(Boolean)
    const 坏 = /错误|失败|异常|超时|error|failed|ERR_/i
    for (let i = 行们.length - 1; i >= 0 && 出.错误.length < 3; i--) {
      const l = 行们[i]
      if (!坏.test(l)) continue
      出.错误.push({ text: l.trim().slice(0, 200) })
    }
  }

  return 出
}

// ── ③ 端口探测 ─────────────────────────────────────────

function 解析端口(址) {
  try {
    const u = new URL(String(址))
    const p = Number(u.port) || (u.protocol === 'https:' ? 443 : 80)
    return { host: u.hostname || '127.0.0.1', port: p, label: 址 }
  } catch {
    return null
  }
}

function 探({ host, port }, 超时 = 700) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let 完 = false
    const 收 = (ok) => {
      if (完) return
      完 = true
      resolve({ ok, ms: Date.now() - t0 })
    }
    let s
    try {
      s = net.connect({ host, port })
    } catch {
      return 收(false)
    }
    s.setTimeout(超时)
    s.once('connect', () => {
      s.destroy()
      收(true)
    })
    s.once('timeout', () => {
      s.destroy()
      收(false)
    })
    s.once('error', () => {
      s.destroy()
      收(false)
    })
  })
}

async function 探服务(cfg) {
  const 目标 = []
  if (cfg && cfg.snowluma && (cfg.snowluma.httpUrl || cfg.snowluma.httpPort || cfg.snowluma.wsUrl)) {
    const t = 解析端口(cfg.snowluma.httpUrl || ('http://127.0.0.1:' + (cfg.snowluma.webuiPort || 3000)))
    if (t) 目标.push({ name: 'SnowLuma', ...t, target: cfg.snowluma.httpUrl || '' })
  }
  const 声 = cfg && cfg.socialV2 && cfg.socialV2.voice
  if (声) {
    const base = (声.tts && 声.tts.baseUrl) || (声.endpoints && (声.endpoints.cloud || 声.endpoints.local))
    const t = 解析端口(base)
    if (t) 目标.push({ name: '语音服务', ...t, target: base })
  }
  if (cfg && 数(cfg.consolePort) > 0) {
    目标.push({ name: 'SurfCore 控制台', host: '127.0.0.1', port: 数(cfg.consolePort), label: '', target: ':' + cfg.consolePort })
  }
  const 结果 = []
  for (const t of 目标) {
    const r = await 探(t)
    结果.push({ name: t.name, target: t.target || t.host + ':' + t.port, ok: r.ok, ms: r.ms })
  }
  return 结果
}

// ── 组装 ───────────────────────────────────────────────

async function 造快照(config) {
  const 现在 = Date.now()
  const 日 = 今日串(现在)
  const 起点 = 今日零点(现在)

  const 缓 = 读会话缓存()
  const 按id = new Map(缓.map((s) => [s.id, s]))
  const sc = 读SurfCore(config)

  // 今天动了哪些会话、各花多少
  //
  // 有 SurfCore：直接用它的 dayCost（跟账本一分不差）。
  // 没有：自己去解压今天的会话事件，按 usage 折价 —— 这时候只能叫估算。
  const 今日表 = new Map()
  let 今日
  if (sc.usage) {
    for (const [id, 分] of Object.entries(sc.按会话)) 今日表.set(id, 分)
    const 会话数 = 今日表.size
    今日 = {
      cost: sc.cost,
      tokens: sc.tokens,
      costKind: 'surfcore',
      sessions: 会话数,
      turns: 0,
      bySource: sc.分来源,
      limit: sc.上限,
    }
  } else {
    const 扫 = 扫今日会话(起点)
    let tokens = 0
    let cost = 0
    let turns = 0
    for (const [p, v] of Object.entries(扫.files)) {
      const id = 会话id来自路径(p)
      if (!id) continue
      const c = 折钱(v)
      今日表.set(id, { cost: c, tokens: 数(v.tokens), category: 'other', turns: 数(v.turns), model: '', lastAt: 0 })
      tokens += 数(v.tokens)
      cost += c
      turns += 数(v.turns)
    }
    今日 = {
      cost,
      tokens,
      costKind: 'estimate',
      sessions: 今日表.size,
      turns,
      bySource: null,
      limit: null,
    }
  }

  // 会话排行：只排「今天花过钱 / 动过」的，不把几个月前的会话摊出来
  const 对话名 = (id) => {
    const 键 = sc.对话[id]
    if (!键) return ''
    if (键.startsWith('group:')) return '群 ' + 键.slice(6)
    if (键.startsWith('private:')) return '私聊 ' + 键.slice(8)
    return 键
  }
  // 起名：能认的优先 —— 群/私聊对照 > DSH 自己存的标题 > 首问 > 工作目录尾名 > 会话号
  const 起名 = (s, id) => {
    const 群 = 对话名(id)
    if (群) return 群
    if (s && s.title) return s.title
    const q = s && s.首问 ? String(s.首问).replace(/[…\s]+$/, '').trim() : ''
    if (q.length >= 8) return q.slice(0, 44)
    const 短 = String((s && s.cwd) || '').split(/[\\/]/).filter(Boolean).pop() || ''
    if (短) return 短
    return '会话 ' + String(id).replace(/^session-/, '').slice(0, 8)
  }
  const 排行 = []
  for (const [id, 分] of 今日表.entries()) {
    if (!(分.cost > 0 || 分.tokens > 0)) continue
    const s = 按id.get(id)
    排行.push({
      id,
      title: 起名(s, id),
      category: 分.category || 'other',
      cost: 数(分.cost),
      tokens: 数(分.tokens),
      turns: 分.turns || (s ? s.turns : 0),
      model: (分 && 分.model) || (s && s.model) || '',
      lastAt: (分 && 分.lastAt) || (s && s.lastAt) || 0,
      preset: (s && s.preset) || (分 && 分.preset) || '',
    })
  }
  排行.sort((a, b) => 数(b.cost) - 数(a.cost) || b.tokens - a.tokens)

  const 服务 = await 探服务(sc.cfg)

  return {
    ok: true,
    at: 现在,
    day: 日,
    sources: {
      dsh: 缓.length > 0,
      dshScan: { hit: 0, read: 0 },
      surfcore: { on: sc.on, usage: sc.usage, social: sc.social, log: sc.log, core: sc.核 },
      health: 服务.length > 0,
    },
    今日,
    排行,
    会话们: sc.会话,
    服务,
    错误: sc.错误,
  }
}

function 回JSON(res, 码, 体) {
  const 文 = JSON.stringify(体)
  res.writeHead(码, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(文),
  })
  res.end(文)
}

// ── 演示数据（只为截图 / 录视频用）────────────────────
//
// 三种打开方式，按顺序：apply 配置里 { demo: true }、环境变量 WHALE_LEDGER_DEMO=1、
// 或者 ${DSH_HOME}/whale-ledger/demo.json 存在（仓库里 docs/demo.json 就是一份）。
// 演示模式完全不读真实数据，面板右上角会标「演示数据」。
function 读演示(配置) {
  if (!(配置 && 配置.demo) && String(process.env.WHALE_LEDGER_DEMO || '') !== '1') {
    if (!existsSync(join(数据目录, 'demo.json'))) return null
  }
  const o = 读JSON(join(数据目录, 'demo.json')) || 读JSON(join(数据目录, 'demo.json.example'))
  if (!o || typeof o !== 'object') return null
  // 演示数据里的时间写的是 0，这里按位置摊成「几分钟前」，免得整屏都是「—」
  const 甲 = Date.now()
  if (Array.isArray(o.排行)) {
    o.排行 = o.排行.map((s, i) => ({ ...s, lastAt: 数(s.lastAt) > 0 ? s.lastAt : 甲 - (i * 17 + 6) * 60000 }))
  }
  if (Array.isArray(o.会话们)) {
    o.会话们 = o.会话们.map((c, i) => ({
      ...c,
      lastReplyAt: 数(c.lastReplyAt) > 0 ? c.lastReplyAt : 甲 - (i * 53 + 9) * 60000,
    }))
  }
  return { ...o, ok: true, at: 甲, day: o.day || 今日串(), demo: true }
}

export function apply(ctx, 配置 = {}) {
  // 快照缓存放在 apply 里：每个插件实例一份，
  // 免得同一进程里换了配置（或测试里 repeat apply）还吃到上一份。
  let 快照 = null
  let 快照时刻 = 0
  let 正在造 = null

  try {
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/dsh-whale-ledger',
        handler: async (req, res) => {
          try {
            const 址 = new URL(req.url || '/', 'http://127.0.0.1')
            let 径 = 址.pathname
            try {
              径 = decodeURIComponent(径)
            } catch {}
            if (径 === '/dsh-whale-ledger/snapshot') {
              const 演 = 读演示(配置)
              if (演) return 回JSON(res, 200, 演)
              const 鲜 = 址.searchParams.get('fresh') === '1'
              if (!鲜 && 快照 && Date.now() - 快照时刻 < 15000) return 回JSON(res, 200, { ...快照, cached: true })
              // 同时来好几个请求时只算一遍
              if (!正在造) {
                正在造 = 造快照(配置)
                  .then((体) => {
                    快照 = 体
                    快照时刻 = Date.now()
                    return 体
                  })
                  .finally(() => {
                    正在造 = null
                  })
              }
              const 体 = await 正在造
              return 回JSON(res, 200, 体)
            }
            if (径 === '/dsh-whale-ledger/ping') return 回JSON(res, 200, { ok: true, at: Date.now() })
            return 回JSON(res, 404, { ok: false, error: '没有这个路口' })
          } catch (e) {
            // 这里绝不能把异常抛回宿主：读不到数据是常态，不是事故。
            try {
              return 回JSON(res, 500, { ok: false, error: String((e && e.message) || e) })
            } catch {
              try {
                res.end()
              } catch {}
            }
          }
        },
      }),
    )
  } catch (e) {
    // 挂不上就静静待着，别拖累 DSH 启动
    try {
      console.error('[whale-ledger] 挂载失败：', (e && e.message) || e)
    } catch {}
  }
}
