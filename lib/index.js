// dsh-sidechat — host half.
//
// Owns the side-conversation registry for one parent Session and exposes the
// operations twice: once as the `/side` human command (the parent drives
// children) and once as the `sidechat` agent tool (a turn drives them). Both
// callers share one implementation — see `references/user-actions.md` in the
// plugin-development skill.
//
// Child sessions are ordinary continuable subagent children of the parent:
//   - `ctx.subagents.startActivation({ provider: 'fork' | 'spawn', ... })`
//   - their header carries `origin: 'subagent'`, and BOTH the workspace
//     record (they are never attached) and the client list
//     (`sessionVisible()` → `origin === 'subagent'` → false) keep them out of
//     the workspace, which is exactly the requested "attached to the parent's
//     sidebar only" behaviour;
//   - the shipped `ui-subagent` plugin already renders such a child in a
//     right-sidebar chat tab addressed by
//     `dsh-resource://subagentchat/session/<childId>?parent=<pid>&mode=continuable`.
//
// Promotion is a FORK, not an attach: a subagent-origin Session can never be
// rendered by the workspace list, and the ordinary session controller refuses
// to drive it (`hasApiSessionSubagentOwner` → `session/agent-busy`). So
// `promote()` creates a fresh ordinary Session from the child's log and attaches
// that to the workspace. The side conversation survives the promotion.

import { randomUUID } from 'node:crypto'

/** Service dependencies; each is still optional-proofed through `ctx.get`. */
export const inject = ['tools', 'commands', 'subagents']

/** One stable namespace for this plugin's tool and command. */
const NS = 'sidechat'

/**
 * Context modes a side conversation can be created with.
 * `full` and `chat` both use the `fork` provider (the child is seeded with the
 * parent's completed-turn prefix); `chat` additionally strips tool traffic in
 * `prepareSeed`. `fresh` uses `spawn`, which seeds nothing.
 */
const MODES = ['full', 'chat', 'fresh']

/**
 * One provider of ours per mode.
 *
 * Each is registered as a derivation of a shipped provider (see
 * `registerDerived`), so the child's durable `subagent/descriptor` names a
 * provider this plugin owns. That name is the only reliable way to tell a side
 * conversation from an ordinary subagent child of the same parent: the
 * `subagentCatalog` projection carries only `{childId, label, mode}`, and an
 * ordinary subagent is `mode: 'continuable'` exactly like ours.
 */
const PROVIDERS = {
  full: `${NS}-full`,
  chat: `${NS}-chat`,
  fresh: `${NS}-fresh`,
}

/** Fallback vocabulary for automatic process names. */
const NAME_POOL = [
  '侦察', '推演', '试算', '草稿', '旁白', '副本', '分支', '探针',
  '草拟', '校对', '捡漏', '备选', '沙盘', '预演', '碎念', '侧写',
]

/** How long `tell` waits for the target's turn before returning its current tail. */
const REPLY_TIMEOUT_MS = 120_000

/** Resolve one `ctx.get()` service, or fail with an actionable message. */
function need(ctx, name) {
  const service = ctx.get(name)
  if (service === undefined) throw new Error(`${NS}: service "${name}" is not available in this profile`)
  return service
}

/**
 * Strip tool traffic from a fork seed so the child inherits only the
 * conversation. A balanced completed-turn prefix always pairs `tool/call` with
 * `tool/result`, so dropping both keeps the log replayable while removing the
 * assistant's tool-call blocks from the messages the child reads.
 * @param seed - balanced events from the parent's completed-turn prefix.
 * @returns the seed with tool events and their tool-call blocks removed.
 */
function scrubSeed(seed) {
  const dropped = new Set()
  for (const event of seed) {
    if (event.type === 'tool/call') dropped.add(event.data.callId)
  }
  const kept = []
  for (const event of seed) {
    if (event.type === 'tool/call' || event.type === 'tool/result') continue
    if (event.type === 'assistant/message') {
      const content = (event.data.message.content ?? []).filter(
        (block) => block.type !== 'tool-call' || !dropped.has(block.id),
      )
      kept.push({ ...event, data: { ...event.data, message: { ...event.data.message, content } } })
      continue
    }
    kept.push(event)
  }
  return kept
}

