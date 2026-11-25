// dsh-whale-ledger · 网页半边
//
// 一屏四块：
//   ① 今日（花了多少 / 还剩多少额度）
//   ② 会话排行（谁花得多）
//   ③ 谁醒着（潜水 / 活跃 / 沉睡 / 暂停）
//   ④ 服务健康 + 最近三条错误
//
// 规则：后端说哪块没有（sources），这块就不画 —— 不摆空面板、不报错。
// 只读。

window.__ModuleLoader__.load({
  id: 'dsh-whale-ledger',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState, useCallback } = React

    // 关面板：DSH 的布局服务里 selectPanel(null) = 回到当前会话（不换会话）。
    // 由 apply() 装进来；拿不到就退化成「什么也不做」，绝不抛。
    let 回会话 = () => false

    // ── 小工具 ────────────────────────────────────────

    const 钱 = (v) =>
      v === null || v === undefined || !Number.isFinite(Number(v))
        ? '—'
        : '¥' + Number(v).toFixed(2)

    function 量(n) {
      const v = Number(n) || 0
      if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 亿'
      if (v >= 1e4) return (v / 1e4).toFixed(v >= 1e6 ? 0 : 1) + ' 万'
      return String(Math.round(v))
    }

    function 久(时) {
      if (!时) return '—'
      const 差 = Date.now() - Number(时)
      if (差 < 0) return '刚刚'
      const 分 = Math.floor(差 / 60000)
      if (分 < 1) return '刚刚'
      if (分 < 60) return 分 + ' 分钟前'
      const 小时 = Math.floor(分 / 60)
      if (小时 < 24) return 小时 + ' 小时前'
      const 天 = Math.floor(小时 / 24)
      if (天 < 30) return 天 + ' 天前'
      return Math.floor(天 / 30) + ' 个月前'
    }

    const 来源名 = { qq: 'QQ', bili: 'B 站', other: '其他', private: '私聊', group: '群' }
    const 色 = {
      qq: '#4fb0ff',
      bili: '#ff7ba8',
      other: '#8f9bb3',
    }

    const 态表 = {
      active: { 文: '活跃', 色: '#48d6a4', 底: 'rgba(72,214,164,0.14)' },
      diving: { 文: '潜水', 色: '#5aa8ff', 底: 'rgba(90,168,255,0.14)' },
      sleeping: { 文: '沉睡', 色: '#8b95ad', 底: 'rgba(139,149,173,0.14)' },
      suspended: { 文: '暂停', 色: '#f0b45a', 底: 'rgba(240,180,90,0.14)' },
    }

    // ── 图标 ──────────────────────────────────────────

    function 图标(props) {
      const 尺 = (props && props.size) || 18
      const 亮 = props && props.active
      // 一头侧面的鲸鱼：背弧 + 尾巴 + 喷的一小撮水
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 尺, height: 尺, 'aria-hidden': true, style: { display: 'block' } },
        h('path', {
          d: 'M3.2 14.6c0-3.5 3.1-6.1 7-6.1 2.3 0 4.1.8 5.4 2l1.6-2.1 1.9 3.3c.6 1.1.3 2.4-.8 3-1.1.6-3.2 1.1-5.9 1.1-4.7 0-9.2-.4-9.2-1.2z',
          fill: 'currentColor',
          opacity: 亮 ? 0.95 : 0.72,
        }),
        h('circle', { cx: 7.4, cy: 12.6, r: 0.72, fill: '#0b1220', opacity: 亮 ? 0.9 : 0.65 }),
        h('path', {
          d: 'M9.6 6.4c.5-1.1 1.5-1.9 2.6-2.2M12.4 6.1c.6-.8 1.4-1.3 2.4-1.4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.1,
          strokeLinecap: 'round',
          opacity: 亮 ? 0.75 : 0.45,
        }),
      )
    }

    // ── 样式常量 ──────────────────────────────────────

    const 面板 = {
      background: 'linear-gradient(160deg, rgba(19,28,48,0.72), rgba(11,17,31,0.6))',
      border: '1px solid rgba(150,182,235,0.10)',
      borderRadius: 14,
      padding: '15px 16px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
    }
    const 小标 = {
      fontSize: 10.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: 'rgba(190,208,238,0.42)',
      marginBottom: 10,
    }
    const 数式 = { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum"' }
    const 行 = { display: 'flex', alignItems: 'center', gap: 10 }

    function 标签(文, 色值, 底) {
      return h(
        'span',
        {
          style: {
            fontSize: 10.5,
            padding: '2px 7px',
            borderRadius: 6,
            color: 色值,
            background: 底,
            lineHeight: 1.5,
            flex: 'none',
          },
        },
        文,
      )
    }

    function 条({ 值, 总, 色: c }) {
      const p = 总 > 0 ? Math.max(0, Math.min(1, 值 / 总)) : 0
      return h(
        'div',
        { style: { height: 4, borderRadius: 3, background: 'rgba(140,170,220,0.10)', overflow: 'hidden' } },
        h('div', { style: { width: (p * 100).toFixed(1) + '%', height: '100%', background: c, borderRadius: 3 } }),
      )
    }

    // ── 主体 ──────────────────────────────────────────

    function 鲸账本() {
      const [数据, 设数据] = useState(null)
      const [错, 设错] = useState('')
      const [读中, 设读中] = useState(false)
      const 活 = useRef(true)

      const 拉 = useCallback(async (鲜) => {
        try {
          设读中(true)
          const r = await fetch('/dsh-whale-ledger/snapshot' + (鲜 ? '?fresh=1' : ''), { cache: 'no-store' })
          if (!r.ok) throw new Error('宿主没回应（' + r.status + '）')
          const j = await r.json()
          if (!活.current) return
          设数据(j)
          设错('')
        } catch (e) {
          if (活.current) 设错(String((e && e.message) || e))
        } finally {
          if (活.current) 设读中(false)
        }
      }, [])

      useEffect(() => {
        活.current = true
        拉(false)
        const 表 = setInterval(() => {
          if (!document.hidden) 拉(false)
        }, 20000)
        // Esc 也能退出去 —— 面板铺满主区时，人第一反应就是按 Esc
        const 键 = (e) => {
          if (e.key === 'Escape') 回会话()
        }
        document.addEventListener('keydown', 键)
        return () => {
          活.current = false
          clearInterval(表)
          document.removeEventListener('keydown', 键)
        }
      }, [拉])

      if (!数据) {
        return h(
          'div',
          {
            style: {
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 12,
              color: 'rgba(200,216,242,0.5)',
              fontSize: 12.5,
            },
          },
          h('div', { style: { opacity: 0.55 } }, '鲸账本正在翻账…'),
          错 ? h('div', { style: { color: '#ff9b8a', fontSize: 11.5, maxWidth: 460, textAlign: 'center' } }, 错) : null,
        )
      }

      const 今日 = 今日数据(数据)
      const 排行 = Array.isArray(数据.排行) ? 数据.排行 : []
      const 会话们 = Array.isArray(数据.会话们) ? 数据.会话们 : []
      const 服务 = Array.isArray(数据.服务) ? 数据.服务 : []
      const 错误 = Array.isArray(数据.错误) ? 数据.错误 : []
      const 源 = 数据.sources || {}
      const 有surf = Boolean(源.surfcore && 源.surfcore.on)
      const 有来源 = Array.isArray(今日.bySource) && 今日.bySource.length
      const 最大 = 排行.length ? Math.max(...排行.map((x) => Number(x.cost) || 0), 1) : 1

      return h(
        'div',
        {
          style: {
            position: 'absolute',
            // 只占侧栏右边那块，绝不压到侧栏上 —— 压上去人就点不了别的页面了（第一版就栽在这）。
            left: 'clamp(20px, 29%, 620px)',
            top: 0,
            right: 0,
            bottom: 0,
            overflow: 'auto',
            // 主区铺满整窗时壁纸和对话会透上来，所以底色要自己给
            background: 'linear-gradient(168deg, #0a1020 0%, #070b14 52%, #0a0f1b 100%)',
            padding: '54px 26px 30px 18px',
            color: '#e6eeff',
            fontSize: 12.5,
            fontFamily: '"PingFang SC","Microsoft YaHei",system-ui,sans-serif',
          },
        },

        // 顶栏
        h(
          'div',
          { style: { ...行, justifyContent: 'space-between', marginBottom: 16 } },
          h(
            'div',
            { style: 行 },
            h('div', { style: { color: '#7fc4ff', opacity: 0.9, display: 'flex' } }, 图标({ size: 20, active: true })),
            h('div', { style: { fontSize: 14.5, fontWeight: 600, letterSpacing: 0.4 } }, '鲸账本'),
            h('span', { style: { fontSize: 10.5, opacity: 0.32 } }, 'WHALE LEDGER'),
            h('span', { style: { fontSize: 10.5, opacity: 0.28, marginLeft: 4 } }, 数据.day || ''),
          ),
          h(
            'div',
            { style: { ...行, gap: 10 } },
            今日.costKind === 'estimate'
              ? h('span', { style: { fontSize: 10.5, opacity: 0.4 } }, '未检测到 SurfCore · 金额为估算')
              : null,
            h(
              'button',
              {
                type: 'button',
                onClick: () => 回会话(),
                title: '回到当前会话（Esc）',
                style: {
                  fontSize: 11,
                  color: 'rgba(226,238,255,0.82)',
                  background: 'rgba(150,190,255,0.14)',
                  border: '1px solid rgba(160,200,255,0.26)',
                  borderRadius: 7,
                  padding: '4px 10px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                },
              },
              '✕ 回会话',
            ),
            h(
              'button',
              {
                type: 'button',
                onClick: () => 拉(true),
                disabled: 读中,
                style: {
                  fontSize: 11,
                  color: 'rgba(220,234,255,0.75)',
                  background: 'rgba(120,160,220,0.10)',
                  border: '1px solid rgba(140,180,240,0.18)',
                  borderRadius: 7,
                  padding: '4px 10px',
                  cursor: 读中 ? 'default' : 'pointer',
                  opacity: 读中 ? 0.5 : 1,
                  fontFamily: 'inherit',
                },
              },
              读中 ? '翻账中' : '刷新',
            ),
          ),
        ),

        错 ? h('div', { style: { fontSize: 11.5, color: '#ffb4a2', marginBottom: 12 } }, 错) : null,

        // ① 今日
        h(
          'div',
          {
            style: {
              ...面板,
              marginBottom: 14,
              background: 'linear-gradient(135deg, rgba(28,52,92,0.55), rgba(14,22,40,0.55))',
              border: '1px solid rgba(120,178,255,0.16)',
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'flex-end', gap: 26, flexWrap: 'wrap' } },
            h(
              'div',
              null,
              h('div', { style: { ...小标, marginBottom: 4 } }, '今天花了'),
              h(
                'div',
                { style: { ...行, gap: 8, alignItems: 'baseline' } },
                h(
                  'div',
                  { style: { fontSize: 34, fontWeight: 300, letterSpacing: -0.5, ...数式, lineHeight: 1.1 } },
                  钱(今日.cost),
                ),
                今日.costKind === 'estimate'
                  ? h('span', { style: { fontSize: 10.5, opacity: 0.35 } }, '估算')
                  : null,
              ),
              h(
                'div',
                { style: { fontSize: 11, opacity: 0.42, marginTop: 3, ...数式 } },
                量(今日.tokens) + ' tokens' + (今日.turns ? ' · ' + 今日.turns + ' 轮' : '') + (今日.sessions ? ' · ' + 今日.sessions + ' 个会话' : ''),
              ),
            ),
            今日.limit
              ? h(
                  'div',
                  { style: { flex: '1 1 240px', minWidth: 200, maxWidth: 380 } },
                  h(
                    'div',
                    { style: { ...行, justifyContent: 'space-between', fontSize: 10.5, marginBottom: 5 } },
                    h('span', { style: { opacity: 0.42 } }, '今日额度'),
                    h(
                      'span',
                      { style: { ...数式, opacity: 0.7 } },
                      钱(今日.cost) + ' / ' + 钱(今日.limit.daily),
                    ),
                  ),
                  h(条, {
                    值: 今日.cost,
                    总: 今日.limit.daily,
                    色: 今日.cost / 今日.limit.daily > 0.85 ? '#ff8a72' : '#5ea8ff',
                  }),
                  h(
                    'div',
                    { style: { ...行, justifyContent: 'space-between', fontSize: 10, marginTop: 5, opacity: 0.38 } },
                    h('span', null, '还剩 ' + 钱(今日.limit.left)),
                    今日.limit.perGroup ? h('span', null, '每群上限 ' + 钱(今日.limit.perGroup)) : null,
                  ),
                )
              : null,
          ),
          有来源
            ? h(
                'div',
                { style: { display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' } },
                ...今日.bySource.map((s) =>
                  h(
                    'div',
                    {
                      key: s.key,
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        padding: '5px 10px',
                        borderRadius: 8,
                        background: 'rgba(255,255,255,0.028)',
                        border: '1px solid rgba(150,182,235,0.08)',
                      },
                    },
                    h('i', {
                      style: {
                        width: 6,
                        height: 6,
                        borderRadius: 6,
                        background: 色[s.key] || '#8f9bb3',
                        boxShadow: '0 0 8px ' + (色[s.key] || '#8f9bb3'),
                      },
                    }),
                    h('span', { style: { fontSize: 11, opacity: 0.62 } }, 来源名[s.key] || s.key),
                    h('span', { style: { fontSize: 11.5, ...数式, opacity: 0.92 } }, 钱(s.cost)),
                    h('span', { style: { fontSize: 10, opacity: 0.3, ...数式 } }, 量(s.tokens)),
                  ),
                ),
              )
            : null,
        ),

        // ② + ③ 两列
        h(
          'div',
          {
            style: {
              display: 'grid',
              gridTemplateColumns: 会话们.length ? 'minmax(0, 1.55fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
              gap: 14,
              marginBottom: 14,
              alignItems: 'start',
            },
          },
          // 会话排行
          h(
            'div',
            { style: 面板 },
            h(
              'div',
              { style: { ...行, justifyContent: 'space-between', marginBottom: 10 } },
              h('div', { style: { ...小标, marginBottom: 0 } }, 有surf ? '会话排行 · 今日账单' : '会话排行 · 累计 token'),
              h('span', { style: { fontSize: 10, opacity: 0.28 } }, 排行.length + ' 个'),
            ),
            排行.length === 0
              ? h('div', { style: { fontSize: 11.5, opacity: 0.35, padding: '10px 0' } }, '今天还没有会话花过钱。')
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                  ...排行.slice(0, 12).map((s, i) => {
                    const 本值 = Number(s.cost) || 0
                    return h(
                      'div',
                      {
                        key: s.id,
                        style: {
                          display: 'grid',
                          gridTemplateColumns: '18px minmax(0,1fr) 64px 62px 52px',
                          alignItems: 'center',
                          gap: 9,
                          padding: '7px 6px',
                          borderRadius: 8,
                          borderTop: i === 0 ? 'none' : '1px solid rgba(140,170,230,0.055)',
                        },
                      },
                      h('span', { style: { fontSize: 10, opacity: 0.22, ...数式 } }, String(i + 1)),
                      h(
                        'div',
                        { style: { minWidth: 0 } },
                        h(
                          'div',
                          { style: { ...行, gap: 6 } },
                          h('i', {
                            style: {
                              width: 5,
                              height: 5,
                              borderRadius: 5,
                              flex: 'none',
                              background: 色[s.category] || '#8f9bb3',
                            },
                          }),
                          h(
                            'span',
                            {
                              style: {
                                fontSize: 12,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                opacity: 0.9,
                              },
                              title: s.title,
                            },
                            s.title,
                          ),
                        ),
                        h('div', { style: { fontSize: 10, opacity: 0.3, marginTop: 2, ...数式 } },
                          (s.turns ? s.turns + ' 轮 · ' : '') + 量(s.tokens) + ' token' + (s.model ? ' · ' + s.model : '')),
                      ),
                      h(
                        'div',
                        { style: { textAlign: 'right' } },
                        h('div', { style: { fontSize: 12, ...数式, opacity: 0.95 } }, s.cost === null ? '—' : 钱(s.cost)),
                        h('div', { style: { fontSize: 9.5, opacity: 0.28 } }, 久(s.lastAt)),
                      ),
                      h('div', { style: { gridColumn: 'span 1' } }, h(条, { 值: 本值, 总: 最大, 色: 色[s.category] || '#5ea8ff' })),
                      h('span', { style: { fontSize: 9.5, opacity: 0.24, textAlign: 'right' } }, 来源名[s.category] || ''),
                    )
                  }),
                ),
          ),

          // 谁醒着
          会话们.length
            ? h(
                'div',
                { style: 面板 },
                h(
                  'div',
                  { style: { ...行, justifyContent: 'space-between', marginBottom: 10 } },
                  h('div', { style: { ...小标, marginBottom: 0 } }, '谁醒着'),
                  h(
                    'span',
                    { style: { fontSize: 10, opacity: 0.28, ...数式 } },
                    '活跃 ' + 会话们.filter((c) => c.state === 'active').length + ' / ' + 会话们.length,
                  ),
                ),
                h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                  ...会话们
                    .slice()
                    .sort((a, b) => 序(b) - 序(a))
                    .map((c) => {
                      const 态 = 态表[c.state] || 态表.diving
                      return h(
                        'div',
                        {
                          key: c.key,
                          style: {
                            display: 'grid',
                            gridTemplateColumns: 'minmax(0,1fr) auto',
                            gap: 8,
                            alignItems: 'center',
                            padding: '6px 5px',
                            borderRadius: 7,
                          },
                        },
                        h(
                          'div',
                          { style: { ...行, minWidth: 0, gap: 7 } },
                          标签(态.文, 态.色, 态.底),
                          h(
                            'span',
                            {
                              style: {
                                fontSize: 11.5,
                                opacity: 0.82,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              },
                            },
                            c.label,
                          ),
                          c.unread > 0
                            ? h('span', { style: { fontSize: 9.5, color: '#ffd28a', opacity: 0.85, flex: 'none' } }, c.unread + ' 未读')
                            : null,
                        ),
                        h(
                          'div',
                          { style: { textAlign: 'right', fontSize: 9.5, opacity: 0.3, ...数式 } },
                          c.lastReplyAt ? 久(c.lastReplyAt) + '前说过' : '没说过话',
                        ),
                      )
                    }),
                ),
              )
            : null,
        ),

        // ④ 服务健康
        服务.length
          ? h(
              'div',
              { ...面板, marginBottom: 14 },
              h(
                'div',
                { style: { ...行, justifyContent: 'space-between', marginBottom: 10 } },
                h('div', { style: { ...小标, marginBottom: 0 } }, '服务健康'),
                h(
                  'span',
                  { style: { fontSize: 10, opacity: 0.28 } },
                  服务.filter((s) => s.ok).length + ' / ' + 服务.length + ' 在线',
                ),
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
                ...服务.map((s) =>
                  h(
                    'div',
                    {
                      key: s.name,
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '7px 11px',
                        borderRadius: 9,
                        background: s.ok ? 'rgba(72,214,164,0.06)' : 'rgba(255,120,100,0.06)',
                        border: '1px solid ' + (s.ok ? 'rgba(72,214,164,0.16)' : 'rgba(255,120,100,0.18)'),
                      },
                    },
                    h('i', {
                      style: {
                        width: 6,
                        height: 6,
                        borderRadius: 6,
                        background: s.ok ? '#48d6a4' : '#ff7f6a',
                        boxShadow: '0 0 8px ' + (s.ok ? '#48d6a4' : '#ff7f6a'),
                      },
                    }),
                    h('span', { style: { fontSize: 11.5, opacity: 0.85 } }, s.name),
                    h('span', { style: { fontSize: 10, opacity: 0.3, ...数式 } }, s.ok ? s.ms + 'ms' : '不通'),
                  ),
                ),
              ),
            )
          : null,

        // 最近错误
        错误.length
          ? h(
              'div',
              { ...面板 },
              h('div', { style: { ...小标 } }, '最近三条错误'),
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                ...错误.map((e, i) =>
                  h(
                    'div',
                    {
                      key: i,
                      style: {
                        fontSize: 11,
                        lineHeight: 1.7,
                        color: 'rgba(255,178,162,0.82)',
                        background: 'rgba(255,120,100,0.045)',
                        border: '1px solid rgba(255,120,100,0.10)',
                        borderRadius: 8,
                        padding: '7px 10px',
                        wordBreak: 'break-all',
                        ...数式,
                      },
                    },
                    e.text,
                  ),
                ),
              ),
            )
          : null,

        // 底部：这一屏是怎么来的
        h(
          'div',
          { style: { marginTop: 14, fontSize: 9.5, opacity: 0.24, lineHeight: 1.8 } },
          '数据源：' +
            ['DSH 会话' + (源.dsh ? ' ✓' : ' —')]
              .concat(有surf ? ['SurfCore 账本 ✓'] : ['SurfCore 未检测到'])
              .concat(服务.length ? ['端口探测 ✓'] : ['端口探测 —'])
              .join(' · ') +
            '　只读，不写任何东西',
        ),
      )
    }

    function 序(c) {
      return c.state === 'active' ? 4 : c.state === 'suspended' ? 3 : c.state === 'diving' ? 2 : 1
    }

    function 今日数据(d) {
      const t = (d && d.今日) || {}
      return {
        cost: t.cost === null || t.cost === undefined ? null : Number(t.cost),
        tokens: Number(t.tokens) || 0,
        turns: Number(t.turns) || 0,
        sessions: Number(t.sessions) || 0,
        costKind: t.costKind || 'estimate',
        bySource: t.bySource || null,
        limit: t.limit || null,
      }
    }

    // 渲染炸了也别白屏：把错误摊出来，能直接看出是哪一行。
    class 兜错 extends React.Component {
      constructor(p) {
        super(p)
        this.state = { 错: null }
      }
      static getDerivedStateFromError(e) {
        return { 错: e }
      }
      componentDidCatch(e, info) {
        try {
          console.error('[鲸账本]', e, info)
        } catch {}
      }
      render() {
        if (this.state.错) {
          const e = this.state.错
          return h(
            'div',
            { style: { padding: 20, color: '#ff9a9a', fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap' } },
            '鲸账本渲染出错：' + String((e && e.message) || e) + '\n\n' + String((e && e.stack) || '').slice(0, 700),
          )
        }
        return this.props.children
      }
    }

    const 页 = (props) => h(兜错, null, h(鲸账本, props))

    return {
      inject: ['slots'],
      apply(ctx) {
        // DSH 的布局服务：selectPanel(null) 回到当前会话，不换会话、不丢草稿。
        // 拿不到（旧版本 / 服务名变了）就什么都不做，按钮点了不炸。
        回会话 = () => {
          let 布局 = null
          try {
            布局 = (ctx.get && ctx.get('layout')) || ctx.layout || null
          } catch {
            布局 = null
          }
          if (!布局 || typeof 布局.selectPanel !== 'function') return false
          try {
            布局.selectPanel(null)
            return true
          } catch (e) {
            try {
              console.warn('[鲸账本] 回会话失败：', (e && e.message) || e)
            } catch {}
            return false
          }
        }

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'whale-ledger', order: 21, label: () => '鲸账本' },
            图标,
          ),
        )
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'whale-ledger' }, 页))
      },
    }
  },
})
