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
      const { useTabInfo, useSessions, sessions, sidebarRight, t } = props
      const tab = useTabInfo()
      const parentId = tab.sessionId
      const list = useSessions((value) => value)

      const rows = React.useMemo(() => rowsOf(list, parentId), [list, parentId])
      const [prompt, setPrompt] = React.useState('')
      const [mode, setMode] = React.useState('chat')
      const [busy, setBusy] = React.useState(false)
      const [rowBusy, setRowBusy] = React.useState(undefined)
      const [notice, setNotice] = React.useState(undefined)

      /** Run one `/side` line through the parent's command executor. */
      const runSide = React.useCallback(async (line) => {
        const binding = sessions.binding?.(parentId)
        if (binding?.session?.command === undefined) {
          setNotice({ error: true, text: '当前会话还没有就绪，稍等一下再试。' })
          return undefined
        }
        try {
          return await binding.session.command(line)
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
        try {
          const result = await runSide(`/side new ${text} --mode=${mode}`)
          if (result?.ok === false) {
            setNotice({ error: true, text: result.error?.message ?? '新建失败' })
            return
          }
          setPrompt('')
          // Pull the parent's catalog forward so the new row appears without a
          // manual refresh. Opening it is left to the user: the row's "open"
          // button is where a chat tab is created.
          void sessions.refreshProjections?.(parentId)
          setNotice({ error: false, text: '已新建。列表刷新后点「打开」进入它的对话。' })
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
    const inject = ['slots', 'sidebarRight', 'sidebarRightTabs', 'sessions']

    function apply(ctx) {
      const locale = ctx.get('locale')
      const t = locale === undefined
        ? (key) => bareTranslate(zh, key)
        : locale.bind(NS)

      if (locale !== undefined) {
        ctx.effect(() => locale.register(NS, { zh, en }), 'dsh-sidechat: dictionaries')
      }

      // Both registries are required: the type names an implementation id, and the
      // slot renders the body registered under that same id.
      ctx.inject(['sidebarRightTabs', 'slots', 'sessions', 'sidebarRight'], (scope) => {
        const tabs = scope.sidebarRightTabs
        const slots = scope.slots
        const sessions = scope.sessions
        const sidebarRight = scope.sidebarRight

        scope.effect(() => tabs.register({
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

        scope.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register({
          name: 'sidebar.right.pane.tab',
          key: MANAGER_ID,
        }, (props) => h(ManagerBody, {
          ...props,
          sessions,
          sidebarRight,
          t,
        }))), 'dsh-sidechat: tab body')
      })
    }

    return { name: 'dsh-sidechat', inject, apply }
  },
})
