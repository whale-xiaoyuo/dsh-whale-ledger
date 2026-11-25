# v0.1.0

第一版。一块能自己接数据源的花费/健康面板。

## 能看到什么

- **今日**：今天花了多少、多少 token、几个会话；有每日上限时显示额度条和剩余
- **会话排行**：今天每个会话花多少、几轮、多少 token，按金额排
- **谁醒着**：每个群 / 私聊现在是活跃、潜水、沉睡还是被暂停，未读数、上次开口时间
- **服务健康**：SnowLuma、语音服务、控制台端口通不通、耗时多少毫秒
- **最近三条错误**：`bridge.log` 里最近的错误行

## 数据源可插拔

| 数据源 | 有就用 | 没有就 |
|---|---|---|
| DSH 自己的会话 / token 统计 | 永远在 | —— |
| SurfCore | 今日账单、按会话分账、上限、唤醒状态、错误日志 | 金额退化成估算，隐藏额度条、分账金额、「谁醒着」 |
| 端口探测 | 服务健康 | 隐藏这块 |

没检测到就整块不显示，不报错、不摆空面板。

## 准

装了 SurfCore 时，「今日总额」等于 `token-usage-daily.json` 里 `total.cost` 的原值，不重算；按会话分账加起来等于这个总额。

## 装

```powershell
node scripts/install.mjs --profile "$env:DSH_HOME\profiles\desktop"
```

重启 DSH。卸载用 `scripts/uninstall.mjs`。

不要用 pnpm：这个 profile 的 node_modules 是 Junction 的，pnpm 会 `ERR_PNPM_UNEXPECTED_VIRTUAL_STORE`。

## 已知

- 面板只占侧栏右边那块（`clamp(20px, 29%, 620px)`）。侧栏特别宽的主题下可能要调这个值。
- 关面板靠 DSH 的布局服务 `selectPanel(null)`；旧版本没有这个服务时，「✕ 回会话」按钮不动作。
