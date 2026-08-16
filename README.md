# dsh-project-kanban

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

A kanban board inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), integrated with the conversation: the agent writes planning cards via `kanban_*` tools while you talk, boards are isolated per workspace (project), and data is persisted to disk.

This is an official **bundle**-format plugin (`dsh.bundle` declaration + `cordis.patch.yml` patch layer), installed through the official `dsh plugin` flow.

## Features

- **Agent-driven planning**: 9 model tools (`kanban_get`, `kanban_add_card`, `kanban_update_card`, `kanban_delete_card`, `kanban_move_card`, `kanban_duplicate_card`, `kanban_add_column`, `kanban_rename_column`, `kanban_delete_column`) — the agent writes cards directly during planning and feature breakdown
- **Per-workspace isolation**: each workspace (project) has its own board; agent tools resolve the current workspace automatically
- **Disk persistence**: every change is written to `kanban-board-<workspaceId>.json` — survives page refresh and process restarts
- **Browser board UI**: a "看板" (Kanban) tab in the session header, no extra install
- **Labels & colors**: 功能 (feature, blue) / 缺陷 (bug, red) / 文档 (docs, green) / 优化 (optimization, orange)
- **Priority**: high / medium / low with a colored left-edge bar (red / orange / blue)
- **Custom card color**: any `#rrggbb` background via the color picker in the edit form
- **In-column ordering & duplication**: ↑ / ↓ buttons (or the `toIndex` parameter) reorder cards within a column; one-click duplicate copies label/priority/color
- **Filtering & search**: keyword, label, and priority filters at the top of the board
- **Due dates**: YYYY-MM-DD deadline with automatic overdue highlighting
- **Trash & restore**: delete is soft (to the trash); restore or purge from the trash view
- **Bulk operations**: multi-select cards to move / label / trash in one action
- **Stats bar**: totals by label, priority, and overdue count
- **Drag reordering**: drag a card onto another card's position to insert there
- **Templates**: default / dev / content column presets (adds missing columns only)
- **Undo**: every write operation is undoable (50-step stack)
- **Cross-workspace move**: move a card into another project's board
- **Session references**: cards created by the agent record their source session (click to jump back)

## Installation (official flow)

### Prerequisites

- `dsh` CLI installed (`npx @deepseek-ai/dsh` or `pnpm dsh` from source)
- Pick the target **profile** (`web` is the default browser profile)

### Option 1: from GitHub (recommended)

```sh
dsh plugin --profile web add github:StruggleYang/dsh-project-kanban
```

**pnpm ≥ 10 refuses to run a git dependency's `prepare` script on the first try.** Copy the package key pnpm prints into the profile's `pnpm-workspace.yaml` (at `$DSH_HOME/profiles/web/pnpm-workspace.yaml`):

```yaml
allowBuilds:
  dsh-project-kanban: true
```

Then re-run `add`.

> ⚠️ **Security note**: `allowBuilds` grants install-time code execution on your machine. Only allow sources you trust, and consider pinning a commit: `dsh plugin --profile web add github:StruggleYang/dsh-project-kanban#<commit-sha>`

### Option 2: from a local checkout

```sh
git clone https://github.com/StruggleYang/dsh-project-kanban.git
dsh plugin --profile web add ./dsh-project-kanban
```

### Option 3: tarball / npm (no build permission needed)

Download the tarball from the [GitHub Releases](https://github.com/StruggleYang/dsh-project-kanban/releases/latest) page, or build it locally:

```sh
pnpm pack
dsh plugin --profile web add ./dsh-project-kanban-0.3.0.tgz
```

Published to npm:

```sh
dsh plugin --profile web add dsh-project-kanban
```

### Verify and enable

```sh
dsh --profile web --dump-config   # should end with a "# == dsh-project-kanban" layer
```

Then **restart `dsh web`** (bundle rows load at boot). The 8 `kanban_*` tools appear in the agent's toolset, and the "看板" tab appears in the session header.

### Uninstall

```sh
dsh plugin --profile web remove dsh-project-kanban
```

Removes both the dependency and the layer; board data files are kept on disk.

## How it works

- This package is a **bundle** (npm package + config layer): `package.json` declares `dsh.bundle.patch`, and `dsh` appends it to the profile's `dsh.profile.bundles` after `@deepseek-ai/dsh-base`
- `cordis.patch.yml` inserts the `dsh-project-kanban` row; the Loader resolves it by package name from the profile's `node_modules`
- `index.js` is a standard Cordis function plugin (`export const name` / `export const inject` / `export function apply`) registering tools via `ctx.tools.register`
- The browser half (`lib/client.js`) is a hand-written `__ModuleLoader__` closure bundle (official client-modules format): `require('react')` resolves via the platform seed word, and the UI talks to the host through a same-origin `fetch` to the `/api/kanban` webServer route
- Tools resolve the current workspace via `exec.agent.session.header.cwd` → `ctx.workspaceRegistry.resolveByPath`
- Layer order: `@deepseek-ai/dsh-base` → this bundle → the profile's `cordis.patch.yml` → user `--patch` overlays; later layers override earlier rows by id

## Agent tools

| Tool | Purpose |
|---|---|
| `kanban_get` | Read the current board (optional `includeArchived` for the trash) |
| `kanban_add_card` | Add a card (title, note, optional label / priority / color / dueDate) |
| `kanban_update_card` | Update title / note / label / priority / color / dueDate |
| `kanban_delete_card` | Soft-delete into the trash |
| `kanban_restore_card` | Restore a card from the trash |
| `kanban_purge_card` | Permanently delete a card |
| `kanban_bulk_delete_cards` | Bulk soft-delete multiple cards |
| `kanban_move_card` | Move across columns, or reorder within a column via `toIndex` |
| `kanban_duplicate_card` | Duplicate a card (carries all fields) |
| `kanban_move_card_to_workspace` | Move a card to another workspace's board |
| `kanban_undo` | Undo the last write operation |
| `kanban_add_column` / `kanban_rename_column` / `kanban_delete_column` | Column management |

## Testing

Keyless end-to-end verification (no `DEEPSEEK_API_KEY` needed): creates a temporary profile, installs the local package, boots the web composition, and asserts the tool schemas plus the full HTTP workflow.

```sh
bash scripts/verify.sh
```

## Repository layout

```
dsh-project-kanban/
├── package.json       # bundle manifest (dsh.bundle) + client declaration (dsh.client)
├── cordis.patch.yml   # patch layer: inserts the kanban plugin row
├── index.js           # host plugin: 9 tools + /api/kanban data layer
├── lib/client.js      # browser bundle (board UI, official client-modules format)
├── src/host.js        # dynamic-plugin host half (historical reference)
├── src/client.js      # dynamic-plugin browser half (historical reference)
├── README.md          # this file
├── README.zh.md       # 中文说明
├── TWEET.md           # social post drafts (中文 / English)
└── LICENSE
```

## License

MIT © 2026 StruggleYang
