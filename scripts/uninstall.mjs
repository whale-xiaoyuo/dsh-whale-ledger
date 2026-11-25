// 从 profile 里卸掉：删目录、去掉依赖和 bundle 名单，可选把 package.json 还原成备份。
//
//   node scripts/uninstall.mjs [--profile <profile 目录>] [--restore <备份的 package.json>]
//
// 不带 --restore 就只做「去掉那两处」，其它插件一行不动。

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const 还原 = 取参('restore', '')
const 档 = join(profile, 'package.json')

if (!existsSync(档)) {
  console.error('不是 DSH profile：' + profile)
  process.exit(1)
}

const 目标 = join(profile, 'node_modules', 插件名)
rmSync(目标, { recursive: true, force: true })

if (还原) {
  if (!existsSync(还原)) {
    console.error('备份文件不存在：' + 还原)
    process.exit(1)
  }
  writeFileSync(档, readFileSync(还原, 'utf8'))
  console.log('已还原 package.json：' + 还原)
} else {
  const 包 = JSON.parse(readFileSync(档, 'utf8'))
  if (包.dependencies) delete 包.dependencies[插件名]
  if (包.dsh && 包.dsh.profile && Array.isArray(包.dsh.profile.bundles)) {
    包.dsh.profile.bundles = 包.dsh.profile.bundles.filter((x) => x !== 插件名)
  }
  writeFileSync(档, JSON.stringify(包, null, 2) + '\n')
  console.log('已从 package.json 去掉依赖与 bundle 名单')
}

console.log('卸掉了：' + 目标)
console.log('重启 DSH 后生效。')
