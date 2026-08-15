# dsh-project-kanban

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 中把「项目看板」变成对话的一部分：Agent 通过 `kanban_*` 工具在规划时直接写卡，按工作区（项目）隔离，磁盘持久化。

这是一个**官方 bundle 格式**的插件包（`dsh.bundle` 声明 + `cordis.patch.yml` 补丁层），通过官方 `dsh plugin` 流程安装。

## 功能

- **Agent 对话联动**：9 个模型工具 `kanban_get / kanban_add_card / kanban_update_card / kanban_delete_card / kanban_move_card / kanban_add_column / kanban_rename_column / kanban_delete_column`——做复杂项目功能拆解与规划时由 Agent 直接调用写卡
- **按工作区（项目）隔离**：每个工作区一块独立看板——新开工作区看到的是自己的空板，互不串扰；Agent 工具按当前会话所属工作区自动定位目标看板
- **磁盘持久化**：每次改动自动写入 `kanban-board-<workspaceId>.json`（位于 `sandboxPolicy.workspaceRoot`），刷新页面与重启进程不丢数据
- **浏览器看板 UI**：安装即得「看板」标签页（卡片拖拽、增删改），无需额外安装
- **标签与颜色**：功能（蓝）/ 缺陷（红）/ 文档（绿）/ 优化（橙），添加或编辑卡片时选择；Agent 工具的 `label` 参数同样支持
- **优先级**：高 / 中 / 低，卡片左侧色条标识（红 / 橙 / 蓝）
- **自定义卡片颜色**：任意 #rrggbb 背景色（编辑表单取色器）
- **列内排序与复制**：卡片 ↑ / ↓ 按钮（或 `toIndex` 参数）调整列内顺序；一键复制卡片（含标签/优先级/颜色）
- **筛选与搜索**：顶部按关键词 / 标签 / 优先级过滤
- **截止日期**：YYYY-MM-DD，逾期自动红色标记
- **回收站**：删除为软删除，可恢复或彻底删除
- **批量操作**：多选卡片批量移动 / 设标签 / 删除
- **统计条**：总数 / 标签 / 优先级 / 逾期分布
- **拖拽列内排序**：拖到目标卡片位置即插入
- **看板模板**：默认 / 开发 / 内容预设（只增列不破坏数据）
- **撤销**：所有写操作可撤销（50 步）
- **跨工作区移动**：卡片一键移到其他项目的看板
- **会话引用**：Agent 创建的卡片记录来源会话，可点击跳转

## 测试

无 key 端到端验证（不需要 `DEEPSEEK_API_KEY`）：创建临时 profile → 安装本地包 → boot web 组合 → 断言工具 schema 与 HTTP 全流程。

```sh
bash scripts/verify.sh
```

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
| `kanban_add_card` | 添加卡片（拆解任务 → 写一张卡，可带 `label` 标签） |
| `kanban_update_card` | 更新卡片标题 / 备注 / 标签 |
| `kanban_delete_card` | 删除卡片 |
| `kanban_move_card` | 移动卡片（跨列，或 `toIndex` 列内重排） |
| `kanban_add_column` | 添加列表（新工作流阶段） |
| `kanban_rename_column` | 重命名列表 |
| `kanban_duplicate_card` | 复制卡片（含标签/优先级/颜色） |
| `kanban_delete_column` | 删除列表（卡片并入第一个列表） |

## 动态插件版（历史参考）

0.2.0 起 bundle 已内置浏览器 UI，动态插件版（`src/host.js` / `src/client.js`，通过 `cordis_define` 激活）仅作为动态加载场景的参考实现保留。

## 文件结构

```
dsh-project-kanban/
├── package.json       # bundle manifest（dsh.bundle 声明）
├── cordis.patch.yml   # 补丁层：插入看板插件行
├── index.js           # 宿主插件（8 个工具 + /api/kanban 数据层）
├── lib/client.js      # 浏览器端 bundle（看板 UI，官方 client-modules 格式）
├── src/host.js        # 动态插件版宿主端（历史参考）
├── src/client.js      # 动态插件版浏览器端（历史参考）
├── README.md
├── TWEET.md
└── LICENSE
```

## License

MIT © 2026 StruggleYang
