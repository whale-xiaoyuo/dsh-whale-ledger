// 装进一个 DSH profile：把插件目录复制进 node_modules，再把依赖和 bundle 名单补上。
//
//   node scripts/install.mjs [--profile <profile 目录>] [--archive <备份目录>]
//
// 为什么不用 pnpm：这个 profile 的 node_modules 是 Junction 进的，pnpm 会认为
// store 与 virtual-store 不一致，直接 ERR_PNPM_UNEXPECTED_VIRTUAL_STORE。
// 插件没有第三方依赖，复制目录 + 改两行 package.json 就够了。
//
// 改 package.json 之前先备份到 <archive>/dsh-whale-ledger-<时间>/。

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const 这里 = dirname(fileURLToPath(import.meta.url))
const 源 = resolve(这里, '..')
const 自家包 = JSON.parse(readFileSync(join(源, 'package.json'), 'utf8'))
const 插件名 = 自家包.name

function 取参(名, 缺) {
  const i = process.argv.indexOf('--' + 名)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : 缺
}

const 家 = process.env.DSH_HOME || join(homedir(), '.dsh')
const profile = resolve(取参('profile', join(家, 'profiles', 'desktop')))
const 存档根 = resolve(取参('archive', 'F:\\workspace\\archives'))

if (!existsSync(join(profile, 'package.json'))) {
  console.error('这个目录看着不像 DSH profile（没有 package.json）：' + profile)
  process.exit(1)
}

// 1. 备份 profile 的 package.json
const 时 = new Date()
const 标 = [时.getFullYear(), 时.getMonth() + 1, 时.getDate(), 时.getHours(), 时.getMinutes(), 时.getSeconds()]
  .map((n, i) => (i === 0 ? String(n) : String(n).padStart(2, '0')))
  .join('')
const 存档 = join(存档根, `${插件名}-${标}`)
mkdirSync(存档, { recursive: true })
const 档 = join(profile, 'package.json')
const 原文 = readFileSync(档, 'utf8')
writeFileSync(join(存档, 'package.json'), 原文)

// 2. 复制插件目录
const 目标 = join(profile, 'node_modules', 插件名)
rmSync(目标, { recursive: true, force: true })
mkdirSync(dirname(目标), { recursive: true })
cpSync(源, 目标, {
  recursive: true,
  filter: (p) => {
    const n = p.split(/[\\/]/).pop()
    return n !== 'node_modules' && n !== '.git' && n !== 'screenshots' && n !== 'doubao-images'
  },
})

// 3. 补 package.json（依赖 + bundle 名单）
const 包 = JSON.parse(原文)
包.dependencies = 包.dependencies || {}
包.dependencies[插件名] = 自家包.version
包.dsh = 包.dsh || {}
包.dsh.profile = 包.dsh.profile || {}
包.dsh.profile.bundles = Array.isArray(包.dsh.profile.bundles) ? 包.dsh.profile.bundles : []
if (!包.dsh.profile.bundles.includes(插件名)) 包.dsh.profile.bundles.push(插件名)
writeFileSync(档, JSON.stringify(包, null, 2) + '\n')

console.log('装好了：' + 目标)
console.log('依赖：' + 插件名 + '@' + 自家包.version)
console.log('备份：' + join(存档, 'package.json'))
console.log('下一步：重启 DSH（这套插件是启动时挂的，热改不会生效）。')
