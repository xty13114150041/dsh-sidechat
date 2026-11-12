window.__ModuleLoader__.load({
  id: 'dsh-sidechat',
  factory(require) {
    // ── Platform base ────────────────────────────────────────────────────────
    // react and react/jsx-runtime are seeded by the shell; every other module is
    // reached through an injected service, never through a Harness Client import.
    const React = require('react')
    const h = React.createElement

    // ── Identity ────────────────────────────────────────────────────────────
    /** This plugin's tab implementation id; ALSO the slot key for its body. */
    const MANAGER_ID = 'dsh-sidechat'
    /** The kind the shipped ui-subagent plugin owns. Opened, never redefined. */
    const CHAT_KIND = 'subagentchat'
    /** Resource prefix the shipped plugin's address parser accepts. */
    const CHAT_PREFIX = 'dsh-resource://subagentchat/session/'
    /** Guide entry id; independent of the kind so it can be pinned separately. */
    const GUIDE_ID = 'sidechat'
    /** Locale namespace. */
    const NS = 'sidechat'

    /**
     * The chat resource address for one child Session — byte-identical to what
     * `parseSubagentChatAddress` in ui-subagent accepts, so that plugin claims it.
     */
    function chatAddress(childId, parentId) {
      const query = new URLSearchParams({ parent: parentId, mode: 'continuable' })
      return `${CHAT_PREFIX}${encodeURIComponent(childId)}?${query}`
    }

    // ── Dictionaries ────────────────────────────────────────────────────────
    const zh = {
      'meta.title': '侧边对话',
      'meta.description': '在当前对话的右侧栏派生可切换的子对话：继承上下文、可换模型、可互相传话，并能提级为正式对话。',
      'tab.title': '侧边对话',
      'guide.title': '侧边对话',
      'guide.description': '在当前对话旁派生一个子对话，不进工作区列表',
      'list.empty': '还没有侧边对话。下面写一句话就能开一个。',
      'composer.placeholder': '这个侧边对话从哪里接着想？例如：帮我把刚才的结论核对一遍',
      'create': '新建',
      'creating': '创建中…',
      'open': '打开',
      'close': '关闭',
      'promote': '提级',
      'promote.title': '提级为工作区里的正式对话',
      'refresh': '刷新',
      'mode.label': '上下文',
      'mode.chat': '仅对话内容',
      'mode.full': '含工具记录',
      'mode.fresh': '不带上下文',
      'model.label': '模型',
      'model.default': '默认模型',
      'effort.label': '思考',
      'effort.default': '默认强度',
      'permission.label': '权限',
      'permission.inherit': '随当前对话',
      'running': '运行中',
      'idle': '空闲',
      'empty.hint': '侧边对话会继承当前对话的上下文，但不会出现在左侧的工作区列表里。',
    }
    const en = {
      'meta.title': 'Side chat',
      'meta.description': 'Derive switchable side conversations from the current conversation in the right sidebar: inherit context, switch models, message back and forth, and promote one into a workspace conversation.',
      'tab.title': 'Side chats',
      'guide.title': 'Side chats',
      'guide.description': 'Derive a side conversation beside this one, outside the workspace list',
      'list.empty': 'No side conversations yet. Describe one below to start.',
      'composer.placeholder': 'Where should this side conversation pick up? e.g. double-check the conclusions above',
      'create': 'New',
      'creating': 'Creating…',
      'open': 'Open',
      'close': 'Close',
      'promote': 'Promote',
      'promote.title': 'Promote into a real workspace conversation',
      'refresh': 'Refresh',
      'mode.label': 'Context',
      'mode.chat': 'Conversation only',
      'mode.full': 'With tool history',
      'mode.fresh': 'No context',
      'model.label': 'Model',
      'model.default': 'Default model',
      'effort.label': 'Effort',
      'effort.default': 'Default effort',
      'permission.label': 'Permission',
      'permission.inherit': 'Follow this conversation',
      'running': 'Running',
      'idle': 'Idle',
      'empty.hint': 'A side conversation inherits this conversation\'s context but never appears in the workspace list.',
    }

    /** Fallback translator when the locale service is absent. */
    function bareTranslate(dict, key) {
      return dict[key] ?? key
    }

    // ── Styling (theme tokens only) ─────────────────────────────────────────
    const v = (name) => `var(${name})`

    const styles = {
      root: {
        display: 'flex',
        flexDirection: 'column',
        blockSize: '100%',
        minBlockSize: 0,
        color: v('--dsw-alias-label-primary'),
        font: 'inherit',
      },
      header: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '10px 12px',
        borderBlockEnd: `0.5px solid ${v('--dsw-alias-border-l3')}`,
        flex: 'none',
      },
      heading: {
        flex: 1,
        minInlineSize: 0,
        fontSize: '13px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      smallButton: {
        flex: 'none',
        padding: '2px 7px',
        fontSize: '12px',
        lineHeight: 1.5,
        color: v('--dsw-alias-label-secondary'),
        background: 'transparent',
        border: `0.5px solid ${v('--dsw-alias-border-l3')}`,
        borderRadius: '6px',
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      scroll: {
        flex: 1,
        minBlockSize: 0,
        overflowY: 'auto',
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      },
      empty: {
        padding: '28px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        textAlign: 'center',
        fontSize: '12px',
        lineHeight: 1.6,
        color: v('--dsw-alias-label-tertiary'),
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 10px',
        borderRadius: '8px',
        background: v('--dsw-alias-bg-layer-1'),
        border: `0.5px solid ${v('--dsw-alias-border-l3')}`,
      },
      dot: (running) => ({
        inlineSize: '6px',
        blockSize: '6px',
        borderRadius: '50%',
        flex: 'none',
        background: running ? v('--dsw-alias-label-primary') : v('--dsw-alias-border-l3'),
      }),
      rowBody: {
        flex: 1,
        minInlineSize: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '1px',
      },
      rowLabel: {
        fontSize: '13px',
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      rowMeta: {
        fontSize: '11px',
        lineHeight: 1.4,
        color: v('--dsw-alias-label-tertiary'),
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      composer: {
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '10px 12px',
        borderBlockStart: `0.5px solid ${v('--dsw-alias-border-l3')}`,
      },
      textarea: {
        inlineSize: '100%',
        boxSizing: 'border-box',
        minBlockSize: '58px',
        resize: 'vertical',
        padding: '8px 10px',
        fontSize: '13px',
        lineHeight: 1.5,
        color: v('--dsw-alias-label-primary'),
        background: v('--dsw-alias-bg-layer-1'),
        border: `0.5px solid ${v('--dsw-alias-border-l3')}`,
        borderRadius: '8px',
        fontFamily: 'inherit',
      },
      controls: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      },
      select: {
        flex: 1,
        minInlineSize: 0,
        padding: '5px 6px',
        fontSize: '12px',
        color: v('--dsw-alias-label-primary'),
        background: v('--dsw-alias-bg-layer-1'),
        border: `0.5px solid ${v('--dsw-alias-border-l3')}`,
        borderRadius: '6px',
        fontFamily: 'inherit',
      },
      primary: (enabled) => ({
        flex: 'none',
        padding: '6px 14px',
        fontSize: '12px',
        fontWeight: 600,
        color: v('--dsw-alias-bg-layer-1'),
        background: v('--dsw-alias-label-primary'),
        border: 'none',
        borderRadius: '6px',
        cursor: enabled ? 'pointer' : 'default',
        opacity: enabled ? 1 : 0.4,
        fontFamily: 'inherit',
      }),
      notice: (error) => ({
        flex: 'none',
        padding: '8px 12px',
        fontSize: '12px',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        color: error ? v('--dsw-alias-label-primary') : v('--dsw-alias-label-tertiary'),
      }),
    }

    /**
     * The parent's side conversations.
     *
     * The subagent catalog projection is the authoritative list — the host writes
     * it per parent, so children created in an earlier session, or by the model
     * through the sidechat tool, appear here too. The flat session summaries are
     * the fallback when that projection is not loaded yet.
     */
    function rowsOf(list, parentId) {
      const catalog = list?.projectionsBySession?.[parentId]?.values?.subagentCatalog
      const byId = list?.byId ?? {}
      const rows = []
      if (Array.isArray(catalog)) {
        for (const entry of catalog) {
          if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') continue
          if (entry.kind === 'diagnostic') continue
          const summary = byId[entry.id]
          rows.push({
            id: entry.id,
            label: entry.label ?? entry.id,
            running: entry.activity === 'running' || summary?.running === true,
          })
        }
      }
      if (rows.length > 0) return rows
      for (const summary of Object.values(byId)) {
        if (summary === null || typeof summary !== 'object') continue
        if (summary.origin !== 'subagent') continue
        if (summary.parentSessionId !== parentId) continue
        rows.push({
          id: summary.sessionId ?? summary.id,
          label: summary.title ?? summary.sessionId ?? '—',
          running: summary.running === true,
        })
      }
      return rows
    }

    /**
     * The manager body.
     *
     * Every operation goes through the shipped session command channel
     * (`binding.session.command(line)`), so this UI and a typed `/side` line run
     * exactly the same host code — one operation, two callers.
     */
    function ManagerBody(props) {
      // `sessionId` is a standard slot prop (the owning Session of this tab), so
      // the manager needs no tab-info hook: it always manages its own session's
      // side conversations.
      const { sessionId: parentId, useSessions, sessions, sidebarRight, remote, t } = props
      const list = useSessions((value) => value)

      const rows = React.useMemo(() => rowsOf(list, parentId), [list, parentId])
      const [prompt, setPrompt] = React.useState('')
      const [mode, setMode] = React.useState('chat')
      const [route, setRoute] = React.useState('')
      const [effort, setEffort] = React.useState('')
      const [permission, setPermission] = React.useState('')
      const [models, setModels] = React.useState([])
      const [efforts, setEfforts] = React.useState([])
      const [permissions, setPermissions] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [rowBusy, setRowBusy] = React.useState(undefined)
      const [notice, setNotice] = React.useState(undefined)

      /**
       * Load the model catalog and permission presets once.
       *
       * Both are Host-generation catalogs read through `ctx.remote`, the same
       * source the composer's own seats use, so the pickers cannot drift from
       * what the Host will actually accept. A missing namespace (an older
       * profile) leaves the picker empty and the request on defaults.
       */
      React.useEffect(() => {
        let live = true
        const catalog = remote?.session
        if (catalog?.modelCatalog !== undefined) {
          catalog.modelCatalog()
            .then((response) => {
              if (!live || response?.ok !== true) return
              setModels((response.value.groups ?? []).flatMap((group) => group.models.map((model) => ({
                provider: group.id,
                providerName: group.name,
                id: model.id,
                name: model.name,
                efforts: model.reasoning?.efforts ?? [],
                defaultEffort: model.reasoning?.defaultEffort,
              }))))
            })
            .catch(() => undefined)
        }
        const presets = remote?.permissionPresets
        if (presets?.catalog !== undefined) {
          presets.catalog()
            .then((response) => {
              if (!live || response?.ok !== true) return
              setPermissions(response.value.options ?? [])
            })
            .catch(() => undefined)
        }
        return () => { live = false }
      }, [remote])

      const selected = React.useMemo(
        () => models.find((model) => `${model.provider}/${model.id}` === route),
        [models, route],
      )
      // Effort options come from the chosen model's own reasoning table; a model
      // without one hides the picker entirely.
      React.useEffect(() => {
        setEfforts(selected?.efforts ?? [])
        setEffort(selected?.defaultEffort ?? '')
      }, [selected])

      /**
       * Run one `/side` line through this session's own command executor.
       *
       * `sessions.using` retains a reference for the duration of the call, which
       * is what makes the session's command channel reachable from a tab body
       * (a tab does not itself hold a reference). The host logs the command's
       * lifecycle into the conversation as a flow node, so the reply text is
       * shown there — here we only learn whether the line matched a command.
       */
      const runSide = React.useCallback(async (line) => {
        try {
          return await sessions.using(
            parentId,
            { source: 'controllerOperation' },
            (reference) => reference.session.command(line),
          )
        } catch (error) {
          setNotice({ error: true, text: error instanceof Error ? error.message : String(error) })
          return undefined
        }
      }, [parentId, sessions])

      const create = async () => {
        const text = prompt.trim()
        if (text === '' || busy) return
        setBusy(true)
        setNotice(undefined)
        const flags = [
          `--mode=${mode}`,
          route === '' ? '' : `--model=${route}`,
          effort === '' ? '' : `--effort=${effort}`,
          permission === '' ? '' : `--permission=${permission}`,
        ].filter((part) => part !== '').join(' ')
        try {
          const result = await runSide(`/side new ${text} ${flags}`)
          if (result?.ok === false) {
            setNotice({ error: true, text: result.error?.message ?? '新建失败' })
            return
          }
          setPrompt('')
          // Pull the parent's catalog forward so the new row appears without a
          // manual refresh. Opening it is left to the user: the row's "open"
          // button is where a chat tab is created.
          void sessions.refreshProjections?.(parentId)
          setNotice({ error: false, text: '已新建，结果见主对话。列表刷新后点「打开」进入它。' })
        } finally {
          setBusy(false)
        }
      }

      const promote = async (row) => {
        setRowBusy(row.id)
        setNotice(undefined)
        try {
          const result = await runSide(`/side promote ${row.id}`)
          if (result?.ok === false) setNotice({ error: true, text: result.error?.message ?? '提级失败' })
        } finally {
          setRowBusy(undefined)
        }
      }

      const openChat = (row) => {
        sidebarRight.openResource(chatAddress(row.id, parentId), {
          kind: CHAT_KIND,
          preferNewPane: true,
        })
      }

      const closeChat = (row) => {
        const address = chatAddress(row.id, parentId)
        const openTabs = typeof sidebarRight.tabsIn === 'function' ? sidebarRight.tabsIn(parentId) : []
        for (const tabRecord of openTabs) {
          if (tabRecord.contentId === address) sidebarRight.close(tabRecord.id)
        }
      }

      const canCreate = prompt.trim() !== '' && !busy

      return h('div', { style: styles.root, 'data-sidechat-manager': '' },
        h('div', { style: styles.header },
          h('div', { style: styles.heading }, t('tab.title')),
          h('button', {
            type: 'button',
            style: styles.smallButton,
            title: t('refresh'),
            onClick: () => void sessions.refreshProjections?.(parentId),
          }, '↻'),
        ),
        h('div', { style: styles.scroll },
          rows.length === 0
            ? h('div', { style: styles.empty },
                h('span', null, t('list.empty')),
                h('span', null, t('empty.hint')),
              )
            : rows.map((row) => h('div', { key: row.id, style: styles.row, 'data-sidechat-row': row.id },
                h('span', { style: styles.dot(row.running), title: row.running ? t('running') : t('idle') }),
                h('div', { style: styles.rowBody },
                  h('span', { style: styles.rowLabel, title: row.id }, row.label),
                  h('span', { style: styles.rowMeta }, row.running ? t('running') : t('idle')),
                ),
                h('button', {
                  type: 'button',
                  style: styles.smallButton,
                  onClick: () => openChat(row),
                }, t('open')),
                h('button', {
                  type: 'button',
                  style: styles.smallButton,
                  title: t('promote.title'),
                  disabled: rowBusy === row.id,
                  onClick: () => void promote(row),
                }, rowBusy === row.id ? '…' : t('promote')),
                h('button', {
                  type: 'button',
                  style: styles.smallButton,
                  title: t('close'),
                  onClick: () => closeChat(row),
                }, '✕'),
              )),
        ),
        notice === undefined ? null : h('div', { style: styles.notice(notice.error) }, notice.text),
        h('div', { style: styles.composer },
          h('textarea', {
            style: styles.textarea,
            value: prompt,
            placeholder: t('composer.placeholder'),
            onChange: (event) => setPrompt(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void create()
              }
            },
          }),
          h('div', { style: styles.controls },
            h('select', {
              style: styles.select,
              value: mode,
              'aria-label': t('mode.label'),
              onChange: (event) => setMode(event.target.value),
            },
              h('option', { value: 'chat' }, t('mode.chat')),
              h('option', { value: 'full' }, t('mode.full')),
              h('option', { value: 'fresh' }, t('mode.fresh')),
            ),
            models.length === 0 ? null : h('select', {
              style: styles.select,
              value: route,
              'aria-label': t('model.label'),
              onChange: (event) => setRoute(event.target.value),
            },
              h('option', { value: '' }, t('model.default')),
              ...models.map((model) => h('option', {
                key: `${model.provider}/${model.id}`,
                value: `${model.provider}/${model.id}`,
              }, `${model.providerName} · ${model.name}`)),
            ),
            efforts.length === 0 ? null : h('select', {
              style: styles.select,
              value: effort,
              'aria-label': t('effort.label'),
              onChange: (event) => setEffort(event.target.value),
            },
              efforts.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.name ?? entry.id)),
            ),
            permissions.length === 0 ? null : h('select', {
              style: styles.select,
              value: permission,
              'aria-label': t('permission.label'),
              onChange: (event) => setPermission(event.target.value),
            },
              h('option', { value: '' }, t('permission.inherit')),
              ...permissions.map((option) => h('option', {
                key: option.value,
                value: option.value,
              }, option.name ?? option.value)),
            ),
            h('button', {
              type: 'button',
              style: styles.primary(canCreate),
              disabled: !canCreate,
              onClick: () => void create(),
            }, busy ? t('creating') : t('create')),
          ),
        ),
      )
    }

    // ── Plugin body ─────────────────────────────────────────────────────────
    // Only the panel's own dependencies are injected. The model and permission
    // catalogs are reached through `ctx.get('remote')` instead, so a profile
    // without those Host namespaces still gets a working panel minus the pickers.
    const inject = ['slots', 'sidebarRight', 'sessions', 'locale', 'remote']

    function apply(ctx) {
      const locale = ctx.get('locale')
      const t = locale === undefined
        ? (key) => bareTranslate(zh, key)
        : locale.bind(NS)

      if (locale !== undefined) {
        ctx.effect(() => locale.register(NS, { zh, en }), 'dsh-sidechat: dictionaries')
      }

      // The dynamic Client half's ctx allows only effect/on/once/provide and the
      // timer helpers: `ctx.inject` is not one of them and throws, which is why the
      // tab never registered. Read every service off `ctx` instead — declared names
      // arrive as properties, and `sidebarRightTabs` is published with
      // `ctx.reflect.provide` by the shipped ui-sidebar-right plugin, so it is
      // reached with `ctx.get`.
      const tabs = ctx.sidebarRightTabs ?? ctx.get('sidebarRightTabs')
      if (tabs !== undefined) {
        const slots = ctx.slots
        const sessions = ctx.sessions
        const sidebarRight = ctx.sidebarRight
        const remote = ctx.remote ?? ctx.get('remote')

        ctx.effect(() => tabs.register({
          id: MANAGER_ID,
          kind: 'sidechat',
          priority: 'extension',
          title: () => t('tab.title'),
          keepMounted: true,
          guide: [{
            id: GUIDE_ID,
            order: 20,
            title: () => t('guide.title'),
            description: () => t('guide.description'),
          }],
        }), 'dsh-sidechat: tab type')

        ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register({
          name: 'sidebar.right.pane.tab',
          key: MANAGER_ID,
        }, (props) => h(ManagerBody, {
          ...props,
          sessions,
          sidebarRight,
          remote,
          t,
        }))), 'dsh-sidechat: tab body')
      }
    }

    return { name: 'dsh-sidechat', inject, apply }
  },
})