/**
 * Register a `fork` provider variant that scrubs tool traffic from its seed.
 *
 * This is how "inherit the conversation but not the tool history" is expressed:
 * the seed a fork child receives is decided by the provider's
 * `prepareContinuable`, so a second provider name over the same fork logic is the
 * supported extension point.
 * @param ctx - Host context.
 * @param providerName - the new provider name to expose.
 * @param baseName - the shipped fork provider to delegate the seed computation to.
 * @returns the disposer, or undefined when the base provider is unavailable.
 */
function registerChatOnlyProvider(ctx, providerName, baseName) {
  return registerDerived(ctx, providerName, baseName, (seed) => scrubSeed(seed))
}

/**
 * Register one provider of ours that delegates to a shipped provider.
 *
 * Two reasons to exist rather than reuse `fork`/`spawn` directly:
 *   1. `mode: 'chat'` needs the seed scrubbed, which only the provider decides.
 *   2. Every side conversation then carries a provider name of ours in its
 *      durable `subagent/descriptor`, which is what lets `list()` tell a side
 *      conversation apart from an ordinary subagent child of the same parent.
 *
 * `prepareContinuable` is a PROTOTYPE method on the shipped provider classes, so
 * it disappears under an object spread; it is forwarded explicitly, and the
 * value fields are read off the instance.
 * @param ctx - Host context.
 * @param providerName - the name to expose.
 * @param baseName - the shipped provider to delegate to.
 * @param scrubSeed - optional seed transform; identity when omitted.
 * @returns the disposer, or undefined when the base provider is unavailable.
 */
function registerDerived(ctx, providerName, baseName, scrubSeed) {
  const subagents = ctx.get('subagents')
  if (subagents === undefined) return undefined
  const base = subagents.getProvider(baseName)
  if (base === undefined) return undefined
  return subagents.registerProvider({
    name: providerName,
    capabilities: base.capabilities,
    inheritsParentContext: base.inheritsParentContext,
    prepareContinuable:
      base.prepareContinuable === undefined
        ? undefined
        : async (request) => {
            const prepared = await base.prepareContinuable(request)
            if (prepared?.seed === undefined) return prepared ?? {}
            return { ...prepared, seed: scrubSeed(prepared.seed) }
          },
    prepare: base.prepare === undefined ? undefined : (request) => base.prepare(request),
  })
}

