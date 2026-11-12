# dsh-sidechat

DeepSeek Harness (DSH) 桌面端插件：在**右侧栏**给当前对话派生可切换的「侧边对话」。

侧边对话是父对话的子会话——继承上下文、可以单独换模型、**不会出现在左侧工作区列表**，随时可以提级成一份正式对话。

---

## 它解决什么

一个对话里往往同时装着好几件事：主线在改代码，突然想「顺手核对一下刚才那个结论」「先试试另一条思路」「让它先算一遍再说」。开新对话会丢掉上下文，直接在主线里问又会把主线的上下文搅乱。

侧边对话就是为这种「旁支探索」准备的：它继承主线的上下文，但只待在右侧栏，不占工作区列表、不污染主线的对话流。

## 功能

- **派生**：在右侧栏输入一句话就能开一个侧边对话；三种上下文模式
  - `仅对话内容`（默认）— 继承父对话的对话内容，去掉工具调用记录
  - `含工具记录` — 完整继承，包括工具调用
  - `不带上下文` — 完全空白，只带这一句
- **多开与切换**：一个父对话可以挂多个侧边对话，列表里随时切换
- **自动短名**：新建时自动取一个短名字（优先用你输入的第一句，可 `--name` 指定），方便在标签上认出来
- **单独换模型**：每个侧边对话可以走不同模型，不影响父对话
- **不进工作区**：侧边对话的会话头带 `origin: "subagent"`，且从不加入任何工作区记录，所以左侧列表天然看不到它们
- **双向传话**：父对话和侧边对话可以通过 `/side` 指令互相读取内容和发消息
- **提级**：把某个侧边对话「提升」为工作区里的正式对话（fork 一份出来，原侧边对话保留）
- **聊天界面复用官方实现**：打开侧边对话直接用 `ui-subagent` 已注册的 `subagentchat` 标签，工具卡片、审批、输入框全部现成

## 安装

```bash
# 在 DSH Web GUI 里通过插件管理安装（推荐）
#   插件 → 安装 → 填入本仓库地址

# 或命令行
dsh plugin install <repo>
```

安装后重载窗口，右侧栏的引导页会出现「侧边对话」入口。

## 用法

### 右侧栏

右侧栏 → 引导页 → **侧边对话**。在底部输入框写一句提示，选上下文模式，点新建。列表里每行三个按钮：

| 按钮 | 作用 |
|---|---|
| 打开 | 在右侧栏打开它的对话界面 |
| 提级 | fork 成正式对话，进工作区 |
| ✕ | 关闭它已打开的聊天标签 |

### `/side` 指令

在任意会话的输入框里使用。父对话和子对话都能用：

```
/side new <提示词> [--name=名字] [--mode=full|chat|fresh] [--model=provider/model]
/side list
/side read <名字|序号> [--limit=8]
/side tell <名字|序号> <正文>
/side promote <名字|序号>
/side model <名字|序号> --model=provider/model [--effort=high]
```

`<名字|序号>` 三种写法都行：名字、1 起的序号、或会话 id。

### 模型选择

- 不指定时跟随 **`agent-default-model`** 里配置的部署默认（不是跟随父对话当前的模型）
- `--model=provider/model` 可以给单次新建或单个侧边对话指定模型
- 侧边对话运行中换模型走 `agent.model.select()`，下一轮生效

### 给模型用的工具

除了人工指令，还有 `sidechat` 工具，父对话可以在一个回合里自行派生、读取、传话、提级侧边对话——不需要你手打指令。

## 设计要点

**为什么提级是 fork 而不是 attach。** 子会话有两道硬门挡着，不能被就地「变成」工作区对话：`ui-workspace` 的 `sessionVisible()` 第一行就是 `origin === "subagent"` 直接返回 false；而 `sessionController` 对任何 subagent 血统的会话都会抛 `session/agent-busy`（`hasApiSessionSubagentOwner`），拒绝 `prompt` / `selectModel` / `rename`。所以提级走 `sessionController.fork({sessionId})`：它建一份 `meta` 里**故意不含** `origin` / `parentSession` 的新普通会话，再按血统找到父对话所在的工作区 attach 上去。好处是原侧边对话完整保留。

**为什么「仅对话内容」要自己注册 provider。** fork 的子会话拿到的是父对话到最后一个 `turn/end` 的完整前缀，包括工具调用。这个种子由 provider 的 `prepareContinuable` 决定，所以本插件在 `fork` 之上注册了一个 `sidechat-chat` provider，把 `tool/call`、`tool/result` 以及 assistant 消息里对应的 tool-call block 一并剥掉，让子会话只继承对话本身。

**为什么换模型不用 `selectModel`。** 那是 Remote 方法，对 subagent 血统的会话直接拒绝。宿主侧直接调活着的 Agent 的 `model.select()`，写入的是同一个 `model/selection` 事件。

## 兼容性

- DSH `0.2.2-rc.1`（`package.json` 的 `dsh.compatibility.dshReleases`）
- 依赖已装插件：`dsh-client-ui-sidebar-right`、`dsh-client-ui-subagent`、`dsh-client-locale`

## 许可

MIT
