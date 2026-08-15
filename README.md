# dsh-project-kanban

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 中把「项目看板」变成对话的一部分：Agent 通过 `kanban_*` 工具在规划时直接写卡，按工作区（项目）隔离，磁盘持久化。

这是一个**官方 bundle 格式**的插件包（`dsh.bundle` 声明 + `cordis.patch.yml` 补丁层），通过官方 `dsh plugin` 流程安装。

## 功能

- **Agent 对话联动**：8 个模型工具 `kanban_get / kanban_add_card / kanban_update_card / kanban_delete_card / kanban_move_card / kanban_add_column / kanban_rename_column / kanban_delete_column`——做复杂项目功能拆解与规划时由 Agent 直接调用写卡
- **按工作区（项目）隔离**：每个工作区一块独立看板——新开工作区看到的是自己的空板，互不串扰；Agent 工具按当前会话所属工作区自动定位目标看板
- **磁盘持久化**：每次改动自动写入 `kanban-board-<workspaceId>.json`（位于 `sandboxPolicy.workspaceRoot`），刷新页面与重启进程不丢数据
- **浏览器看板 UI**（可选）：动态插件版提供「看板」标签页（卡片拖拽、增删改），源码见 `src/`

## 安装（官方推荐方式）

### 前置要求

- 已安装 `dsh` CLI（`npx @deepseek-ai/dsh` 或源码运行 `pnpm dsh`）
- 选择目标 **profile**（`web` 是浏览器界面默认 profile；自定义 profile 用自己的名字）

### 方式一：从 GitHub 安装（推荐）

```sh
dsh plugin --profile web add github:StruggleYang/dsh-project-kanban
```

**pnpm ≥ 10 会拒绝执行 git 依赖的 `prepare` 脚本，第一次 `add` 会失败。** 按提示把 pnpm 打印的包键写入 profile 的 `pnpm-workspace.yaml`（位于 `$DSH_HOME/profiles/web/pnpm-workspace.yaml`）：

```yaml
allowBuilds:
  dsh-project-kanban: true
```

然后重新执行 `add` 即可。

> ⚠️ **安全说明**：`allowBuilds` 等于允许该包在安装时于你机器上执行代码（在 Agent 沙箱之外）。只允许你信任的源码，并建议**锁定 commit**：
>
> ```sh
> dsh plugin --profile web add github:StruggleYang/dsh-project-kanban#<commit-sha>
> ```

### 方式二：从本地 checkout 安装

```sh
git clone https://github.com/StruggleYang/dsh-project-kanban.git
dsh plugin --profile web add ./dsh-project-kanban
```

### 方式三：tarball / npm（构建产物，无需任何构建许可）

tarball 可从 **GitHub Release** 下载（<https://github.com/StruggleYang/dsh-project-kanban/releases/latest>），或本地生成：

```sh
pnpm pack        # 在仓库目录生成 dsh-project-kanban-0.1.0.tgz
dsh plugin --profile web add ./dsh-project-kanban-0.1.0.tgz
```

发布到 npm 后用户直接安装：

```sh
dsh plugin --profile web add dsh-project-kanban
```

### 验证与启用

```sh
dsh --profile web --dump-config   # 输出末尾应出现 "# == dsh-project-kanban" 层
```

然后**重启 `dsh web`**（bundle 行在启动时装载，运行中的实例不会热加载）。启动后 Agent 的工具集里就有 8 个 `kanban_*` 工具，对它说"把 X 项目的功能拆解写入看板"即可。

### 卸载

```sh
dsh plugin --profile web remove dsh-project-kanban
```

同时移除依赖和组合层；数据文件 `kanban-board-*.json` 保留在磁盘上。

## 工作原理

- 本包是一个 **bundle**（npm 包 + 配置层）：`package.json` 声明 `dsh.bundle.patch`，安装时 `dsh` 把它追加进 profile 的 `dsh.profile.bundles` 列表（`@deepseek-ai/dsh-base` 之后）
- `cordis.patch.yml` 向组合插入一行 `dsh-project-kanban`，Loader 按包名从 profile 的 `node_modules` 解析
- `index.js` 是标准 Cordis 函数插件（`export const name` / `export const inject` / `export function apply`），经 `ctx.tools.register` 注册 8 个工具
- 工具执行时经 `exec.agent.session.header.cwd` → `ctx.workspaceRegistry.resolveByPath` 反查当前工作区，写进对应项目的看板
- 层顺序：`@deepseek-ai/dsh-base` → 本 bundle → profile 自己的 `cordis.patch.yml` → 用户 `--patch` 覆盖；后面的层按行 id 覆盖前面的层

## Agent 工具一览

| 工具 | 用途 |
|---|---|
| `kanban_get` | 读取当前项目看板状态（规划前先看，避免重复建卡） |
| `kanban_add_card` | 添加卡片（拆解任务 → 写一张卡） |
| `kanban_update_card` | 更新卡片标题 / 备注 |
| `kanban_delete_card` | 删除卡片 |
| `kanban_move_card` | 移动卡片（任务状态变化时调用） |
| `kanban_add_column` | 添加列表（新工作流阶段） |
| `kanban_rename_column` | 重命名列表 |
| `kanban_delete_column` | 删除列表（卡片并入第一个列表） |

## 浏览器看板 UI（动态插件版）

官方 bundle 目前提供 Agent 工具 + 持久化。带「看板」标签页 UI 的版本是动态插件（通过 `cordis_define` 定义、`cordis_run` 激活，激活需一次授权）：

- `src/host.js` — 动态插件宿主端代码（`code.host` 函数体）
- `src/client.js` — 动态插件浏览器端代码（`code.client` 函数体）

在 DeepSeek Harness Web 界面中对 Agent 说"编写一个项目看板插件"，或直接把两个文件的内容作为 `code.host` / `code.client` 传入 `cordis_define`。

## 文件结构

```
dsh-project-kanban/
├── package.json       # bundle manifest（dsh.bundle 声明）
├── cordis.patch.yml   # 补丁层：插入看板插件行
├── index.js           # 宿主插件（ctx.tools.register 注册 8 个工具）
├── src/host.js        # 动态插件版宿主端（含浏览器 RPC）
├── src/client.js      # 动态插件版浏览器端（看板 UI）
├── README.md
├── TWEET.md
└── LICENSE
```

## License

MIT © 2026 StruggleYang