/** Return `name` when free, else `name-2`, `name-3`, … */
function unique(name, taken) {
  if (!taken.has(name)) return name
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${name}-${index}`
    if (!taken.has(candidate)) return candidate
  }
  return `${name}-${randomUUID().slice(0, 4)}`
}

/**
 * Derive a short, human-readable process name for a new side conversation.
 * Preference: an explicit name, then the first clause of the seed prompt, then a
 * pooled word. The name is display-only; identity is always the Session id.
 * @param requested - caller-supplied name, if any.
 * @param prompt - the first user text the child will see.
 * @param taken - names already used by this parent's children.
 * @returns a label unique under this parent.
 */
function pickName(requested, prompt, taken) {
  const clean = (value) => String(value ?? '').replaceAll(/\s+/gu, ' ').trim()
  const explicit = clean(requested)
  if (explicit !== '') return unique(explicit, taken)
  const clause = clean(prompt).split(/[。！？.!?\n]/u)[0] ?? ''
  if (clause !== '') return unique([...clause].slice(0, 12).join(''), taken)
  for (const base of NAME_POOL) {
    if (!taken.has(base)) return base
    for (let index = 2; index <= 9; index += 1) {
      const candidate = `${base}${index}`
      if (!taken.has(candidate)) return candidate
    }
  }
  return unique(`侧边-${taken.size + 1}`, taken)
}

/** Flatten text blocks; non-text blocks are not shown to a human reader. */
function blocksToText(content) {
  const blocks = Array.isArray(content) ? content : []
  return blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/** Render a conversation tail as compact text for a command or tool result. */
function renderTail(tail) {
  if (tail.length === 0) return '（没有可读内容）'
  return tail
    .map((entry) => `${entry.role === 'user' ? '『用户』' : '『助手』'}${entry.text}`)
    .join('\n\n')
}

/** Parse `/side` arguments: a verb, bare words, and `--key=value` flags. */
function parseArgs(raw) {
  const tokens = String(raw ?? '').trim().split(/\s+/u).filter((token) => token !== '')
  const verb = tokens.shift() ?? 'help'
  const flags = {}
  const words = []
  for (const token of tokens) {
    const match = /^--([a-z][a-z0-9-]*)=(.*)$/u.exec(token)
    if (match === null) words.push(token)
    else flags[match[1]] = match[2]
  }
  return { verb, words, flags }
}

/** Parse a `provider/model` flag value into an `AgentOptions`-shaped route. */
function parseModel(flags) {
  const value = flags.model ?? flags.m
  if (value === undefined || value === '') return undefined
  const slash = value.indexOf('/')
  if (slash < 1) return undefined
  return {
    provider: value.slice(0, slash),
    model: value.slice(slash + 1),
    ...flags.effort === undefined ? {} : { reasoningEffort: flags.effort },
  }
}

/** Format one parent's rows for display. */
function formatRows(parentId, rows) {
  if (rows.length === 0) return '这个对话还没有侧边对话。用 `/side new <提示词>` 建一个。'
  const lines = rows.map((row, index) => {
    const effort = row.model?.reasoningEffort === undefined ? '' : `/${row.model.reasoningEffort}`
    const route = row.model === undefined ? '' : ` [${row.model.provider}/${row.model.model}${effort}]`
    const model = `${route}${row.permission === undefined ? '' : ` {${row.permission}}`}`
    const activity = row.activity === undefined ? '' : `（${row.activity === 'running' ? '运行中' : '空闲'}）`
    return `${index + 1}. ${row.label}${model}${activity} — ${row.childId}`
  })
  return [`${parentId} 的侧边对话（${rows.length}）：`, ...lines].join('\n')
}

/**
 * Resolve a target argument against one parent's children. Accepts a 1-based
 * index, an exact id, or a unique label prefix, so the user never pastes an id.
 */
function resolveTarget(rows, words) {
  const token = words[0]
  if (token === undefined) return undefined
  const index = Number(token)
  if (Number.isInteger(index) && index >= 1 && index <= rows.length) return rows[index - 1]
  const byId = rows.find((row) => row.childId === token)
  if (byId !== undefined) return byId
  const byLabel = rows.filter((row) => row.label.startsWith(token))
  return byLabel.length === 1 ? byLabel[0] : undefined
}

/**
 * The side-conversation service for all parents.
 *
 * Names and models are cached per parent; membership is always re-read from
 * `ctx.subagents.listChildren`, which is authoritative and survives a restart.
 */
class SideChats {
  /** @param ctx - Host context owning this service. */
  constructor(ctx) {
    this.ctx = ctx
    /** @type {Map<string, Map<string, {label: string, mode: string, model?: object}>>} */
    this.cache = new Map()
  }

  /** The cached rows for one parent. */
  rows(parentId) {
    let map = this.cache.get(parentId)
    if (map === undefined) {
      map = new Map()
      this.cache.set(parentId, map)
    }
    return map
  }

  /** Names already in use under one parent. */
  takenNames(parentId) {
    return new Set([...this.rows(parentId).values()].map((row) => row.label))
  }

  /**
   * The deployment's default model route, as configured by `agent-default-model`.
   *
   * Read per creation rather than cached: the service saves a new selection
   * whenever any session switches model, so the default moves during a session.
   * @returns the route, or undefined when no default is configured.
   */
  defaultModel() {
    const selection = this.ctx.get('agentDefaultModel')?.currentSelection()
    if (selection?.provider === undefined || selection?.model === undefined) return undefined
    return {
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
    }
  }

  /**
   * List one parent's side conversations, durable catalog first.
   * @param parentId - the parent Session id.
   * @returns rows ordered by catalog creation order.
   */
  async list(parentId) {
    const subagents = this.ctx.get('subagents')
    const records = this.rows(parentId)
    let catalog = []
    if (subagents !== undefined) {
      try {
        catalog = await subagents.listChildren(parentId)
      } catch {
        // A profile without the catalog projection still lists what we created.
      }
    }
    const seen = new Set()
    const rows = []
    for (const entry of catalog) {
      if (entry.kind === 'diagnostic') continue
      // The catalog lists EVERY direct child of this parent, including ordinary
      // subagents that this plugin must not offer to drive. Ownership is decided
      // by the child's own descriptor provider, which is durable, so a restart
      // does not lose the distinction.
      const known = records.get(entry.id)
      if (known === undefined && !(await this.#ours(entry.id))) {
        seen.add(entry.id)
        continue
      }
      seen.add(entry.id)
      rows.push({
        childId: entry.id,
        label: known?.label ?? entry.label ?? entry.id,
        mode: known?.mode ?? 'chat',
        model: known?.model,
        permission: known?.permission,
        activity: entry.activity,
      })
    }
    for (const [id, known] of records) {
      if (seen.has(id)) continue
      rows.push({
        childId: id,
        label: known.label,
        mode: known.mode,
        model: known.model,
        permission: known.permission,
      })
    }
    return rows
  }

  /**
   * Whether a child Session was created by this plugin.
   *
   * Read from the child's durable `subagent/descriptor`, whose `provider` is the
   * name this plugin registered. Nothing in the parent's catalog projection
   * distinguishes a side conversation from an ordinary subagent, so this is the
   * authoritative test.
   * @param childId - the child Session to classify.
   * @returns true when the descriptor names one of this plugin's providers.
   */
  async #ours(childId) {
    const query = this.ctx.get('sessionQuery')
    if (query === undefined) return false
    let observation
    try {
      observation = await query.observeSession(childId, {})
      const descriptor = observation?.events?.find((event) => event.type === 'subagent/descriptor')
      const provider = descriptor?.data?.provider
      return typeof provider === 'string' && provider.startsWith(`${NS}-`)
    } catch {
      // An unreadable child is treated as not ours: offering to drive a
      // conversation this plugin did not create is worse than hiding one.
      return false
    } finally {
      observation?.dispose?.()
    }
  }

  /**
   * Create one side conversation under `parent`.
   *
   * `delivery: 'parent'` is used when persistence exists, so the child survives a
   * restart and the parent gets a completion notice; without persistence the child
   * can only be ephemeral, which requires `delivery: 'caller'`.
   *
   * The model route is resolved in this order: an explicit `--model` on this
   * call, then the deployment default from `agentDefaultModel`, then whatever the
   * child would inherit from its parent. Naming the deployment default
   * explicitly matters because `resolveChildAgentOptions` spreads
   * `request.agentOptions` LAST over the parent's route — that is what makes a
   * child follow `agent-default-model` rather than the parent's current model.
   *
   * @param parent - exact live parent Agent.
   * @param options - prompt, name, mode and optional model route.
   * @returns the new child's id, label and mode.
   */
  async create(parent, options) {
    const subagents = need(this.ctx, 'subagents')
    const mode = MODES.includes(options.mode) ? options.mode : 'chat'
    const provider = PROVIDERS[mode]
    const label = pickName(options.name, options.prompt, this.takenNames(parent.id))
    const model = options.model ?? this.defaultModel()
    const signal = new AbortController().signal
    const activation = await subagents.startActivation({
      provider,
      label,
      request: {
        parent,
        prompt: [{ type: 'text', text: options.prompt }],
        ...model === undefined ? {} : { agentOptions: model },
        // A side conversation may not open side conversations of its own.
        maxDepth: 1,
      },
      signal,
      delivery: this.ctx.get('sessionPersistence') === undefined ? 'caller' : 'parent',
    })
    const childId = activation.childId
    // Permissions are per Session, so the chosen preset is applied to the child
    // once it exists. `startActivation` has no permission field: it captures the
    // PARENT's policy through `captureDelegatedPolicyOverrides`, which pins the
    // approval policy to `never` and only forwards `auto`/`danger-full-access`.
    // Appending after creation is therefore what lets a side conversation run
    // under a different preset at all.
    if (options.permission !== undefined) this.#applyPermission(childId, options.permission)
    // Record the route that actually took effect, not the raw argument, so the
    // panel shows what the child is really running.
    this.rows(parent.id).set(childId, { label, mode, model, permission: options.permission })
    // Release residency only once the child's first turn has SETTLED. Disposing
    // earlier would cancel it: `dispose()` → `finishDisposal(…, stop=true)` calls
    // `agent.cancel({kind:'parent'})`. After settlement the log is durable, and a
    // later `/side tell` cold-resumes the child from persistence.
    void activation.result
      .catch(() => undefined)
      .then(() => activation.dispose())
      .catch(() => undefined)
    return { childId, label, mode }
  }

  /**
   * Apply one permission preset to a freshly created child.
   *
   * Goes through the `permissionPresets` service rather than appending the event
   * by hand, because the preset is a bundle of sandbox mode plus approval
   * policy and only the service knows the current bundle table.
   * @param childId - the child Session to retarget.
   * @param name - a configured preset name.
   */
  #applyPermission(childId, name) {
    const presets = this.ctx.get('permissionPresets')
    const sessions = this.ctx.get('sessions')
    const session = sessions?.get?.(childId)
    if (presets === undefined || session === undefined) return
    try {
      presets.set(session, name)
    } catch {
      // An unknown preset name is reported by the caller's own validation; a
      // child that keeps the inherited policy is still a working child.
    }
  }

  /**
   * Read the authored tail of one conversation from its log.
   * @param sessionId - the conversation to read.
   * @param limit - how many recent authored messages to keep.
   * @returns `{role, text}` entries, oldest first.
   */
  async read(sessionId, limit = 8) {
    const query = need(this.ctx, 'sessionQuery')
    const observation = await query.observeSession(sessionId, {})
    try {
      const events = observation?.events ?? []
      const authored = []
      for (const event of events) {
        if (event.type === 'user/message') {
          authored.push({ role: 'user', text: blocksToText(event.data.content) })
        } else if (event.type === 'assistant/message') {
          authored.push({ role: 'assistant', text: blocksToText(event.data.message.content) })
        }
      }
      return authored.filter((entry) => entry.text !== '').slice(-limit)
    } finally {
      observation?.dispose?.()
    }
  }

  /**
   * Send one message from `sender` to `targetId`, then wait for the target's
   * turn to settle so the sender reads the reply in the same call.
   *
   * `sendMessage` admits to the nearest step of a running target and starts a
   * turn on an idle one; the wait is `Agent.whenIdle()`, which resolves when the
   * target finishes whatever it was doing, bounded so a long child cannot block
   * the sender's turn forever.
   *
   * @param sender - exact live Agent authorizing the message.
   * @param targetId - durable direct-child or direct-parent Session id.
   * @param text - message body.
   * @param signal - caller cancellation.
   * @returns the target's tail and whether its turn settled in the budget.
   */
  async tell(sender, targetId, text, signal) {
    const subagents = need(this.ctx, 'subagents')
    await subagents.sendMessage(sender, targetId, [{ type: 'text', text }], { signal })
    const agents = this.ctx.get('agents')
    const agent = agents?.get(targetId)
    if (agent !== undefined) {
      const settled = await this.#settle(agent, signal)
      return { tail: await this.read(targetId, 8), settled }
    }
    // An absent child was cold-resumed by sendMessage; its log is the read face.
    return { tail: await this.read(targetId, 8), settled: true }
  }

  /**
   * Await one Agent's idle transition under a deadline.
   * @returns whether it became idle before the deadline.
   */
  async #settle(agent, signal) {
    if (agent.status !== 'running') return true
    let timer
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), REPLY_TIMEOUT_MS)
    })
    const idle = agent.whenIdle().then(() => true, () => false)
    try {
      return await Promise.race([idle, timeout])
    } finally {
      clearTimeout(timer)
      if (signal?.aborted === true) return false
    }
  }

  /**
   * Promote one side conversation into a real workspace conversation.
   *
   * A fork, not an attach: `sessionController.fork()` builds a new ordinary
   * Session whose `meta` deliberately omits `origin` and `parentSession` — which
   * is what makes the workspace list willing to render it — and then attaches it
   * to a workspace, resolving that workspace by walking the child's lineage up to
   * the first ancestor that is already a member. The side conversation itself is
   * untouched and stays usable.
   * @param childId - the side conversation to promote.
   * @returns the new ordinary Session id.
   */
  async promote(childId) {
    const controller = need(this.ctx, 'sessionController')
    const result = await controller.fork({ sessionId: childId })
    const newId = result?.sessionId ?? result
    if (typeof newId !== 'string') throw new Error(`${NS}: fork() 没有返回新的会话 id`)
    return newId
  }

  /**
   * Change one conversation's model in place.
   *
   * `sessionController.selectModel` refuses subagent-owned Sessions, so this
   * reaches the live Agent's `model` facade, which appends the same
   * `model/selection` event the controller would have written. A conversation
   * with no live Agent takes the route at its next start instead.
   * @param childId - the conversation whose route changes.
   * @param selection - provider, model and optional reasoning effort.
   * @returns whether a live Agent took the change now.
   */
  setModel(childId, selection) {
    const agent = this.ctx.get('agents')?.get(childId)
    if (agent?.model === undefined) return false
    agent.model.select(selection)
    for (const map of this.cache.values()) {
      const row = map.get(childId)
      if (row !== undefined) row.model = selection
    }
    return true
  }
}

/**
 * The shared operation surface. The `/side` command and the `sidechat` tool both
 * call these, so behaviour cannot drift between the two callers.
 */
function createOperations(ctx, service) {
  return {
    list: (parentId) => service.list(parentId),

    async create(parent, args) {
      const prompt = args.words.join(' ').trim()
      if (prompt === '') throw new Error('`/side new` 需要一段提示词，例如：/side new 帮我核对这份参数的边界条件')
      return service.create(parent, {
        prompt,
        name: args.flags.name,
        mode: args.flags.mode,
        model: parseModel(args.flags),
        permission: args.flags.permission,
      })
    },

    async read(parentId, args) {
      const rows = await service.list(parentId)
      const target = resolveTarget(rows, args.words)
      if (target === undefined) throw new Error(`找不到目标对话。现有：${names(rows)}`)
      const limit = Number(args.flags.limit ?? 8)
      return { target, tail: await service.read(target.childId, Number.isFinite(limit) ? limit : 8) }
    },

    async tell(parent, parentId, args, signal) {
      const rows = await service.list(parentId)
      const target = resolveTarget(rows, args.words)
      if (target === undefined) throw new Error(`找不到目标对话。现有：${names(rows)}`)
      const text = args.words.slice(1).join(' ').trim()
      if (text === '') throw new Error('要给侧边对话发消息，请在名字后面附上正文')
      return { target, reply: await service.tell(parent, target.childId, text, signal) }
    },

    async promote(parentId, args) {
      const rows = await service.list(parentId)
      const target = resolveTarget(rows, args.words)
      if (target === undefined) throw new Error(`找不到目标对话。现有：${names(rows)}`)
      return { target, newId: await service.promote(target.childId) }
    },

    async setModel(parentId, args) {
      const rows = await service.list(parentId)
      const target = resolveTarget(rows, args.words)
      if (target === undefined) throw new Error(`找不到目标对话。现有：${names(rows)}`)
      const model = parseModel(args.flags)
      if (model === undefined) throw new Error('请用 --model=provider/model 指定模型')
      return { target, applied: service.setModel(target.childId, model), model }
    },
  }
}

/** One-line list of a parent's conversation names, for error messages. */
function names(rows) {
  return rows.map((row) => row.label).join('、') || '（空）'
}

const HELP = [
  '/side 用法：',
  '  /side new <提示词> [--name=名字] [--mode=full|chat|fresh] [--model=p/m] [--effort=级别] [--permission=预设]',
  '  /side list',
  '  /side read <名字|序号> [--limit=8]',
  '  /side tell <名字|序号> <正文>',
  '  /side promote <名字|序号>',
  '  /side model <名字|序号> --model=provider/model [--effort=high]',
].join('\n')

/** Register the `/side` command. */
function registerCommand(ctx, operations) {
  const commands = ctx.get('commands')
  if (commands === undefined) return
  commands.register({
    name: 'side',
    description: '管理侧边对话：new 新建 / list 列表 / read 读取 / tell 发消息 / promote 提级 / model 换模型',
    input: { hint: 'new <提示词> | list | read <名字> | tell <名字> <正文> | promote <名字> | model <名字> --model=p/m' },
    handler: async ({ agent, rawInput, signal }) => {
      const args = parseArgs(rawInput)
      const parentId = agent.session.header.id
      try {
        switch (args.verb) {
          case 'new': {
            const created = await operations.create(agent, args)
            return { kind: 'success', text: `已新建侧边对话「${created.label}」（${created.mode}）。在右侧栏切换过去，或用 /side read ${created.label} 查看。` }
          }
          case 'list':
            return { kind: 'success', text: formatRows(parentId, await operations.list(parentId)) }
          case 'read': {
            const { target, tail } = await operations.read(parentId, args)
            return { kind: 'success', text: `「${target.label}」最近的内容：\n\n${renderTail(tail)}` }
          }
          case 'tell': {
            const { target, reply } = await operations.tell(agent, parentId, args, signal)
            const note = reply.settled ? '' : '\n\n（对方还在跑，以上是目前为止的内容）'
            return { kind: 'success', text: `已发给「${target.label}」。它回复：\n\n${renderTail(reply.tail)}${note}` }
          }
          case 'promote': {
            const { target, newId } = await operations.promote(parentId, args)
            if (newId === undefined) return { kind: 'error', text: `「${target.label}」提级失败：找不到它所属的工作区` }
            return { kind: 'success', text: `「${target.label}」已提级为正式对话 ${newId}，工作区里可以看到它；原来的侧边对话保留。` }
          }
          case 'model': {
            const { target, applied, model } = await operations.setModel(parentId, args)
            return {
              kind: 'success',
              text: `「${target.label}」→ ${model.provider}/${model.model}：${applied ? '已生效' : '该对话当前不在运行，下次启动时生效'}。`,
            }
          }
          default:
            return { kind: 'success', text: HELP }
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/**
 * Register the agent-facing tool.
 *
 * `tools.register` takes plain JSON Schema (it calls `assertSupportedJsonSchema`),
 * so required fields are named in the object-level `required` array rather than
 * flagged per property. `output.schema` describes the value `execute` returns.
 */
function registerTools(ctx, operations) {
  const tools = ctx.get('tools')
  if (tools === undefined) return
  tools.register({
    name: 'sidechat',
    description: [
      'Manage side conversations attached to this conversation.',
      'Actions: new (create one from a prompt), list, read (read one\'s recent messages),',
      'tell (send it a message and read its reply), model (switch its model),',
      'promote (turn it into a normal workspace conversation).',
      'A side conversation inherits this conversation\'s context according to "mode".',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['new', 'list', 'read', 'tell', 'model', 'promote'],
          description: 'Which side-conversation operation to perform.',
        },
        name: { type: 'string', description: 'Target conversation: its label, its session id, or its 1-based index from "list".' },
        prompt: { type: 'string', description: 'For "new": the first user message the side conversation receives.' },
        text: { type: 'string', description: 'For "tell": the message body to deliver.' },
        mode: {
          type: 'string',
          enum: MODES,
          description: 'For "new": full = inherit the conversation plus its tool traffic; chat = inherit only the conversation; fresh = inherit nothing.',
        },
        provider: { type: 'string', description: 'For "new" and "model": LLM provider id.' },
        model: { type: 'string', description: 'For "new" and "model": model id within that provider.' },
        reasoningEffort: { type: 'string', description: 'For "new" and "model": optional reasoning effort id.' },
        permission: { type: 'string', description: 'For "new": optional permission preset name for the new conversation.' },
        limit: { type: 'integer', description: 'For "read": how many recent messages to return.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: { text: { type: 'string' } },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(input, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error(`${NS}: sidechat requires an owning agent session`)
      const parentId = agent.session.header.id
      const route = input.provider !== undefined && input.model !== undefined
        ? {
            provider: input.provider,
            model: input.model,
            ...input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort },
          }
        : undefined
      const args = {
        words: input.name === undefined ? [] : [input.name],
        flags: {
          ...input.mode === undefined ? {} : { mode: input.mode },
          ...route === undefined ? {} : { model: `${route.provider}/${route.model}` },
          ...input.reasoningEffort === undefined ? {} : { effort: input.reasoningEffort },
          ...input.permission === undefined ? {} : { permission: input.permission },
          ...input.limit === undefined ? {} : { limit: String(input.limit) },
        },
      }
      switch (input.action) {
        case 'new': {
          if (input.prompt === undefined) throw new Error('new requires prompt')
          const created = await operations.create(agent, { words: [input.prompt], flags: args.flags })
          return { text: `Created side conversation "${created.label}" (${created.mode}, id ${created.childId}).` }
        }
        case 'list':
          return { text: formatRows(parentId, await operations.list(parentId)) }
        case 'read': {
          const { target, tail } = await operations.read(parentId, args)
          return { text: `「${target.label}」：\n\n${renderTail(tail)}` }
        }
        case 'tell': {
          if (input.name === undefined) throw new Error('tell requires name')
          if (input.text === undefined) throw new Error('tell requires text')
          const { target, reply } = await operations.tell(agent, parentId, { words: [input.name, input.text] }, exec.signal)
          return { text: `「${target.label}」回复：\n\n${renderTail(reply.tail)}` }
        }
        case 'promote': {
          const { target, newId } = await operations.promote(parentId, args)
          return { text: `Promoted 「${target.label}」 to ${String(newId)}.` }
        }
        case 'model': {
          const { target, applied, model } = await operations.setModel(parentId, args)
          return { text: `「${target.label}」→ ${model.provider}/${model.model}：${applied ? '已生效' : '下次启动生效'}` }
        }
        default:
          throw new Error(`unknown action ${String(input.action)}`)
      }
    },
  })
}

/**
 * Give a child Agent the upward channel.
 *
 * Registered per child rather than globally: a prompt section on the plugin's own
 * context would reach the parent too, and the parent does not need to be told it
 * can talk to itself.
 * @param ctx - Host context.
 */
function registerChildPromptSection(ctx) {
  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt === undefined) return
  // The event payload is `{ agent }`, NOT the Agent itself. Reading it as the
  // agent threw inside a listener, which fails the whole `agent/created`
  // dispatch and therefore every session creation.
  ctx.on('agent/created', ({ agent }) => {
    const header = agent?.session?.header
    if (header === undefined) return
    if (header.origin !== 'subagent' || header.parentSession === undefined) return
    agent.ctx.effect(() => systemPrompt.section({
      name: `${NS}:parent-channel`,
      order: 630,
      text: [
        '你是一个侧边对话，附着在一个父对话的侧边栏里,不会单独出现在工作区中。',
        '父对话可以随时读取你的内容、给你发消息；你也可以主动向它汇报结论。',
        `需要它知道结论时，调用 sidechat 工具的 tell 动作，name 填父对话的会话 id：${header.parentSession}。`,
        '父对话只读你的文字输出，看不到你的工具调用过程，所以把它需要知道的结论写进正文。',
      ].join('\n'),
    }), `${NS}: child prompt section`)
  })
}

/** Host plugin body. */
export function apply(ctx) {
  const service = new SideChats(ctx)
  const operations = createOperations(ctx, service)
  // `registerProvider` is itself a Cordis effect and returns its own disposer,
  // so it is called directly rather than wrapped in a second `ctx.effect`.
  registerDerived(ctx, PROVIDERS.full, 'fork', (seed) => seed)
  registerChatOnlyProvider(ctx, PROVIDERS.chat, 'fork')
  registerDerived(ctx, PROVIDERS.fresh, 'spawn', (seed) => seed)
  registerCommand(ctx, operations)
  registerTools(ctx, operations)
  registerChildPromptSection(ctx)
}
