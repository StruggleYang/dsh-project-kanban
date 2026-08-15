# dsh-project-kanban

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 中把「项目看板」变成对话的一部分：浏览器端看板 UI + Agent 可调用的 `kanban_*` 工具 + 磁盘持久化。

> 这是一个由对话生成的动态插件（Dynamic Cordis Plugin）：宿主端持有数据，通过私有 RPC 服务浏览器 UI，并通过模型工具让 Agent 在规划时直接写卡。

## 功能

- 会话头部新增「看板」标签页（与「对话 / 轨迹」平级，注册于 `conversation.view` 视图环）
- 多列表看板：待办 / 进行中 / 已完成，列表可添加、重命名、删除
- 卡片：添加（标题 + 备注）、内联编辑、删除、**拖拽移动**或 ←/→ 按钮移动
- **Agent 对话联动**：8 个模型工具，做复杂项目功能拆解与规划时由 Agent 直接调用写卡
- **磁盘持久化**：每次改动自动写入 `kanban-board.json`（位于 `sandboxPolicy.workspaceRoot`），刷新页面与重启进程不丢数据
- 全部使用主题 token 配色，自动适配亮 / 暗色

## Agent 工具一览

| 工具 | 用途 |
|---|---|
| `kanban_get` | 读取看板当前状态（规划前先看，避免重复建卡） |
| `kanban_add_card` | 添加卡片（拆解任务 → 写一张卡） |
| `kanban_update_card` | 更新卡片标题 / 备注 |
| `kanban_delete_card` | 删除卡片 |
| `kanban_move_card` | 移动卡片（任务状态变化时调用） |
| `kanban_add_column` | 添加列表（新工作流阶段） |
| `kanban_rename_column` | 重命名列表 |
| `kanban_delete_column` | 删除列表（卡片并入第一个列表） |

## 安装

### 方式一：动态插件（最快）

在 DeepSeek Harness Web 界面中告诉 Agent：

> 编写一个项目看板插件

或直接把本仓库 `src/host.js` 作为 `code.host`、`src/client.js` 作为 `code.client`，通过 cordis_define 定义插件，再 cordis_run 激活（首次激活需要一次授权）。

### 方式二：作为安装包 / preset

（TODO：转换为标准 dsh 插件包后补充）

## 使用

1. 激活插件后，在会话顶部标签栏点击「看板」
2. 手动管理卡片，或让 Agent 在规划时自动写卡，例如：*"把 X 项目的功能拆解写入看板"*
3. Agent 会先 `kanban_get` 看现状，再逐条 `kanban_add_card`，状态变化时 `kanban_move_card`

## 架构

- **Host 半边**（Node 进程）：内存看板 + 8 个私有 RPC 方法（`harness.handle`）+ 8 个模型工具（`harness.defineTool` / `harness.registerTool`）+ 通过 `ctx.fs` 落盘
- **Client 半边**（浏览器）：注册到 `conversation.view` 插槽（`id: 'kanban'`），React 组件，经 `host.call` 与宿主通信
- **数据模型**：`{ columns: [{ id, title }], cards: [{ id, columnId, title, note }] }`

## 文件

| 文件 | 说明 |
|---|---|
| `src/host.js` | 宿主端代码（cordis_define 的 `code.host` 函数体） |
| `src/client.js` | 浏览器端代码（cordis_define 的 `code.client` 函数体） |
| `TWEET.md` | 配套推文（中文 / 英文） |

## License

MIT © 2026 StruggleYang
