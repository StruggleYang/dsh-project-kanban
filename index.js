/**
 * dsh-project-kanban — 官方 bundle 宿主插件
 *
 * 标准 Cordis 函数插件（非动态沙箱版）：named-export name / inject / apply。
 * 通过 dsh.bundle 声明的 cordis.patch.yml 挂载进 profile 组合，用官方流程安装：
 *
 *   dsh plugin --profile <name> add <specifier>
 *
 * 职责（与动态版一致，走标准扩展点）：
 *  - 按工作区（项目）分板：boards 以 workspaceId 为键，每个工作区独立数据
 *  - 经 ctx.fs 持久化到 <workspaceRoot>/kanban-board-<workspaceId>.json
 *  - 经 ctx.tools.register 注册 8 个 kanban_* 模型工具：
 *    Agent 调用时经 exec.agent.session.header.cwd → workspaceRegistry.resolveByPath
 *    反查当前工作区，规划时写进正确项目的看板
 *
 * 注：带浏览器看板 UI 的动态版源码见 src/host.js 与 src/client.js（通过 cordis_define 安装）。
 */
export const name = 'dsh-project-kanban'

export const inject = ['tools']

export function apply(ctx) {
  // 服务在 apply 挂载阶段可能尚未激活：一律在每次使用时惰性读取（ctx.get），
  // 而不是在 apply 时缓存——否则组合里稍后激活的提供者（fs-sandbox 等）永远不可见。
  const getFs = () => ctx.get('fs')
  const getPolicy = () => ctx.get('sandboxPolicy')
  const getWorkspaceRegistry = () => ctx.get('workspaceRegistry')
  const boards = new Map()
  const fileTargets = new Map()
  let seq = 0

  const root = () => {
    const sandboxPolicy = getPolicy()
    return sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string' ? sandboxPolicy.workspaceRoot : undefined
  }
  const fileName = (wsid) => 'kanban-board-' + wsid + '.json'
  const resolveFile = async (wsid) => {
    const fs = getFs()
    if (!fs) return null
    try {
      return await fs.resolve(fileName(wsid), root() ? { cwd: root() } : {})
    } catch (e) {
      console.log('kanban: resolve failed, memory mode: ' + ((e && e.message) || e))
      return null
    }
  }
  const targetOf = async (wsid) => {
    if (!fileTargets.has(wsid)) fileTargets.set(wsid, await resolveFile(wsid))
    return fileTargets.get(wsid)
  }
  const boardOf = async (wsid) => {
    let b = boards.get(wsid)
    if (!b) {
      b = { columns: [], cards: [] }
      boards.set(wsid, b)
      const fs = getFs()
      const target = await targetOf(wsid)
      if (fs && target) {
        try {
          const data = JSON.parse(await fs.readText(target))
          if (data && Array.isArray(data.columns) && Array.isArray(data.cards)) {
            b.columns = data.columns
            b.cards = data.cards
            for (const c of b.columns) {
              const n = Number(String(c.id).slice(1))
              if (n > seq) seq = n
            }
            for (const c of b.cards) {
              const n = Number(String(c.id).slice(1))
              if (n > seq) seq = n
            }
          }
        } catch (e) {
          console.log('kanban: no board file yet for ' + wsid)
        }
      }
      if (b.columns.length === 0) {
        b.columns.push({ id: 'c' + (++seq), title: '待办' })
        b.columns.push({ id: 'c' + (++seq), title: '进行中' })
        b.columns.push({ id: 'c' + (++seq), title: '已完成' })
      }
    }
    return b
  }
  const save = async (wsid) => {
    const fs = getFs()
    const target = await targetOf(wsid)
    if (!fs || !target) return
    const b = boards.get(wsid)
    if (!b) return
    try {
      await fs.writeText(target, JSON.stringify({ columns: b.columns, cards: b.cards }))
    } catch (e) {
      console.log('kanban: save failed for ' + wsid + ': ' + ((e && e.message) || e))
    }
  }
  const wsidOfExec = async (exec) => {
    const agent = exec && exec.agent
    const cwd = agent && agent.session && agent.session.header && agent.session.header.cwd
    if (typeof cwd === 'string') {
      const workspaceRegistry = getWorkspaceRegistry()
      if (workspaceRegistry) {
        try {
          const ws = await workspaceRegistry.resolveByPath(cwd)
          if (ws) return ws.id
        } catch (e) {
          console.log('kanban: workspace resolve failed: ' + ((e && e.message) || e))
        }
      }
    }
    return 'default'
  }
  const summary = (b, includeArchived = false) => {
    const visible = b.cards.filter((c) => includeArchived || c.archived !== true)
    return {
      columns: b.columns.map((c) => ({
        id: c.id,
        title: c.title,
        count: visible.filter((k) => k.columnId === c.id).length,
      })),
      cards: visible.map((c) => ({ id: c.id, columnId: c.columnId, title: c.title, label: c.label ?? null, priority: c.priority ?? null, color: c.color ?? null, dueDate: c.dueDate ?? null, archived: c.archived === true })),
    }
  }
  const str = (v, fb) => (typeof v === 'string' ? v : fb)
  const PRIORITIES = ['high', 'medium', 'low']
  const normPriority = (v) => (typeof v === 'string' && PRIORITIES.includes(v) ? v : undefined)
  const normColor = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined)
  const normDueDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  const findCard = (b, id) => b.cards.find((c) => c.id === id)
  const findColumn = (b, id) => b.columns.find((c) => c.id === id)
  const colOf = (b, columnId) => findColumn(b, str(columnId, '')) || b.columns[0]

  // ---- 数据层：浏览器端经 /api/kanban HTTP 路由调用（官方 webServer 扩展点） ----
  const wsidOf = (args) => {
    const v = args && args.workspaceId
    return typeof v === 'string' && v.length > 0 ? v : 'default'
  }
  const cloneBoard = (b, includeArchived = false) => ({
    columns: b.columns.map((c) => ({ id: c.id, title: c.title })),
    cards: b.cards
      .filter((c) => includeArchived || c.archived !== true)
      .map((c) => ({ id: c.id, columnId: c.columnId, title: c.title, note: c.note, label: c.label ?? null, priority: c.priority ?? null, color: c.color ?? null, dueDate: c.dueDate ?? null, archived: c.archived === true }))
  })
  const dispatch = async (method, args) => {
    const wsid = wsidOf(args)
    const b = await boardOf(wsid)
    const a = args || {}
    switch (method) {
      case 'kanban.get': {
        const includeArchived = a.includeArchived === true
        return {
          board: cloneBoard(b, includeArchived),
          persisted: fileTargets.has(wsid) && fileTargets.get(wsid) !== null,
        }
      }
      case 'kanban.addCard': {
        const col = colOf(b, a.columnId)
        if (!col) return { board: cloneBoard(b) }
        b.cards.push({
          id: 'k' + (++seq),
          columnId: col.id,
          title: str(a.title, '').slice(0, 120) || '未命名卡片',
          note: str(a.note, '').slice(0, 500),
          label: typeof a.label === 'string' ? a.label.slice(0, 20) : undefined,
          priority: normPriority(a.priority),
          color: normColor(a.color),
          dueDate: normDueDate(a.dueDate),
        })
        await save(wsid)
        return { board: cloneBoard(b), persisted: true }
      }
      case 'kanban.updateCard': {
        const card = findCard(b, str(a.id, ''))
        if (card) {
          if (typeof a.title === 'string') card.title = a.title.slice(0, 120) || card.title
          if (typeof a.note === 'string') card.note = a.note.slice(0, 500)
          if (typeof a.label === 'string') card.label = a.label.slice(0, 20) || undefined
          if (typeof a.priority === 'string') card.priority = normPriority(a.priority)
          if (typeof a.color === 'string') card.color = normColor(a.color)
          if (typeof a.dueDate === 'string') card.dueDate = normDueDate(a.dueDate)
          await save(wsid)
        }
        return { board: cloneBoard(b) }
      }
      case 'kanban.deleteCard': {
        // 软删除：标记 archived，卡片进入回收站（可从 UI 或 restore_card 恢复）
        const card = findCard(b, str(a.id, ''))
        if (card) {
          card.archived = true
          await save(wsid)
        }
        return { board: cloneBoard(b) }
      }
      case 'kanban.restoreCard': {
        const card = findCard(b, str(a.id, ''))
        if (card) {
          card.archived = false
          await save(wsid)
        }
        return { board: cloneBoard(b) }
      }
      case 'kanban.purgeCard': {
        const id = str(a.id, '')
        b.cards = b.cards.filter((c) => c.id !== id)
        await save(wsid)
        return { board: cloneBoard(b) }
      }
      case 'kanban.duplicateCard': {
        const card = findCard(b, str(a.id, ''))
        if (!card) return { board: cloneBoard(b) }
        const copy = {
          id: 'k' + (++seq),
          columnId: str(a.columnId, '') ? findColumn(b, str(a.columnId, '')) ? str(a.columnId, '') : card.columnId : card.columnId,
          title: card.title,
          note: card.note,
          label: card.label,
          priority: card.priority,
          color: card.color,
        }
        const inCol = b.cards.filter((c) => c.columnId === copy.columnId)
        const idx = typeof a.toIndex === 'number' && Number.isFinite(a.toIndex) ? Math.max(0, Math.min(Math.floor(a.toIndex), inCol.length)) : inCol.length
        const anchor = inCol[idx]
        if (anchor) b.cards.splice(b.cards.indexOf(anchor), 0, copy)
        else b.cards.push(copy)
        await save(wsid)
        return { board: cloneBoard(b), persisted: true }
      }
      case 'kanban.moveCard': {
        const card = findCard(b, str(a.id, ''))
        const target = findColumn(b, str(a.columnId, ''))
        if (card && target) {
          const from = b.cards.indexOf(card)
          const toIndex = typeof a.toIndex === 'number' && Number.isFinite(a.toIndex) ? Math.max(0, Math.floor(a.toIndex)) : null
          if (card.columnId === target.id && toIndex !== null) {
            // 同列内重排：按新索引精确插入
            const rel = b.cards.filter((c) => c.columnId === target.id).indexOf(card)
            b.cards.splice(from, 1)
            const inCol = b.cards.filter((c) => c.columnId === target.id)
            const insert = toIndex > rel ? toIndex - 1 : toIndex
            const anchor = inCol[Math.min(insert, inCol.length)]
            if (anchor) b.cards.splice(b.cards.indexOf(anchor), 0, card)
            else b.cards.push(card)
          } else {
            // 跨列：移动到目标列末尾
            card.columnId = target.id
          }
          await save(wsid)
        }
        return { board: cloneBoard(b) }
      }
      case 'kanban.addColumn': {
        const title = str(a.title, '').slice(0, 40) || '新列表'
        b.columns.push({ id: 'c' + (++seq), title })
        await save(wsid)
        return { board: cloneBoard(b) }
      }
      case 'kanban.renameColumn': {
        const col = findColumn(b, str(a.id, ''))
        if (col && typeof a.title === 'string') {
          col.title = a.title.slice(0, 40) || col.title
          await save(wsid)
        }
        return { board: cloneBoard(b) }
      }
      case 'kanban.deleteColumn': {
        const id = str(a.id, '')
        if (b.columns.length <= 1) return { board: cloneBoard(b) }
        const idx = b.columns.findIndex((c) => c.id === id)
        if (idx < 0) return { board: cloneBoard(b) }
        b.columns.splice(idx, 1)
        const fallback = b.columns[0].id
        for (const card of b.cards) {
          if (card.columnId === id) card.columnId = fallback
        }
        await save(wsid)
        return { board: cloneBoard(b) }
      }
      default:
        return { error: 'unknown kanban method: ' + method }
    }
  }
  const httpHandler = async (req, res) => {
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const raw = Buffer.concat(chunks).toString('utf8')
      const body = raw ? JSON.parse(raw) : {}
      const method = typeof body.method === 'string' ? body.method : 'kanban.get'
      const result = await dispatch(method, body.args || {})
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: String((e && e.message) || e) }))
    }
  }
  const routeState = { registered: false, timer: null }
  const registerHttpRoute = () => {
    if (routeState.registered) return
    const webServer = ctx.get('webServer')
    if (webServer === undefined) return
    try {
      webServer.register({ kind: 'prefix', path: '/api/kanban', handler: httpHandler })
      routeState.registered = true
      console.log('kanban: /api/kanban route registered')
    } catch (e) {
      console.log('kanban: route register failed: ' + ((e && e.message) || e))
    }
  }
  // webServer 由 web-app 行提供，可能在 apply 之后才激活：轮询注册（最多 20 秒）
  registerHttpRoute()
  if (!routeState.registered) {
    routeState.timer = setInterval(() => {
      registerHttpRoute()
      if (routeState.registered) clearInterval(routeState.timer)
    }, 500)
  }

  const resultSchema = {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      message: { type: 'string' },
      board: { type: 'object' },
    },
    required: ['ok', 'message'],
    additionalProperties: false,
  }
  const renderBoard = (value) => {
    const b = value && value.board
    const lines = [String((value && value.message) || '')]
    if (b && Array.isArray(b.columns)) {
      lines.push('看板状态：')
      for (const col of b.columns) {
        lines.push('· ' + col.title + '（' + col.count + ' 张）')
      }
      if (Array.isArray(b.cards)) {
        for (const card of b.cards) {
          lines.push('  - [' + card.id + '] ' + (card.priority ? '[' + card.priority + '] ' : '') + (card.label ? '[' + card.label + '] ' : '') + (card.dueDate ? '{' + card.dueDate + '} ' : '') + card.title)
        }
      }
    }
    return [{ type: 'text', text: lines.join('\n') }]
  }
  const toolResult = (message, b) => ({ ok: true, message, board: summary(b) })

  const tools = [
    {
      name: 'kanban_get',
      description: '读取当前项目（工作区）看板的当前状态（所有列表与卡片）。做规划前先调用它了解现有内容，避免重复建卡。',
      parameters: {
        type: 'object',
        properties: {
          includeArchived: { type: 'boolean', description: '是否包含回收站中的卡片（可选，默认 false）' },
        },
      },
      output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
      async execute(args, exec) {
        const wsid = await wsidOfExec(exec)
        const b = await boardOf(wsid)
        return toolResult('已读取看板（工作区 ' + wsid + '）', b)
      },
    },
    {
      name: 'kanban_add_card',
      description: '向当前项目（工作区）的看板添加一张卡片。复杂项目的功能拆解与计划都写入看板：任务拆一步写一张。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '卡片标题（任务名，简洁可执行）' },
          columnId: { type: 'string', description: '目标列表 id；省略则放入第一个列表（通常为待办）' },
          note: { type: 'string', description: '备注：背景、验收标准或拆解细节（可选）' },
          label: { type: 'string', description: '卡片标签（可选）：功能 / 缺陷 / 文档 / 优化' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'], description: '优先级（可选）：high / medium / low' },
          color: { type: 'string', description: '自定义卡片背景色（可选）：#rrggbb 十六进制' },
          dueDate: { type: 'string', description: '截止日期（可选）：YYYY-MM-DD' },
        },
        required: ['title'],
      },
      output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
      async execute(args, exec) {
        const wsid = await wsidOfExec(exec)
        const b = await boardOf(wsid)
        const col = colOf(b, args && args.columnId)
        if (!col) return { ok: false, message: '失败：没有可用列表' }
        b.cards.push({
          id: 'k' + (++seq),
          columnId: col.id,
          title: str(args && args.title, '').slice(0, 120) || '未命名卡片',
          note: str(args && args.note, '').slice(0, 500),
          label: typeof (args && args.label) === 'string' ? args.label.slice(0, 20) : undefined,
          priority: normPriority(args && args.priority),
          color: normColor(args && args.color),
          dueDate: normDueDate(args && args.dueDate),
        })
        await save(wsid)
        return toolResult('已添加卡片到「' + col.title + '」（工作区 ' + wsid + '）', b)
      },
    },
    {
      name: 'kanban_update_card',
      description: '更新看板中一张卡片的标题或备注。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '卡片 id' },
          title: { type: 'string', description: '新标题（可选）' },
          note: { type: 'string', description: '新备注（可选）' },
          label: { type: 'string', description: '新标签（可选）：功能 / 缺陷 / 文档 / 优化；传空字符串清除' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'], description: '新优先级（可选）；传空字符串清除' },
          color: { type: 'string', description: '新卡片背景色（可选）：#rrggbb；传空字符串清除' },
          dueDate: { type: 'string', description: '新截止日期（可选）：YYYY-MM-DD；传空字符串清除' },
        },
        required: ['id'],
      },
      output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
      async execute(args, exec) {
        const wsid = await wsidOfExec(exec)
        const b = await boardOf(wsid)
        const card = findCard(b, str(args && args.id, ''))
        if (!card) return { ok: false, message: '找不到卡片 ' + str(args && args.id, '') }
        if (typeof args.title === 'string') card.title = args.title.slice(0, 120) || card.title
        if (typeof args.note === 'string') card.note = args.note.slice(0, 500)
        if (typeof args.label === 'string') card.label = args.label.slice(0, 20) || undefined
        if (typeof args.priority === 'string') card.priority = normPriority(args.priority)
        if (typeof args.color === 'string') card.color = normColor(args.color)
        if (typeof args.dueDate === 'string') card.dueDate = normDueDate(args.dueDate)
        await save(wsid)
        return toolResult('已更新卡片', b)
      },
    },
    {
      name: 'kanban_delete_card',
      description: '把一张卡片移入回收站（软删除）。可用 kanban_restore_card 恢复，或 kanban_purge_card 彻底删除。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '卡片 id' } },
        required: ['id'],
      },
      output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
      async execute(args, exec) {
        const wsid = await wsidOfExec(exec)
        const b = await boardOf(wsid)
        const id = str(args && args.id, '')
        b.cards = b.cards.filter((c) => c.id !== id)
        await save(wsid)
        return toolResult('已删除卡片', b)
      },
    },
    {
      name: 'kanban_duplicate_card',
      description: '复制一张卡片到同列（或指定列）。拆分相似任务时使用。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '源卡片 id' },
          columnId: { type: 'string', description: '目标列表 id（可选）；省略则复制到同列' },
          toIndex: { type: 'integer', description: '目标列内位置（可选）' },
        },
        required: ['id'],
      },
      output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
      async execute(args, exec) {
        const wsid = await wsidOfExec(exec)
        const b = await boardOf(wsid)
        const card = findCard(b, str(args && args.id, ''))
        if (!card) return { ok: false, message: '找不到卡片 ' + str(args && args.id, '') }
        const colId = typeof (args && args.columnId) === 'string' && findColumn(b, args.columnId) ? args.columnId : card.columnId
        const copy = {
          id: 'k' + (++seq),
          columnId: colId,
          title: card.title,
          note: card.note,
          label: card.label,
          priority: card.priority,
          color: card.color,
        }
        const inCol = b.cards.filter((c) => c.columnId === colId)
        const idx = typeof (args && args.toIndex) === 'number' && Number.isFinite(args.toIndex) ? Math.max(0, Math.min(Math.floor(args.toIndex), inCol.length)) : inCol.length
        const anchor = inCol[idx]
        if (anchor) b.cards.splice(b.cards.indexOf(anchor), 0, copy)
        else b.cards.push(copy)
        await save(wsid)
        return toolResult('已复制卡片到「' + findColumn(b, colId).title + '」', b)
      },
    },
    {
      name: 'kanban_restore_card',
      description: '从回收站恢复一张已删除（归档）的卡片。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '卡片 id' } },
        required: ['id'],
      },
      output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
      async execute(args, exec) {
        const wsid = await wsidOfExec(exec)
        const b = await boardOf(wsid)
        const card = findCard(b, str(args && args.id, ''))
        if (!card) return { ok: false, message: '找不到卡片 ' + str(args && args.id, '') }
        card.archived = false
        await save(wsid)
        return toolResult('已恢复卡片', b)
      },
    },
    {
      name: 'kanban_purge_card',
      description: '从看板彻底删除一张卡片（不可恢复）。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '卡片 id' } },
        required: ['id'],
      },
      output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
      async execute(args, exec) {
        const wsid = await wsidOfExec(exec)
        const b = await boardOf(wsid)
        const id = str(args && args.id, '')
        b.cards = b.cards.filter((c) => c.id !== id)
        await save(wsid)
        return toolResult('已彻底删除卡片', b)
      },
    },
    {
      name: 'kanban_move_card',
      description: '把一张卡片移动到指定列表（如从待办移到进行中）。任务状态变化时调用。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '卡片 id' },
          columnId: { type: 'string', description: '目标列表 id' },
          toIndex: { type: 'integer', description: '目标列内位置（可选）：同列重排时生效，0 为列首' },
        },
        required: ['id', 'columnId'],
      },
      output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
      async execute(args, exec) {
        const wsid = await wsidOfExec(exec)
        const b = await boardOf(wsid)
        const card = findCard(b, str(args && args.id, ''))
        const target = findColumn(b, str(args && args.columnId, ''))
        if (!card || !target) return { ok: false, message: '找不到卡片或列表' }
        card.columnId = target.id
        await save(wsid)
        return toolResult('已移动到「' + target.title + '」', b)
      },
    },
    {
      name: 'kanban_add_column',
      description: '在看板添加一个列表（列）。需要新工作流阶段（如「评审」「阻塞」）时调用。',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string', description: '列表名称' } },
        required: ['title'],
      },
      output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
      async execute(args, exec) {
        const wsid = await wsidOfExec(exec)
        const b = await boardOf(wsid)
        const title = str(args && args.title, '').slice(0, 40) || '新列表'
        b.columns.push({ id: 'c' + (++seq), title })
        await save(wsid)
        return toolResult('已添加列表「' + title + '」', b)
      },
    },
    {
      name: 'kanban_rename_column',
      description: '重命名看板中的一个列表。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '列表 id' },
          title: { type: 'string', description: '新名称' },
        },
        required: ['id', 'title'],
      },
      output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
      async execute(args, exec) {
        const wsid = await wsidOfExec(exec)
        const b = await boardOf(wsid)
        const col = findColumn(b, str(args && args.id, ''))
        if (!col) return { ok: false, message: '找不到列表' }
        col.title = str(args && args.title, '').slice(0, 40) || col.title
        await save(wsid)
        return toolResult('已重命名列表', b)
      },
    },
    {
      name: 'kanban_delete_column',
      description: '删除看板中的一个列表，其卡片并入第一个列表。至少保留一个列表。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '列表 id' } },
        required: ['id'],
      },
      output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
      async execute(args, exec) {
        const wsid = await wsidOfExec(exec)
        const b = await boardOf(wsid)
        const id = str(args && args.id, '')
        if (b.columns.length <= 1) return { ok: false, message: '至少保留一个列表' }
        const idx = b.columns.findIndex((c) => c.id === id)
        if (idx < 0) return { ok: false, message: '找不到列表' }
        b.columns.splice(idx, 1)
        const fallback = b.columns[0].id
        for (const card of b.cards) {
          if (card.columnId === id) card.columnId = fallback
        }
        await save(wsid)
        return toolResult('已删除列表，卡片已并入「' + b.columns[0].title + '」', b)
      },
    },
  ]
  for (const tool of tools) ctx.tools.register(tool)
}
