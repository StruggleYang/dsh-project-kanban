/**
 * dsh-project-kanban — Host 半边
 *
 * 这是 cordis_define 的 code.host「函数体」：返回一个 Cordis Plugin。
 * 在 DeepSeek Harness 中激活时，运行环境注入 harness / ctx / console 等能力。
 *
 * 职责：
 *  - 内存看板数据（columns + cards），经 ctx.fs 持久化到 kanban-board.json
 *  - harness.handle 暴露 8 个私有 RPC 方法供浏览器端调用
 *  - harness.defineTool + harness.registerTool 注册 8 个模型工具，供 Agent 规划时写卡
 */
return {
  apply(ctx) {
    let seq = 0
    let persistEnabled = false
    const board = { columns: [], cards: [] }
    const fs = ctx.get('fs')
    const sandboxPolicy = ctx.get('sandboxPolicy')
    let fileTarget = null

    const resolveFile = async () => {
      if (!fs) return null
      try {
        const cwd = sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string' ? sandboxPolicy.workspaceRoot : undefined
        fileTarget = await fs.resolve('kanban-board.json', cwd ? { cwd } : {})
        return fileTarget
      } catch (e) {
        console.log('kanban: resolve failed, memory mode: ' + ((e && e.message) || e))
        return null
      }
    }
    const load = async () => {
      const target = await resolveFile()
      if (!target) return
      try {
        const text = await fs.readText(target)
        const data = JSON.parse(text)
        if (data && Array.isArray(data.columns) && Array.isArray(data.cards)) {
          board.columns = data.columns
          board.cards = data.cards
          for (const c of board.columns) {
            const n = Number(String(c.id).slice(1))
            if (n > seq) seq = n
          }
          for (const c of board.cards) {
            const n = Number(String(c.id).slice(1))
            if (n > seq) seq = n
          }
          persistEnabled = true
        }
      } catch (e) {
        console.log('kanban: no persisted board yet, fresh start: ' + ((e && e.message) || e))
      }
    }
    const save = async () => {
      if (!fs || !fileTarget) return
      try {
        await fs.writeText(fileTarget, JSON.stringify({ columns: board.columns, cards: board.cards }))
        persistEnabled = true
      } catch (e) {
        console.log('kanban: save failed, continuing in memory: ' + ((e && e.message) || e))
      }
    }
    const ready = load()

    const seed = () => {
      if (board.columns.length === 0) {
        board.columns.push({ id: 'c' + (++seq), title: '待办' })
        board.columns.push({ id: 'c' + (++seq), title: '进行中' })
        board.columns.push({ id: 'c' + (++seq), title: '已完成' })
      }
    }
    const cloneBoard = () => ({
      columns: board.columns.map((c) => ({ id: c.id, title: c.title })),
      cards: board.cards.map((c) => ({ id: c.id, columnId: c.columnId, title: c.title, note: c.note })),
    })
    const reply = () => ({ board: cloneBoard(), persisted: persistEnabled })
    const summary = () => ({
      columns: board.columns.map((c) => ({
        id: c.id,
        title: c.title,
        count: board.cards.filter((k) => k.columnId === c.id).length,
      })),
      cards: board.cards.map((c) => ({ id: c.id, columnId: c.columnId, title: c.title })),
    })
    const str = (v, fb) => (typeof v === 'string' ? v : fb)
    const findCard = (id) => board.cards.find((c) => c.id === id)
    const findColumn = (id) => board.columns.find((c) => c.id === id)
    const colOf = (columnId) => findColumn(str(columnId, '')) || board.columns[0]

    // ---- 浏览器端私有 RPC ----
    harness.handle('kanban.get', async () => {
      await ready
      seed()
      return reply()
    })
    harness.handle('kanban.addCard', async (args) => {
      await ready
      seed()
      const a = args || {}
      const col = colOf(a.columnId)
      if (!col) return reply()
      board.cards.push({
        id: 'k' + (++seq),
        columnId: col.id,
        title: str(a.title, '').slice(0, 120) || '未命名卡片',
        note: str(a.note, '').slice(0, 500),
      })
      await save()
      return reply()
    })
    harness.handle('kanban.updateCard', async (args) => {
      await ready
      const a = args || {}
      const card = findCard(str(a.id, ''))
      if (card) {
        if (typeof a.title === 'string') card.title = a.title.slice(0, 120) || card.title
        if (typeof a.note === 'string') card.note = a.note.slice(0, 500)
        await save()
      }
      return reply()
    })
    harness.handle('kanban.deleteCard', async (args) => {
      await ready
      const id = str(args && args.id, '')
      board.cards = board.cards.filter((c) => c.id !== id)
      await save()
      return reply()
    })
    harness.handle('kanban.moveCard', async (args) => {
      await ready
      const a = args || {}
      const card = findCard(str(a.id, ''))
      const target = findColumn(str(a.columnId, ''))
      if (card && target) {
        card.columnId = target.id
        await save()
      }
      return reply()
    })
    harness.handle('kanban.addColumn', async (args) => {
      await ready
      const title = str(args && args.title, '').slice(0, 40) || '新列表'
      board.columns.push({ id: 'c' + (++seq), title })
      await save()
      return reply()
    })
    harness.handle('kanban.renameColumn', async (args) => {
      await ready
      const a = args || {}
      const col = findColumn(str(a.id, ''))
      if (col && typeof a.title === 'string') {
        col.title = a.title.slice(0, 40) || col.title
        await save()
      }
      return reply()
    })
    harness.handle('kanban.deleteColumn', async (args) => {
      await ready
      const id = str(args && args.id, '')
      if (board.columns.length <= 1) return reply()
      const idx = board.columns.findIndex((c) => c.id === id)
      if (idx < 0) return reply()
      board.columns.splice(idx, 1)
      const fallback = board.columns[0].id
      for (const card of board.cards) {
        if (card.columnId === id) card.columnId = fallback
      }
      await save()
      return reply()
    })

    // ---- 模型工具（Agent 规划时调用） ----
    const resultSchema = {
      type: 'object',
      properties: {
        ok: { type: 'boolean', required: true },
        message: { type: 'string', required: true },
        board: { type: 'json' },
      },
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
            lines.push('  - [' + card.id + '] ' + card.title)
          }
        }
      }
      return [{ type: 'text', text: lines.join('\n') }]
    }
    const toolResult = (message) => ({ ok: true, message, board: summary() })
    const tools = [
      harness.defineTool({
        name: 'kanban_get',
        description: '读取项目看板的当前状态（所有列表与卡片）。做规划前先调用它了解现有内容，避免重复建卡。',
        parameters: { type: 'object', properties: {} },
        output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
        execute: async () => toolResult('已读取看板'),
      }),
      harness.defineTool({
        name: 'kanban_add_card',
        description: '向项目看板添加一张卡片。复杂项目的功能拆解与计划都写入看板：任务拆一步写一张。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '卡片标题（任务名，简洁可执行）' },
            columnId: { type: 'string', description: '目标列表 id；省略则放入第一个列表（通常为待办）' },
            note: { type: 'string', description: '备注：背景、验收标准或拆解细节（可选）' },
          },
          required: ['title'],
        },
        output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
        execute: async (args) => {
          await ready
          seed()
          const col = colOf(args && args.columnId)
          if (!col) return toolResult('失败：没有可用列表')
          board.cards.push({
            id: 'k' + (++seq),
            columnId: col.id,
            title: str(args && args.title, '').slice(0, 120) || '未命名卡片',
            note: str(args && args.note, '').slice(0, 500),
          })
          await save()
          return toolResult('已添加卡片到「' + col.title + '」')
        },
      }),
      harness.defineTool({
        name: 'kanban_update_card',
        description: '更新看板中一张卡片的标题或备注。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '卡片 id' },
            title: { type: 'string', description: '新标题（可选）' },
            note: { type: 'string', description: '新备注（可选）' },
          },
          required: ['id'],
        },
        output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
        execute: async (args) => {
          await ready
          const card = findCard(str(args && args.id, ''))
          if (!card) return { ok: false, message: '找不到卡片 ' + str(args && args.id, '') }
          if (typeof args.title === 'string') card.title = args.title.slice(0, 120) || card.title
          if (typeof args.note === 'string') card.note = args.note.slice(0, 500)
          await save()
          return toolResult('已更新卡片')
        },
      }),
      harness.defineTool({
        name: 'kanban_delete_card',
        description: '从看板删除一张卡片。',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string', description: '卡片 id' } },
          required: ['id'],
        },
        output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
        execute: async (args) => {
          await ready
          const id = str(args && args.id, '')
          board.cards = board.cards.filter((c) => c.id !== id)
          await save()
          return toolResult('已删除卡片')
        },
      }),
      harness.defineTool({
        name: 'kanban_move_card',
        description: '把一张卡片移动到指定列表（如从待办移到进行中）。任务状态变化时调用。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '卡片 id' },
            columnId: { type: 'string', description: '目标列表 id' },
          },
          required: ['id', 'columnId'],
        },
        output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
        execute: async (args) => {
          await ready
          const card = findCard(str(args && args.id, ''))
          const target = findColumn(str(args && args.columnId, ''))
          if (!card || !target) return { ok: false, message: '找不到卡片或列表' }
          card.columnId = target.id
          await save()
          return toolResult('已移动到「' + target.title + '」')
        },
      }),
      harness.defineTool({
        name: 'kanban_add_column',
        description: '在看板添加一个列表（列）。需要新工作流阶段（如「评审」「阻塞」）时调用。',
        parameters: {
          type: 'object',
          properties: { title: { type: 'string', description: '列表名称' } },
          required: ['title'],
        },
        output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
        execute: async (args) => {
          await ready
          const title = str(args && args.title, '').slice(0, 40) || '新列表'
          board.columns.push({ id: 'c' + (++seq), title })
          await save()
          return toolResult('已添加列表「' + title + '」')
        },
      }),
      harness.defineTool({
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
        execute: async (args) => {
          await ready
          const col = findColumn(str(args && args.id, ''))
          if (!col) return { ok: false, message: '找不到列表' }
          col.title = str(args && args.title, '').slice(0, 40) || col.title
          await save()
          return toolResult('已重命名列表')
        },
      }),
      harness.defineTool({
        name: 'kanban_delete_column',
        description: '删除看板中的一个列表，其卡片并入第一个列表。至少保留一个列表。',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string', description: '列表 id' } },
          required: ['id'],
        },
        output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
        execute: async (args) => {
          await ready
          const id = str(args && args.id, '')
          if (board.columns.length <= 1) return { ok: false, message: '至少保留一个列表' }
          const idx = board.columns.findIndex((c) => c.id === id)
          if (idx < 0) return { ok: false, message: '找不到列表' }
          board.columns.splice(idx, 1)
          const fallback = board.columns[0].id
          for (const card of board.cards) {
            if (card.columnId === id) card.columnId = fallback
          }
          await save()
          return toolResult('已删除列表，卡片已并入「' + board.columns[0].title + '」')
        },
      }),
    ]
    for (const tool of tools) harness.registerTool(ctx, tool)
  },
}
