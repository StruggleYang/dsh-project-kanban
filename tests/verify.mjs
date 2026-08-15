// dsh-project-kanban 端到端验证（无 LLM key）：安装 → 挂载 → 工具 schema → HTTP 全流程
// 用法：先创建 temp profile（见 scripts/verify.sh），再以 DSH_HOME 指向它运行本脚本
import { o as runProfile } from '@deepseek-ai/dsh/lib/profile-boot-DG5t9aNs.js'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'

const PROFILE = process.env.KANBAN_TEST_PROFILE || 'it'
const PORT = Number(process.env.KANBAN_TEST_PORT || 3199)
const PATCH = process.env.KANBAN_TEST_PATCH // 端口覆盖 overlay 路径

const EXPECTED_TOOLS = [
  'kanban_get', 'kanban_add_card', 'kanban_update_card', 'kanban_delete_card',
  'kanban_move_card', 'kanban_duplicate_card', 'kanban_restore_card', 'kanban_purge_card',
  'kanban_bulk_delete_cards', 'kanban_move_card_to_workspace', 'kanban_undo',
  'kanban_add_column', 'kanban_rename_column', 'kanban_delete_column',
]

const results = { pass: 0, fail: 0, checks: {} }
const check = (name, ok, detail) => {
  results.checks[name] = ok
  if (ok) results.pass += 1
  else { results.fail += 1; results.checks[name + '_detail'] = detail }
}

const { ctx, shutdown } = await runProfile({
  environment: loadLayeredEnv('dsh'),
  profile: PROFILE,
  patchFiles: PATCH ? [PATCH] : [],
  args: [],
})

try {
  await new Promise((r) => setTimeout(r, 3500))
  const tools = ctx.get('tools')
  const names = tools.schemas().map((s) => s.name)
  check('tools.count', names.length >= 14, names.length)
  check('tools.all', EXPECTED_TOOLS.every((n) => names.includes(n)), EXPECTED_TOOLS.filter((n) => !names.includes(n)))

  const post = (method, args) => fetch('http://127.0.0.1:' + PORT + '/api/kanban', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args }),
  }).then((r) => r.json())

  // 字段全流程
  const a = await post('kanban.addCard', { title: '测试卡', label: '功能', priority: 'high', color: '#ff0000', dueDate: '2099-01-01' })
  const card = a.board.cards.find((x) => x.title === '测试卡')
  check('add.fields', card.label === '功能' && card.priority === 'high' && card.color === '#ff0000' && card.dueDate === '2099-01-01', card)

  // 排序
  const b = await post('kanban.addCard', { title: '测试卡2' })
  const c2 = b.board.cards.find((x) => x.title === '测试卡2')
  const moved = await post('kanban.moveCard', { id: c2.id, columnId: card.columnId, toIndex: 0 })
  const order = moved.board.cards.filter((x) => x.columnId === card.columnId).map((x) => x.title)
  check('reorder', order[0] === '测试卡2', order)

  // 更新/复制
  const upd = await post('kanban.updateCard', { id: card.id, label: '缺陷' })
  check('update', upd.board.cards.find((x) => x.id === card.id).label === '缺陷')
  const dup = await post('kanban.duplicateCard', { id: card.id })
  check('duplicate', dup.board.cards.filter((x) => x.title === '测试卡').length === 2)

  // 归档/恢复/彻底删除
  const del = await post('kanban.deleteCard', { id: card.id })
  check('archive.hidden', !del.board.cards.some((x) => x.id === card.id))
  const g2 = await post('kanban.get', { includeArchived: true })
  check('archive.visible', g2.board.cards.find((x) => x.id === card.id)?.archived === true)
  const res = await post('kanban.restoreCard', { id: card.id })
  check('archive.restore', res.board.cards.some((x) => x.id === card.id))
  await post('kanban.purgeCard', { id: card.id })
  const g3 = await post('kanban.get', { includeArchived: true })
  check('archive.purge', !g3.board.cards.some((x) => x.id === card.id))

  // 批量
  const x1 = await post('kanban.addCard', { title: '批量1' })
  const x2 = await post('kanban.addCard', { title: '批量2' })
  const ids = [x1.board.cards.find((c) => c.title === '批量1').id, x2.board.cards.find((c) => c.title === '批量2').id]
  const bl = await post('kanban.bulkSetLabel', { ids, label: '文档' })
  check('bulk.label', bl.board.cards.filter((c) => ids.includes(c.id)).every((c) => c.label === '文档'))
  const bd = await post('kanban.bulkDeleteCards', { ids })
  check('bulk.archive', !bd.board.cards.some((c) => ids.includes(c.id)))

  // 撤销
  const u = await post('kanban.undo', {})
  check('undo', u.undone === true && u.board.cards.some((c) => c.title === '批量1'))

  // 模板
  const t = await post('kanban.applyTemplate', { name: 'dev' })
  const titles = t.board.columns.map((c) => c.title)
  check('template', titles.includes('评审') && titles.includes('待办'), titles)

  // 跨工作区
  const w = await post('kanban.addCard', { title: '跨区', workspaceId: 'ws-test' })
  const wc = w.board.cards.find((c) => c.title === '跨区')
  const mw = await post('kanban.moveCardToWorkspace', { id: wc.id, toWorkspaceId: 'default', workspaceId: 'ws-test' })
  check('crossws.source', !mw.board.cards.some((c) => c.id === wc.id))
  const gd = await post('kanban.get', { workspaceId: 'default' })
  check('crossws.target', gd.board.cards.some((c) => c.id === wc.id && c.columnId === gd.board.columns[0].id))

  // lossless（所有卡片含全部可选键）
  check('lossless', gd.board.cards.every((c) => 'label' in c && 'priority' in c && 'color' in c && 'dueDate' in c && 'archived' in c && 'source' in c))
} catch (e) {
  check('fatal', false, String((e && e.stack) || e))
} finally {
  await shutdown.shutdown()
}

console.log(JSON.stringify({ summary: results.pass + ' passed, ' + results.fail + ' failed', ...results }, null, 1))
process.exit(results.fail > 0 ? 1 : 0)
