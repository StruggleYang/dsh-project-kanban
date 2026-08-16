// 看板浏览器端渲染冒烟（Node + 真实 React）：加载 lib/client.js 工厂，
// mock 浏览器/插槽环境，用 ReactDOMServer 实际渲染看板视图。
// 技巧：mock React.useState 的第一个调用（board 状态）返回预置数据，
// 使首帧即渲染「含全部 UI 分支」的完整看板（statsBar / filterBar / 卡片 / 表单路径全覆盖）。
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

let handoff = null
global.window = { __ModuleLoader__: { load: (h) => { handoff = h } } }
global.document = {
  querySelector: () => null,
  createElement: () => ({ setAttribute() {}, textContent: '' }),
  head: { appendChild() {} },
}

const NPM_ROOT = '/Users/struy/.npm/_npx/1e7f6d9597241db0/node_modules/'
const requireFromNpm = createRequire(NPM_ROOT + 'react/package.json')
const React = requireFromNpm('react')
const ReactDOMServer = requireFromNpm('react-dom/server')

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const moduleUrl = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(source)
await import(moduleUrl)
if (!handoff) throw new Error('渲染冒烟：未捕获到 __ModuleLoader__.load 注册')

const exportsObj = handoff.factory((spec) => {
  if (spec === 'react') return React
  throw new Error('渲染冒烟：意外 require(' + spec + ')')
})
if (!exportsObj || typeof exportsObj.apply !== 'function') throw new Error('渲染冒烟：factory 未返回插件对象')

let renderFn = null
const slots = {
  register: (opts, fn) => { renderFn = fn; return () => {} },
  inject: (key, cb) => { cb() },
}
const ctx = {
  get: (name) => {
    if (name === 'slots') return slots
    if (name === 'sessions') return { open() {} }
    return undefined
  },
}
exportsObj.apply(ctx)
if (!renderFn) throw new Error('渲染冒烟：apply 未注册渲染函数')

// ---- 预置完整看板数据（覆盖所有 UI 分支）----
const preloadedBoard = {
  columns: [
    { id: 'c1', title: '待办' },
    { id: 'c2', title: '进行中' },
    { id: 'c3', title: '已完成' },
  ],
  cards: [
    { id: 'k1', columnId: 'c1', title: '完整字段卡', note: '备注', label: '功能', priority: 'high', color: '#ff0000', dueDate: '2099-01-01', archived: false, source: { sessionId: 's1', at: '2026-01-01' } },
    { id: 'k2', columnId: 'c1', title: '逾期卡', note: null, label: null, priority: null, color: null, dueDate: '2000-01-01', archived: false, source: null },
    { id: 'k3', columnId: 'c2', title: '已归档卡', note: null, label: '文档', priority: 'low', color: null, dueDate: null, archived: true, source: null },
  ],
}

// ---- mock useState：可开关；开启后第一个调用（board）返回预置数据 ----
const realUseState = React.useState
let mockBoard = false
let useStateCalls = 0
React.useState = function (initial) {
  useStateCalls += 1
  if (mockBoard && useStateCalls === 1) return [preloadedBoard, () => {}]
  return realUseState(initial)
}

const props = {
  sessionId: 's1',
  useWorkspaces: (sel) => sel({ items: [{ workspaceId: 'w1', title: '测试项目', sessionIds: ['s1'] }], recentWorkspaceId: 'w1' }),
}

try {
  // 路径一：board = null（真实环境首帧）——必须渲染加载中而不崩溃
  mockBoard = false
  const loadingHtml = ReactDOMServer.renderToString(renderFn(props))
  if (!loadingHtml.includes('看板加载中')) throw new Error('渲染冒烟：board=null 首帧未显示加载状态（可能崩溃）')

  // 路径二：board 有数据——渲染全部 UI 分支（重置计数器让首个 useState 返回预置数据）
  mockBoard = true
  useStateCalls = 0
  const html = ReactDOMServer.renderToString(renderFn(props))
  // 断言：关键 UI 片段都渲染出来了
  const checks = {
    title: html.includes('项目看板'),
    statsBar: html.includes('共 2 张') || html.includes('共 3 张'),
    filterBar: html.includes('搜索关键词'),
    labelChip: html.includes('功能'),
    priorityBar: html.includes('4px solid'), // 优先级用 borderLeft 色条
    dueDate: html.includes('2099-01-01') && html.includes('已逾期'),
    sourceLink: html.includes('来自会话'),
    archivedAction: html.includes('恢复') && html.includes('彻底删除'),
    archiveStyle: html.includes('kan-card-archived'),
    recycleBin: html.includes('回收站'),
    templateSelect: html.includes('应用模板'),
    undoButton: html.includes('撤销'),
  }
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k)
  console.log(JSON.stringify({ ok: failed.length === 0, failed, useStateCalls }, null, 1))
  process.exit(failed.length > 0 ? 1 : 0)
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String((e && e.stack) || e) }, null, 1))
  process.exit(1)
}
