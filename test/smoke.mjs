// 冒烟测试：不启 DSH，直接把宿主半边挂到一个假 ctx 上，问它要一次快照。
//
// 用法：node test/smoke.mjs
//
// 验的事：
//   1. apply() 不抛、注册了 /dsh-whale-ledger 前缀
//   2. 快照能出（ok:true），今日数字与 token-usage-daily.json 一分不差
//   3. 按会话分账加起来等于总额
//   4. 关掉 SurfCore（noSurfcore）也不报错，退化成「只有 DSH 自己 + 估算」

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const 家 = process.env.DSH_HOME || join(homedir(), '.dsh')

const 模块 = await import('../index.js')

function 假宿主() {
  let 挂的 = null
  return {
    ctx: {
      effect(fn) {
        const 收 = fn()
        return () => {
          if (typeof 收 === 'function') 收()
        }
      },
      webServer: {
        register(规格) {
          挂的 = 规格
        },
      },
    },
    取: () => 挂的,
  }
}

async function 问(规格, 路) {
  const 块 = []
  const res = {
    writeHead(码, 头) {
      this.码 = 码
      this.头 = 头
    },
    end(体) {
      if (体) 块.push(Buffer.from(体))
    },
  }
  await 规格.handler({ url: 路, method: 'GET' }, res)
  const 文 = Buffer.concat(块).toString('utf8')
  return { 码: res.码, 体: 文 ? JSON.parse(文) : null }
}

let 失败 = 0
function 断言(名, 条件, 备注 = '') {
  if (条件) {
    console.log('  ✓ ' + 名)
  } else {
    失败++
    console.log('  ✗ ' + 名 + (备注 ? ' — ' + 备注 : ''))
  }
}

// ── 1. 全量（本机有 SurfCore）──────────────────────────

console.log('全量模式：')
const a = 假宿主()
模块.apply(a.ctx, {})
const 规格 = a.取()
断言('注册了前缀路由', Boolean(规格 && 规格.kind === 'prefix' && 规格.path === '/dsh-whale-ledger'))

const r = await 问(规格, '/dsh-whale-ledger/snapshot')
断言('HTTP 200', r.码 === 200, String(r.码))
断言('ok:true', r.体 && r.体.ok === true)
断言('今日里有金额', r.体 && r.体.今日 && Number.isFinite(r.体.今日.cost))
断言('排行是数组', Array.isArray(r.体 && r.体.排行))

const 日文件 = join(家, 'surfcore', 'token-usage-daily.json')
let 日 = null
try {
  日 = JSON.parse(readFileSync(日文件, 'utf8'))
} catch {}

if (日 && r.体.sources.surfcore.usage) {
  断言(
    '今日总花费与 token-usage-daily.json 一致',
    Math.abs(Number(r.体.今日.cost) - Number(日.total.cost)) < 1e-9,
    `${r.体.今日.cost} vs ${日.total.cost}`,
  )
  断言(
    '今日总 token 一致',
    Number(r.体.今日.tokens) === Number(日.total.tokens),
    `${r.体.今日.tokens} vs ${日.total.tokens}`,
  )
  const 加总 = r.体.排行.reduce((s, x) => s + (Number(x.cost) || 0), 0)
  断言('按会话分账加起来等于总额', Math.abs(加总 - Number(日.total.cost)) < 1e-6, `${加总} vs ${日.total.cost}`)
  断言('上限读到了', Boolean(r.体.今日.limit && r.体.今日.limit.daily > 0))
} else {
  console.log('  · 这台机器没有 SurfCore 账本，跳过金额比对')
}

console.log('  · 会话 ' + (r.体.排行 || []).length + ' 条 · 醒着 ' + (r.体.会话们 || []).length + ' 个 · 服务 ' + (r.体.服务 || []).length + ' 个 · 错误 ' + (r.体.错误 || []).length + ' 条')

// ── 2. 降级（关掉 SurfCore）──────────────────────────────

console.log('降级模式（关掉 SurfCore）：')
const b = 假宿主()
模块.apply(b.ctx, { noSurfcore: true })
const r2 = await 问(b.取(), '/dsh-whale-ledger/snapshot')
断言('降级后仍然 200', r2.码 === 200, String(r2.码))
断言('降级后 ok:true', r2.体 && r2.体.ok === true)
断言('SurfCore 标记为未接通', r2.体.sources.surfcore.on === false)
断言('金额退化成估算', r2.体.今日.costKind === 'estimate')
断言('没有额度块', r2.体.今日.limit === null)
断言('藏起「谁醒着」', (r2.体.会话们 || []).length === 0)
断言('数字仍是数字', Number.isFinite(r2.体.今日.cost) && Number.isFinite(r2.体.今日.tokens))
console.log('  · 估算今日 ' + r2.体.今日.tokens + ' token · ' + r2.体.今日.sessions + ' 个会话')

// ── 3. 错误路径也不炸 ───────────────────────────────────

const r3 = await 问(规格, '/dsh-whale-ledger/nope')
断言('未知路口 404', r3.码 === 404)
const r4 = await 问(规格, '/dsh-whale-ledger/ping')
断言('ping 活着', r4.码 === 200 && r4.体.ok === true)

console.log(失败 ? `\n${失败} 条没过` : '\n全过')
process.exit(失败 ? 1 : 0)
