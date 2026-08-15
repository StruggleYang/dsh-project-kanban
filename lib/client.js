/**
 * dsh-project-kanban — 浏览器端 bundle（手写 __ModuleLoader__ 闭包格式）
 *
 * 加载机制（官方 client-modules）：
 *  - 包的 package.json 声明 dsh.client（platform: 'web'）+ exports["./client"] 指向本文件
 *  - 宿主 client-modules 把它编入 __DSH_BOOT__ 图，浏览器以 classic script 加载本文件，
 *    本文件调用 window.__ModuleLoader__.load({ id, factory }) 只注册工厂；
 *    工厂在物化时执行，require 由模块表应答（'react' 是平台种子词）。
 *
 * 通信：不依赖动态插件的 host.call（沙箱专属），改为同源 fetch 调宿主注册的
 * webServer 前缀路由 /api/kanban（官方 webServer 扩展点）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-project-kanban',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // 样式：手写 bundle 无构建期 CSS 管线，用 style 标签注入（带标记去重）
    const STYLE_TAG = 'data-dsh-kanban'
    const CSS = '.kan-filter{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}.kan-filter .kan-input{width:180px;}.kan-card-due{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:4px;}.kan-card-due-overdue{color:var(--dsw-alias-state-error-primary);font-weight:600;}.kan-root{display:flex;flex-direction:column;gap:12px;height:100%;min-height:420px;padding:16px 20px;box-sizing:border-box;}.kan-header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}.kan-header h2{font-size:17px;font-weight:650;margin:0;color:var(--dsw-alias-label-primary);}.kan-sub{font-size:12px;color:var(--dsw-alias-label-secondary);}.kan-error{font-size:12px;color:var(--dsw-alias-state-error-primary);}.kan-board{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;flex:1;min-height:0;padding-bottom:8px;}.kan-col{width:272px;flex:none;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px;max-height:100%;box-sizing:border-box;}.kan-col.kan-drop{border-color:var(--dsw-alias-brand-primary);}.kan-col-head{display:flex;align-items:center;gap:6px;min-height:26px;}.kan-col-title{font-size:14px;font-weight:600;margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);}.kan-count{font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:999px;padding:0 8px;}.kan-col-body{display:flex;flex-direction:column;gap:8px;overflow-y:auto;min-height:56px;}.kan-card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;cursor:grab;}.kan-card.dragging{opacity:.45;}.kan-card-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-word;}.kan-card-note{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:4px;white-space:pre-wrap;word-break:break-word;}.kan-card-actions{display:flex;gap:4px;margin-top:8px;flex-wrap:wrap;}.kan-card-edit{display:flex;flex-direction:column;gap:6px;}.kan-btn{font-size:12px;color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:2px 8px;cursor:pointer;font-family:inherit;}.kan-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);}.kan-btn.primary{color:var(--dsw-alias-bg-base);background:var(--dsw-alias-brand-primary);border-color:transparent;font-weight:600;}.kan-btn.danger{color:var(--dsw-alias-state-error-primary);}.kan-btn:disabled{opacity:.45;cursor:default;}.kan-input{font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:5px 8px;width:100%;box-sizing:border-box;font-family:inherit;}.kan-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary);}.kan-textarea{resize:vertical;min-height:52px;}.kan-add{display:flex;flex-direction:column;gap:6px;}.kan-add-actions{display:flex;gap:6px;}.kan-add-btn{width:100%;padding:6px 0;color:var(--dsw-alias-label-secondary);}.kan-empty{font-size:12px;color:var(--dsw-alias-label-secondary);padding:12px 4px;text-align:center;}.kan-col-add{background:transparent;border-style:dashed;justify-content:center;}.kan-col-add-btn{width:272px;flex:none;align-self:flex-start;padding:12px;text-align:center;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;cursor:pointer;font-size:13px;font-family:inherit;}.kan-col-add-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);}.kan-hint{font-size:11px;color:var(--dsw-alias-label-secondary);}'

    // 标签颜色映射（固定 4 类 + 未知灰色）
    const LABEL_COLORS = { 功能: '#38bdf8', 缺陷: '#f87171', 文档: '#34d399', 优化: '#fbbf24' }
    const LABEL_OPTIONS = ['功能', '缺陷', '文档', '优化']
    const labelChip = (label) => {
      if (!label) return null
      const color = LABEL_COLORS[label] || '#94a3b8'
      return h('span', {
        key: 'lbl',
        style: {
          display: 'inline-block', fontSize: 10.5, lineHeight: 1, fontWeight: 600,
          color: '#0b1220', background: color, borderRadius: 999, padding: '3px 8px', marginBottom: 6,
        },
      }, label)
    }
    const PRIORITY_META = { high: { label: '高', color: '#f87171' }, medium: { label: '中', color: '#fbbf24' }, low: { label: '低', color: '#38bdf8' } }
    const prioritySelect = (value, onChange) => h('select', {
      className: 'kan-input', value: value || '', onChange,
    }, [
      h('option', { key: 'none', value: '' }, '无优先级'),
      h('option', { key: 'high', value: 'high' }, '高'),
      h('option', { key: 'medium', value: 'medium' }, '中'),
      h('option', { key: 'low', value: 'low' }, '低'),
    ])
    const labelSelect = (value, onChange) => h('select', {
      className: 'kan-input', value: value || '', onChange,
    }, [
      h('option', { key: 'none', value: '' }, '无标签'),
      ...LABEL_OPTIONS.map((l) => h('option', { key: l, value: l }, l)),
    ])

    const injectStyles = () => {
      if (document.querySelector('style[' + STYLE_TAG + ']') !== null) return
      const el = document.createElement('style')
      el.setAttribute(STYLE_TAG, '')
      el.textContent = CSS
      document.head.appendChild(el)
    }

    const emptyDraft = { title: '', note: '', label: '', priority: '', color: '', dueDate: '', open: false }

    function KanbanView(props) {
      const sessionId = props && props.sessionId
      const useWorkspaces = props && props.useWorkspaces
      const items = useWorkspaces ? useWorkspaces((s) => s.items) : []
      const recentId = useWorkspaces ? useWorkspaces((s) => s.recentWorkspaceId) : undefined
      const workspace = Array.isArray(items)
        ? items.find((w) => Array.isArray(w.sessionIds) && w.sessionIds.includes(sessionId))
        : undefined
      const workspaceId = workspace ? workspace.workspaceId : (recentId || 'default')
      const workspaceTitle = workspace ? workspace.title : (workspaceId === 'default' ? '默认工作区' : '未知工作区')

      const [board, setBoard] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [persisted, setPersisted] = React.useState(false)
      const [drafts, setDrafts] = React.useState({})
      const [editId, setEditId] = React.useState(null)
      const [editDraft, setEditDraft] = React.useState({ title: '', note: '', label: '', priority: '', color: '', dueDate: '' })
      const [renameId, setRenameId] = React.useState(null)
      const [renameDraft, setRenameDraft] = React.useState('')
      const [newColOpen, setNewColOpen] = React.useState(false)
      const [newColDraft, setNewColDraft] = React.useState('')
      const [dragId, setDragId] = React.useState(null)
      const [filter, setFilter] = React.useState({ query: '', label: '', priority: '' })
      const today = new Date().toISOString().slice(0, 10)

      const callHost = (method, args) => fetch('/api/kanban', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, args: Object.assign({}, args || {}, { workspaceId }) }),
      }).then((r) => r.json())

      const applyRes = (res) => {
        if (res && res.board) {
          setBoard(res.board)
          setError('')
        }
        if (res && typeof res.persisted === 'boolean') setPersisted(res.persisted)
      }

      React.useEffect(() => {
        let alive = true
        callHost('kanban.get', {}).then((res) => {
          if (alive) applyRes(res)
        }).catch((e) => {
          if (alive) setError('看板加载失败：' + String((e && e.message) || e))
        })
        return () => { alive = false }
      }, [workspaceId])

      const act = (method, args) => {
        setBusy(true)
        callHost(method, args).then(applyRes).catch((e) => {
          setError('操作失败：' + String((e && e.message) || e))
        }).then(() => setBusy(false))
      }

      const move = (card, delta) => {
        if (!board) return
        const idx = board.columns.findIndex((c) => c.id === card.columnId)
        const target = board.columns[idx + delta]
        if (target) act('kanban.moveCard', { id: card.id, columnId: target.id })
      }
      const shiftInColumn = (card, delta) => {
        if (!board) return
        const inCol = board.cards.filter((c) => c.columnId === card.columnId)
        const idx = inCol.indexOf(card)
        const to = idx + delta
        if (to < 0 || to >= inCol.length) return
        act('kanban.moveCard', { id: card.id, columnId: card.columnId, toIndex: to })
      }
      const startEdit = (card) => {
        setEditId(card.id)
        setEditDraft({ title: card.title, note: card.note || '', label: card.label || '', priority: card.priority || '', color: card.color || '', dueDate: card.dueDate || '' })
      }
      const saveEdit = (card) => {
        act('kanban.updateCard', { id: card.id, title: editDraft.title, note: editDraft.note, label: editDraft.label, priority: editDraft.priority, color: editDraft.color, dueDate: editDraft.dueDate })
        setEditId(null)
      }
      const setDraft = (columnId, patch) => setDrafts((d) => ({ ...d, [columnId]: { ...(d[columnId] || emptyDraft), ...patch } }))
      const submitAdd = (columnId) => {
        const d = drafts[columnId]
        if (d && d.title && d.title.trim()) {
          act('kanban.addCard', { columnId, title: d.title, note: d.note || '', label: d.label || undefined, priority: d.priority || undefined, color: d.color || undefined, dueDate: d.dueDate || undefined })
        }
        setDraft(columnId, { ...emptyDraft, open: false })
      }
      const submitNewCol = () => {
        if (newColDraft.trim()) act('kanban.addColumn', { title: newColDraft })
        setNewColOpen(false)
        setNewColDraft('')
      }

      const renderCard = (card) => {
        const editing = editId === card.id
        const prio = card.priority ? PRIORITY_META[card.priority] : null
        const cardStyle = {}
        if (card.color) cardStyle.background = card.color + '40'
        if (prio) cardStyle.borderLeft = '4px solid ' + prio.color
        const body = editing
          ? h('div', { className: 'kan-card-edit' }, [
              h('input', { key: 't', className: 'kan-input', value: editDraft.title, placeholder: '卡片标题', onChange: (e) => setEditDraft({ ...editDraft, title: e.target.value }), onKeyDown: (e) => { if (e.key === 'Enter') saveEdit(card) } }),
              labelSelect(editDraft.label, (e) => setEditDraft({ ...editDraft, label: e.target.value })),
              prioritySelect(editDraft.priority, (e) => setEditDraft({ ...editDraft, priority: e.target.value })),
              h('div', { key: 'c', className: 'kan-add-actions' }, [
                h('input', { key: 'ci', type: 'color', value: editDraft.color || '#38bdf8', onChange: (e) => setEditDraft({ ...editDraft, color: e.target.value }) }),
                h('button', { key: 'cx', className: 'kan-btn', title: '清除颜色', onClick: () => setEditDraft({ ...editDraft, color: '' }) }, '清除颜色'),
              ]),
              h('div', { key: 'dd', className: 'kan-add-actions' }, [
                h('input', { key: 'di', type: 'date', className: 'kan-input', value: editDraft.dueDate || '', onChange: (e) => setEditDraft({ ...editDraft, dueDate: e.target.value }) }),
                h('button', { key: 'dx', className: 'kan-btn', title: '清除日期', onClick: () => setEditDraft({ ...editDraft, dueDate: '' }) }, '清除日期'),
              ]),
              h('textarea', { key: 'n', className: 'kan-input kan-textarea', value: editDraft.note, placeholder: '备注（可选）', onChange: (e) => setEditDraft({ ...editDraft, note: e.target.value }) }),
            ])
          : h('div', null, [
              labelChip(card.label),
              h('div', { className: 'kan-card-title' }, card.title),
              card.dueDate ? h('div', { key: 'd', className: 'kan-card-due' + (card.dueDate < today ? ' kan-card-due-overdue' : '') }, '📅 ' + card.dueDate + (card.dueDate < today ? ' 已逾期' : '')) : null,
              card.note ? h('div', { className: 'kan-card-note' }, card.note) : null,
            ])
        const actions = h('div', { className: 'kan-card-actions' }, [
          h('button', { key: 'u', className: 'kan-btn', disabled: busy, title: '上移', onClick: () => shiftInColumn(card, -1) }, '↑'),
          h('button', { key: 'dn', className: 'kan-btn', disabled: busy, title: '下移', onClick: () => shiftInColumn(card, 1) }, '↓'),
          h('button', { key: 'l', className: 'kan-btn', disabled: busy, title: '移到左列', onClick: () => move(card, -1) }, '←'),
          h('button', { key: 'r', className: 'kan-btn', disabled: busy, title: '移到右列', onClick: () => move(card, 1) }, '→'),
          h('button', { key: 'c', className: 'kan-btn', disabled: busy, title: '复制卡片', onClick: () => act('kanban.duplicateCard', { id: card.id }) }, '复制'),
          h('button', { key: 'e', className: 'kan-btn', disabled: busy, onClick: () => (editing ? saveEdit(card) : startEdit(card)) }, editing ? '保存' : '编辑'),
          h('button', { key: 'd', className: 'kan-btn danger', disabled: busy, onClick: () => act('kanban.deleteCard', { id: card.id }) }, '删除'),
        ])
        return h('div', {
          key: card.id,
          className: 'kan-card' + (dragId === card.id ? ' dragging' : ''),
          style: cardStyle,
          draggable: true,
          onDragStart: (e) => { e.dataTransfer.setData('text/plain', card.id); setDragId(card.id) },
          onDragEnd: () => setDragId(null),
        }, [body, actions])
      }

      const matchesFilter = (card) => {
        if (filter.query && !(card.title + ' ' + (card.note || '')).includes(filter.query)) return false
        if (filter.label && (card.label || '') !== filter.label) return false
        if (filter.priority && (card.priority || '') !== filter.priority) return false
        return true
      }
      const filterBar = h('div', { key: 'fb', className: 'kan-filter' }, [
        h('input', { key: 'q', className: 'kan-input', placeholder: '搜索关键词…', value: filter.query, onChange: (e) => setFilter({ ...filter, query: e.target.value }) }),
        h('select', { key: 'l', className: 'kan-input', value: filter.label, onChange: (e) => setFilter({ ...filter, label: e.target.value }) }, [
          h('option', { key: 'all', value: '' }, '全部标签'),
          ...LABEL_OPTIONS.map((l) => h('option', { key: l, value: l }, l)),
        ]),
        h('select', { key: 'p', className: 'kan-input', value: filter.priority, onChange: (e) => setFilter({ ...filter, priority: e.target.value }) }, [
          h('option', { key: 'all', value: '' }, '全部优先级'),
          h('option', { key: 'high', value: 'high' }, '高'),
          h('option', { key: 'medium', value: 'medium' }, '中'),
          h('option', { key: 'low', value: 'low' }, '低'),
        ]),
        (filter.query || filter.label || filter.priority) ? h('button', { key: 'x', className: 'kan-btn', onClick: () => setFilter({ query: '', label: '', priority: '' }) }, '清除筛选') : null,
      ])
      const renderColumn = (col) => {
        const cards = board.cards.filter((c) => c.columnId === col.id && matchesFilter(c))
        const renaming = renameId === col.id
        const head = renaming
          ? h('div', { className: 'kan-col-head' }, [
              h('input', { key: 'i', className: 'kan-input', value: renameDraft, autoFocus: true, onChange: (e) => setRenameDraft(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') { act('kanban.renameColumn', { id: col.id, title: renameDraft }); setRenameId(null) } } }),
              h('button', { key: 's', className: 'kan-btn primary', onClick: () => { act('kanban.renameColumn', { id: col.id, title: renameDraft }); setRenameId(null) } }, '保存'),
            ])
          : h('div', { className: 'kan-col-head' }, [
              h('h3', { key: 't', className: 'kan-col-title' }, col.title),
              h('span', { key: 'n', className: 'kan-count' }, '' + cards.length),
              h('button', { key: 'r', className: 'kan-btn', title: '重命名列表', onClick: () => { setRenameId(col.id); setRenameDraft(col.title) } }, '重命名'),
              h('button', { key: 'x', className: 'kan-btn danger', title: '删除列表', disabled: board.columns.length <= 1, onClick: () => act('kanban.deleteColumn', { id: col.id }) }, '删除'),
            ])
        const draft = drafts[col.id]
        const addForm = draft && draft.open
          ? h('div', { className: 'kan-add' }, [
              h('input', { key: 't', className: 'kan-input', value: draft.title || '', placeholder: '卡片标题', onChange: (e) => setDraft(col.id, { title: e.target.value }), onKeyDown: (e) => { if (e.key === 'Enter') submitAdd(col.id) } }),
              labelSelect(draft.label, (e) => setDraft(col.id, { label: e.target.value })),
              prioritySelect(draft.priority, (e) => setDraft(col.id, { priority: e.target.value })),
              h('div', { key: 'c', className: 'kan-add-actions' }, [
                h('input', { key: 'ci', type: 'color', value: draft.color || '#38bdf8', onChange: (e) => setDraft(col.id, { color: e.target.value }) }),
                h('button', { key: 'cx', className: 'kan-btn', title: '清除颜色', onClick: () => setDraft(col.id, { color: '' }) }, '清除颜色'),
              ]),
              h('input', { key: 'dd', type: 'date', className: 'kan-input', value: draft.dueDate || '', onChange: (e) => setDraft(col.id, { dueDate: e.target.value }) }),
              h('textarea', { key: 'n', className: 'kan-input kan-textarea', value: draft.note || '', placeholder: '备注（可选）', onChange: (e) => setDraft(col.id, { note: e.target.value }) }),
              h('div', { key: 'b', className: 'kan-add-actions' }, [
                h('button', { className: 'kan-btn primary', onClick: () => submitAdd(col.id) }, '添加'),
                h('button', { className: 'kan-btn', onClick: () => setDraft(col.id, { ...emptyDraft, open: false }) }, '取消'),
              ]),
            ])
          : h('button', { className: 'kan-btn kan-add-btn', onClick: () => setDraft(col.id, { ...emptyDraft, open: true }) }, '+ 添加卡片')
        const cardList = cards.length === 0
          ? h('div', { className: 'kan-empty' }, '暂无卡片')
          : cards.map(renderCard)
        return h('div', {
          key: col.id,
          className: 'kan-col' + (dragId ? ' kan-drop' : ''),
          onDragOver: (e) => e.preventDefault(),
          onDrop: (e) => {
            e.preventDefault()
            const id = e.dataTransfer.getData('text/plain') || dragId
            if (id) act('kanban.moveCard', { id, columnId: col.id })
            setDragId(null)
          },
        }, [head, h('div', { className: 'kan-col-body' }, cardList), addForm])
      }

      if (!board) {
        return h('div', { className: 'kan-root' }, error ? h('div', { className: 'kan-error' }, error) : h('div', { className: 'kan-empty' }, '看板加载中…'))
      }
      const total = board.cards.length
      const newColForm = newColOpen
        ? h('div', { className: 'kan-col kan-col-add' }, [
            h('input', { key: 'i', className: 'kan-input', value: newColDraft, placeholder: '列表名称', autoFocus: true, onChange: (e) => setNewColDraft(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') submitNewCol() } }),
            h('div', { key: 'b', className: 'kan-add-actions' }, [
              h('button', { className: 'kan-btn primary', onClick: submitNewCol }, '创建'),
              h('button', { className: 'kan-btn', onClick: () => { setNewColOpen(false); setNewColDraft('') } }, '取消'),
            ]),
          ])
        : h('button', { className: 'kan-col-add-btn', onClick: () => setNewColOpen(true) }, '+ 添加列表')

      return h('div', { className: 'kan-root' }, [
        h('div', { className: 'kan-header' }, [
          h('h2', null, '项目看板 · ' + workspaceTitle),
          h('span', { className: 'kan-sub' }, '' + total + ' 张卡片 · 按工作区隔离 · 拖拽或 ← → 移动'),
          error ? h('span', { className: 'kan-error' }, error) : null,
        ]),
        filterBar,
        h('div', { className: 'kan-board' }, [...board.columns.map(renderColumn), newColForm]),
        h('div', { className: 'kan-hint' }, persisted ? '数据已持久化到磁盘（按工作区分文件），重启不丢失。' : '内存模式：刷新页面不丢失；停止插件或重启进程后清空。'),
      ])
    }

    return {
      name: 'dsh-project-kanban',
      inject: ['slots'],
      apply(ctx) {
        injectStyles()
        const slots = ctx.get('slots')
        if (slots === undefined) return
        slots.inject('conversation.view', () => slots.register(
          { name: 'conversation.view', id: 'kanban', order: 20, label: '看板' },
          (props) => h(KanbanView, props),
        ))
      },
    }
  },
})
