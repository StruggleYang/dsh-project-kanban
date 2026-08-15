/**
 * dsh-project-kanban — Host 半边
 *
 * 这是 cordis_define 的 code.host「函数体」：返回一个 Cordis Plugin。
 * 在 DeepSeek Harness 中激活时，运行环境注入 harness / ctx / console 等能力。
 *
 * 职责：
 *  - 按工作区（项目）分板：boards 以 workspaceId 为键，每个工作区独立数据
 *  - 经 ctx.fs 持久化到 <workspaceRoot>/kanban-board-<workspaceId>.json
 *  - harness.handle 暴露 8 个私有 RPC 方法供浏览器端调用（按 workspaceId 隔离）
 *  - harness.defineTool + harness.registerTool 注册 8 个模型工具：
 *    Agent 调用时经 exec.agent.session.header.cwd → workspaceRegistry.resolveByPath
 *    反查当前工作区，规划时写进正确项目的看板
 */
return {
  apply(ctx) {
    const fs = ctx.get('fs')
    const sandboxPolicy = ctx.get('sandboxPolicy')
    const workspaceRegistry = ctx.get('workspaceRegistry')
    const boards = new Map()
    const fileTargets = new Map()
    let seq = 0

    const root = () => (sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string' ? sandboxPolicy.workspaceRoot : undefined)
    const fileName = (wsid) => 'kanban-board-' + wsid + '.json'
    const resolveFile = async (wsid) => {
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
    const wsidOf = (args) => {
      const v = args && args.workspaceId
      return typeof v === 'string' && v.length > 0 ? v : 'default'
    }
    const wsidOfExec = async (exec) => {
      const agent = exec && exec.agent
      const cwd = agent && agent.session && agent.session.header && agent.session.header.cwd
      if (typeof cwd === 'string' && workspaceRegistry) {
        try {
          const ws = await workspaceRegistry.resolveByPath(cwd)
          if (ws) return ws.id
        } catch (e) {
          console.log('kanban: workspace resolve failed: ' + ((e && e.message) || e))
        }
      }
      return 'default'
    }
    const cloneBoard = (b) => ({
      columns: b.columns.map((c) => ({ id: c.id, title: c.title })),
      cards: b.cards.map((c) => ({ id: c.id, columnId: c.columnId, title: c.title, note: c.note })),
    })
    const summary = (b) => ({
      columns: b.columns.map((c) => ({
        id: c.id,
        title: c.title,
        count: b.cards.filter((k) => k.columnId === c.id).length,
      })),
      cards: b.cards.map((c) => ({ id: c.id, columnId: c.columnId, title: c.title })),
    })
    const str = (v, fb) => (typeof v === 'string' ? v : fb)
    const findCard = (b, id) => b.cards.find((c) => c.id === id)
    const findColumn = (b, id) => b.columns.find((c) => c.id === id)
    const colOf = (b, columnId) => findColumn(b, str(columnId, '')) || b.columns[0]

    // ---- 浏览器端私有 RPC（按 workspaceId 隔离） ----
    harness.handle('kanban.get', async (args) => {
      const wsid = wsidOf(args)
      const b = await boardOf(wsid)
      return { board: cloneBoard(b), persisted: fileTargets.has(wsid) && fileTargets.get(wsid) !== null }
    })
    harness.handle('kanban.addCard', async (args) => {
      const wsid = wsidOf(args)
      const b = await boardOf(wsid)
      const a = args || {}
      const col = colOf(b, a.columnId)
      if (!col) return { board: cloneBoard(b) }
      b.cards.push({
        id: 'k' + (++seq),
        columnId: col.id,
        title: str(a.title, '').slice(0, 120) || '未命名卡片',
        note: str(a.note, '').slice(0, 500),
      })
      await save(wsid)
      return { board: cloneBoard(b), persisted: true }
    })
    harness.handle('kanban.updateCard', async (args) => {
      const wsid = wsidOf(args)
      const b = await boardOf(wsid)
      const a = args || {}
      const card = findCard(b, str(a.id, ''))
      if (card) {
        if (typeof a.title === 'string') card.title = a.title.slice(0, 120) || card.title
        if (typeof a.note === 'string') card.note = a.note.slice(0, 500)
        await save(wsid)
      }
      return { board: cloneBoard(b) }
    })
    harness.handle('kanban.deleteCard', async (args) => {
      const wsid = wsidOf(args)
      const b = await boardOf(wsid)
      const id = str(args && args.id, '')
      b.cards = b.cards.filter((c) => c.id !== id)
      await save(wsid)
      return { board: cloneBoard(b) }
    })
    harness.handle('kanban.moveCard', async (args) => {
      const wsid = wsidOf(args)
      const b = await boardOf(wsid)
      const a = args || {}
      const card = findCard(b, str(a.id, ''))
      const target = findColumn(b, str(a.columnId, ''))
      if (card && target) {
        card.columnId = target.id
        await save(wsid)
      }
      return { board: cloneBoard(b) }
    })
    harness.handle('kanban.addColumn', async (args) => {
      const wsid = wsidOf(args)
      const b = await boardOf(wsid)
      const title = str(args && args.title, '').slice(0, 40) || '新列表'
      b.columns.push({ id: 'c' + (++seq), title })
      await save(wsid)
      return { board: cloneBoard(b) }
    })
    harness.handle('kanban.renameColumn', async (args) => {
      const wsid = wsidOf(args)
      const b = await boardOf(wsid)
      const a = args || {}
      const col = findColumn(b, str(a.id, ''))
      if (col && typeof a.title === 'string') {
        col.title = a.title.slice(0, 40) || col.title
        await save(wsid)
      }
      return { board: cloneBoard(b) }
    })
    harness.handle('kanban.deleteColumn', async (args) => {
      const wsid = wsidOf(args)
      const b = await boardOf(wsid)
      const id = str(args && args.id, '')
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
    })

    // ---- 模型工具（Agent 规划时调用，自动定位当前工作区） ----
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
    const toolResult = (message, b) => ({ ok: true, message, board: summary(b) })
    const tools = [
      harness.defineTool({
        name: 'kanban_get',
        description: '读取当前项目（工作区）看板的当前状态（所有列表与卡片）。做规划前先调用它了解现有内容，避免重复建卡。',
        parameters: { type: 'object', properties: {} },
        output: { schema: resultSchema, render: (args, value) => renderBoard(value) },
        execute: async (args, exec) => {
          const wsid = await wsidOfExec(exec)
          const b = await boardOf(wsid)
          return toolResult('已读取看板（工作区 ' + wsid + '）', b)
        },
      }),
      harness.defineTool({
        name: 'kanban_add_card',
        description: '向当前项目（工作区）的看板添加一张卡片。复杂项目的功能拆解与计划都写入看板：任务拆一步写一张。',
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
        execute: async (args, exec) => {
          const wsid = await wsidOfExec(exec)
          const b = await boardOf(wsid)
          const col = colOf(b, args && args.columnId)
          if (!col) return { ok: false, message: '失败：没有可用列表' }
          b.cards.push({
            id: 'k' + (++seq),
            columnId: col.id,
            title: str(args && args.title, '').slice(0, 120) || '未命名卡片',
            note: str(args && args.note, '').slice(0, 500),
          })
          await save(wsid)
          return toolResult('已添加卡片到「' + col.title + '」（工作区 ' + wsid + '）', b)
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
        execute: async (args, exec) => {
          const wsid = await wsidOfExec(exec)
          const b = await boardOf(wsid)
          const card = findCard(b, str(args && args.id, ''))
          if (!card) return { ok: false, message: '找不到卡片 ' + str(args && args.id, '') }
          if (typeof args.title === 'string') card.title = args.title.slice(0, 120) || card.title
          if (typeof args.note === 'string') card.note = args.note.slice(0, 500)
          await save(wsid)
          return toolResult('已更新卡片', b)
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
        execute: async (args, exec) => {
          const wsid = await wsidOfExec(exec)
          const b = await boardOf(wsid)
          const id = str(args && args.id, '')
          b.cards = b.cards.filter((c) => c.id !== id)
          await save(wsid)
          return toolResult('已删除卡片', b)
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
        execute: async (args, exec) => {
          const wsid = await wsidOfExec(exec)
          const b = await boardOf(wsid)
          const card = findCard(b, str(args && args.id, ''))
          const target = findColumn(b, str(args && args.columnId, ''))
          if (!card || !target) return { ok: false, message: '找不到卡片或列表' }
          card.columnId = target.id
          await save(wsid)
          return toolResult('已移动到「' + target.title + '」', b)
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
        execute: async (args, exec) => {
          const wsid = await wsidOfExec(exec)
          const b = await boardOf(wsid)
          const title = str(args && args.title, '').slice(0, 40) || '新列表'
          b.columns.push({ id: 'c' + (++seq), title })
          await save(wsid)
          return toolResult('已添加列表「' + title + '」', b)
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
        execute: async (args, exec) => {
          const wsid = await wsidOfExec(exec)
          const b = await boardOf(wsid)
          const col = findColumn(b, str(args && args.id, ''))
          if (!col) return { ok: false, message: '找不到列表' }
          col.title = str(args && args.title, '').slice(0, 40) || col.title
          await save(wsid)
          return toolResult('已重命名列表', b)
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
        execute: async (args, exec) => {
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
      }),
    ]
    for (const tool of tools) harness.registerTool(ctx, tool)
  },
}
