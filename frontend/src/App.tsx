/** Main window, laid out like the desktop app: menu bar, shortcut bar, a
 *  vertical page bar (Welcome/Edit/Properties/Merge/Variables/Print) with
 *  stacked pages, and a status bar. */

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api/client'
import type { Health, Template } from './api/types'
import { createActions } from './app/actions'
import { applyFonts, fetchFonts, type FontFamily } from './app/fonts'
import { useSession, type PageId } from './app/session'
import type { Preferences } from './app/Root'
import { useT, type MessageKey } from './i18n'
import { labelSize } from './editor/label'
import { ProjectTitle } from './components/ProjectTitle'
import { FontsDialog } from './components/FontsDialog'
import { PreferencesDialog } from './components/PreferencesDialog'
import { FileDialog } from './components/FileDialog'
import { SelectProductDialog } from './components/SelectProductDialog'
import { addObject, CREATE_TOOLS, EditorPage } from './pages/EditorPage'
import { FilesPage } from './pages/FilesPage'
import { MergePage } from './pages/MergePage'
import { PrintPage } from './pages/PrintPage'
import { PropertiesPage } from './pages/PropertiesPage'
import { VariablesPage } from './pages/VariablesPage'
import { WelcomePage } from './pages/WelcomePage'
import { Icon } from './ui/Icon'
import { useDialogs } from './ui/dialogs'
import { MenuBar, type Menu } from './ui/MenuBar'
import { OpenOnPhoneDialog } from './components/OpenOnPhoneDialog'
import { formatLength } from './editor/units'

const PAGES: {
  id: PageId
  label: MessageKey
  icon: string
  context?: 'actions' | 'apps'
  theme?: 'glabels-flat' | 'glabels-web'
}[] = [
  { id: 'welcome', label: 'page.welcome', icon: 'glabels', context: 'apps' },
  { id: 'editor', label: 'page.edit', icon: 'glabels-edit' },
  { id: 'properties', label: 'page.properties', icon: 'glabels-properties' },
  { id: 'merge', label: 'page.merge', icon: 'glabels-merge' },
  { id: 'variables', label: 'page.variables', icon: 'glabels-variables' },
  { id: 'print', label: 'page.print', icon: 'glabels-print' },
  // Files does not belong to one document and is therefore always reachable.
  { id: 'files', label: 'page.files', icon: 'folder-full', theme: 'glabels-web' },
]

export default function App({
  preferences,
  onPreferencesChange,
}: {
  preferences: Preferences
  onPreferencesChange: (values: Preferences) => void
}) {
  const t = useT()
  const dialogs = useDialogs()
  const session = useSession(t)
  const [page, setPageState] = useState<PageId>('welcome')

  /** Switching pages first writes whatever is still outstanding. */
  const setPage = useCallback(
    (next: PageId) => {
      setPageState(next)
      void session.flush()
    },
    // session.flush is stable enough; an extra dependency would rebuild the
    // menus on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  type DialogId =
    | 'none'
    | 'new'
    | 'open'
    | 'save-as'
    | 'open-on-phone'
    | 'change-product'
    | 'fonts'
    | 'preferences'
  const [dialog, setDialog] = useState<DialogId>('none')
  const [editingName, setEditingName] = useState(false)
  const [fontFamilies, setFontFamilies] = useState<FontFamily[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [template, setTemplate] = useState<Template | null>(null)

  const { detail, open, save } = session
  const actions = createActions(session)

  const refreshFonts = useCallback(async () => {
    try {
      const families = await fetchFonts()
      setFontFamilies(families)
      applyFonts(families)
    } catch {
      setFontFamilies([])
    }
  }, [])

  useEffect(() => {
    void refreshFonts()
    api.health().then(setHealth).catch(() => setHealth(null))
  }, [refreshFonts])

  useEffect(() => {
    // The unit comes from the server; do not write back what we just got.
    session.setUnit(preferences.unit, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences.unit])

  useEffect(() => {
    if (!detail) return
    api
      .searchTemplates({ q: `${detail.template_brand} ${detail.template_part}`, limit: 1 })
      .then((result) => setTemplate(result.items[0] ?? null))
      .catch(() => setTemplate(null))
  }, [detail])

  const openDocument = useCallback(
    async (id: string) => {
      // Opening another project replaces what is on screen, so whatever is
      // still unsaved from the current one must be written first.
      await session.flush()
      const document = await open(id)
      if (document) {
        setDialog('none')
        setPage('editor')
      }
    },
    // session.flush is stable; see the keyboard effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open],
  )

  const createDocument = useCallback(
    async (chosen: Template) => {
      session.setError(null)
      try {
        const created = await api.createDocument({
          name: `${chosen.brand} ${chosen.part}`,
          brand: chosen.brand,
          part: chosen.part,
        })
        await openDocument(created.id)
      } catch (problem) {
        session.setError(String(problem))
      }
    },
    [openDocument, session],
  )

  const openFromFolder = useCallback(
    async (path: string) => {
      session.setError(null)
      try {
        const created = await api.importFromFile(path)
        await openDocument(created.id)
      } catch (problem) {
        session.setError(String(problem))
        setDialog('none')
      }
    },
    [openDocument, session],
  )

  /** Save like on the desktop: if the project has no file yet, this first
   *  asks for a folder and a name. */
  const saveOrAsk = useCallback(() => {
    if (!detail) return
    if (detail.file_path) void save()
    else setDialog('save-as')
  }, [detail, save])

  const saveAs = useCallback(
    async (path: string, name: string) => {
      if (!detail) return
      session.setError(null)
      try {
        // Commit the latest changes first; they must end up in the file.
        await session.flush()
        const attempt = (overwrite: boolean) => api.saveAs(detail.id, { path, name, overwrite })
        let result
        try {
          result = await attempt(false)
        } catch (problem) {
          if (!(problem instanceof ApiError && problem.status === 409 && problem.message === 'file-exists')) {
            throw problem
          }
          const replace = await dialogs.confirm({
            title: t('file.existsTitle'),
            message: t('file.existsQuestion', { name: name }),
            confirmLabel: t('file.replace'),
            destructive: true,
          })
          // Not replacing: the dialog stays open for another name.
          if (!replace) return
          result = await attempt(true)
        }
        session.setDetail(result)
        session.setStatus('status.savedTo', { path: result.file_path ?? name })
        setDialog('none')
      } catch (problem) {
        session.setError(String(problem instanceof Error ? problem.message : problem))
        setDialog('none')
      }
    },
    [detail, dialogs, session, t],
  )

  const resolveFile = useCallback(
    async (keep: 'app' | 'file') => {
      if (!detail) return
      session.setError(null)
      try {
        await session.flush()
        const result = await api.resolveFile(detail.id, keep)
        // The version from the file has other objects: read it in again.
        if (keep === 'file') await open(result.id)
        else session.setDetail(result)
      } catch (problem) {
        session.setError(String(problem instanceof Error ? problem.message : problem))
      }
    },
    [detail, open, session],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      const mod = event.metaKey || event.ctrlKey

      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (event.shiftKey) {
          if (detail) setDialog('save-as')
        } else saveOrAsk()
        return
      }
      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setDialog('new')
        return
      }
      if (mod && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        setDialog('open')
        return
      }
      if (typing) return

      if (mod) {
        const key = event.key.toLowerCase()
        if (key === 'z') {
          event.preventDefault()
          if (event.shiftKey) session.redo()
          else session.undo()
          return
        }
        if (key === 'x') { event.preventDefault(); actions.cut(); return }
        if (key === 'c') { event.preventDefault(); actions.copy(); return }
        if (key === 'v') { event.preventDefault(); actions.paste(); return }
        if (key === 'd') { event.preventDefault(); actions.duplicate(); return }
        if (key === 'a') { event.preventDefault(); actions.selectAll(); return }
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        actions.remove()
        return
      }
      if (event.key === 'Escape') {
        actions.selectNone()
        return
      }

      // Arrow keys move the selection; with Shift in steps of 1 mm.
      const step = event.shiftKey ? 72 / 25.4 : 72 / 25.4 / 4
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      const delta = deltas[event.key]
      if (delta) {
        event.preventDefault()
        actions.nudge(delta[0], delta[1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveOrAsk, detail, session.history, actions])

  const menus: Menu[] = [
    {
      label: t('menu.file'),
      items: [
        { kind: 'action', label: t('menu.file.new'), shortcut: 'Ctrl+N', onSelect: () => setDialog('new') },
        { kind: 'action', label: t('menu.file.open'), shortcut: 'Ctrl+O', onSelect: () => setDialog('open') },
        { kind: 'separator' },
        {
          kind: 'action',
          label: t('menu.file.rename'),
          disabled: !detail,
          onSelect: () => setEditingName(true),
        },
        { kind: 'action', label: t('menu.file.save'), shortcut: 'Ctrl+S', disabled: !detail, onSelect: saveOrAsk },
        {
          kind: 'action',
          label: t('menu.file.saveAs'),
          shortcut: 'Ctrl+Shift+S',
          disabled: !detail,
          onSelect: () => setDialog('save-as'),
        },
        {
          kind: 'action',
          label: t('menu.file.download'),
          disabled: !detail,
          onSelect: () => detail && window.open(api.downloadUrl(detail.id), '_blank'),
        },
        { kind: 'separator' },
        { kind: 'action', label: t('menu.file.print'), disabled: !detail, onSelect: () => setPage('print') },
        { kind: 'separator' },
        {
          kind: 'action',
          label: t('menu.file.close'),
          disabled: !detail,
          onSelect: () => {
            session.setDetail(null)
            setPage('welcome')
          },
        },
      ],
    },
    {
      label: t('menu.edit'),
      items: [
        { kind: 'action', label: t('menu.edit.undo'), shortcut: 'Ctrl+Z', disabled: !session.history.canUndo, onSelect: session.undo },
        { kind: 'action', label: t('menu.edit.redo'), shortcut: 'Ctrl+Shift+Z', disabled: !session.history.canRedo, onSelect: session.redo },
        { kind: 'separator' },
        { kind: 'action', label: t('menu.edit.cut'), shortcut: 'Ctrl+X', disabled: !actions.hasSelection, onSelect: actions.cut },
        { kind: 'action', label: t('menu.edit.copy'), shortcut: 'Ctrl+C', disabled: !actions.hasSelection, onSelect: actions.copy },
        { kind: 'action', label: t('menu.edit.paste'), shortcut: 'Ctrl+V', disabled: !actions.hasClipboard, onSelect: actions.paste },
        { kind: 'action', label: t('menu.edit.delete'), shortcut: 'Delete', disabled: !actions.hasSelection, onSelect: actions.remove },
        { kind: 'action', label: t('menu.edit.duplicate'), shortcut: 'Ctrl+D', disabled: !actions.hasSelection, onSelect: actions.duplicate },
        { kind: 'separator' },
        { kind: 'action', label: t('menu.edit.selectAll'), shortcut: 'Ctrl+A', disabled: !detail, onSelect: actions.selectAll },
        { kind: 'action', label: t('menu.edit.selectNone'), disabled: !detail, onSelect: actions.selectNone },
        { kind: 'separator' },
        { kind: 'action', label: t('menu.edit.files'), onSelect: () => setPage('files') },
        { kind: 'action', label: t('menu.edit.fonts'), onSelect: () => setDialog('fonts') },
        { kind: 'separator' },
        { kind: 'action', label: t('menu.edit.preferences'), onSelect: () => setDialog('preferences') },
      ],
    },
    {
      label: t('menu.view'),
      items: [
        { kind: 'action', label: t('menu.view.grid'), checked: session.showGrid, onSelect: () => session.setShowGrid(!session.showGrid) },
        { kind: 'action', label: t('menu.view.markup'), checked: session.showMarkup, onSelect: () => session.setShowMarkup(!session.showMarkup) },
        { kind: 'separator' },
        { kind: 'action', label: t('menu.view.zoomIn'), onSelect: () => session.setZoom(Math.min(12, session.zoom * 1.25)) },
        { kind: 'action', label: t('menu.view.zoomOut'), onSelect: () => session.setZoom(Math.max(0.25, session.zoom / 1.25)) },
        { kind: 'action', label: t('menu.view.actualSize'), onSelect: () => session.setZoom(1) },
        { kind: 'separator' },
        { kind: 'action', label: t('menu.view.openOnPhone'), onSelect: () => setDialog('open-on-phone') },
      ],
    },
    {
      label: t('menu.objects'),
      items: [
        ...CREATE_TOOLS.map((tool) => ({
          kind: 'action' as const,
          label: t('menu.objects.create', { object: t(`object.${tool.type}`) }),
          disabled: !detail,
          onSelect: () => addObject(session, tool.type),
        })),
        { kind: 'separator' },
        { kind: 'action', label: t('menu.objects.raise'), disabled: !actions.hasSelection, onSelect: actions.raise },
        { kind: 'action', label: t('menu.objects.lower'), disabled: !actions.hasSelection, onSelect: actions.lower },
        { kind: 'separator' },
        { kind: 'action', label: t('menu.objects.rotateLeft'), disabled: !actions.hasSelection, onSelect: () => actions.rotate(-90) },
        { kind: 'action', label: t('menu.objects.rotateRight'), disabled: !actions.hasSelection, onSelect: () => actions.rotate(90) },
        { kind: 'action', label: t('menu.objects.flipHorizontal'), disabled: !actions.hasSelection, onSelect: () => actions.flip('horizontal') },
        { kind: 'action', label: t('menu.objects.flipVertical'), disabled: !actions.hasSelection, onSelect: () => actions.flip('vertical') },
        { kind: 'separator' },
        { kind: 'action', label: t('menu.objects.alignLeft'), disabled: session.selection.length < 2, onSelect: () => actions.align('left') },
        { kind: 'action', label: t('menu.objects.alignHCenter'), disabled: session.selection.length < 2, onSelect: () => actions.align('hcenter') },
        { kind: 'action', label: t('menu.objects.alignRight'), disabled: session.selection.length < 2, onSelect: () => actions.align('right') },
        { kind: 'action', label: t('menu.objects.alignTop'), disabled: session.selection.length < 2, onSelect: () => actions.align('top') },
        { kind: 'action', label: t('menu.objects.alignVCenter'), disabled: session.selection.length < 2, onSelect: () => actions.align('vcenter') },
        { kind: 'action', label: t('menu.objects.alignBottom'), disabled: session.selection.length < 2, onSelect: () => actions.align('bottom') },
        { kind: 'separator' },
        { kind: 'action', label: t('menu.objects.centerHorizontally'), disabled: !actions.hasSelection, onSelect: () => actions.centerOnLabel('horizontal') },
        { kind: 'action', label: t('menu.objects.centerVertically'), disabled: !actions.hasSelection, onSelect: () => actions.centerOnLabel('vertical') },
        { kind: 'action', label: t('menu.objects.center'), disabled: !actions.hasSelection, onSelect: () => actions.centerOnLabel('both') },
      ],
    },
    {
      label: t('menu.help'),
      items: [
        {
          kind: 'action',
          label: t('menu.help.about'),
          onSelect: () =>
            void dialogs.alert({
              title: t('about.title'),
              message: (
                <>
                  {t('about.text')}
                  {health ? (
                    <>
                      <br />
                      <br />
                      {t('about.version', {
                        version: health.version,
                        templates: health.templates,
                        fonts: health.fonts,
                      })}
                      <br />
                      {t('about.upstream', {
                        commit: health.upstream_commit?.slice(0, 7) ?? t('common.unknown'),
                      })}
                    </>
                  ) : null}
                  <br />
                  <br />
                  <small>{t('about.icons')}</small>
                </>
              ),
            }),
        },
      ],
    },
  ]

  return (
    <div className="mainwindow">
      <MenuBar menus={menus} />

      <div className="toolbar quick-toolbar">
        <button type="button" className="tool" title={t('toolbar.new')} onClick={() => setDialog('new')}>
          <Icon name="glabels-file-new" size={16} />
        </button>
        <button type="button" className="tool" title={t('toolbar.open')} onClick={() => setDialog('open')}>
          <Icon name="folder" size={16} theme="glabels-web" />
        </button>
        <button type="button" className="tool" title={t('toolbar.save')} disabled={!detail} onClick={saveOrAsk}>
          <Icon name="glabels-file-save" size={16} />
        </button>
        <span className="toolbar-separator" />
        {detail ? (
          <ProjectTitle
            name={detail.name}
            editing={editingName}
            onEditingChange={setEditingName}
            onRename={session.rename}
          />
        ) : (
          <span className="window-title">{t('app.name')}</span>
        )}
        {session.savedFlash ? (
          <span className="saved-flash">
            {t(session.savedFlash.key, session.savedFlash.vars)}
          </span>
        ) : null}
        <span className="spacer" />
        <button
          type="button"
          className="tool text-tool"
          title={t('toolbar.openOnPhoneHint')}
          onClick={() => setDialog('open-on-phone')}
        >
          <Icon name="glabels-phone" size={16} theme="glabels-web" />
          <span>{t('toolbar.openOnPhone')}</span>
        </button>
      </div>

      <div className="mainwindow-body">
        <nav className="contents" aria-label="Pagina's">
          {PAGES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={page === item.id ? 'contents-button active' : 'contents-button'}
              disabled={item.id !== 'welcome' && item.id !== 'files' && !detail}
              onClick={() => setPage(item.id)}
            >
              <Icon name={item.icon} size={48} context={item.context} theme={item.theme} />
              <span>{t(item.label)}</span>
            </button>
          ))}
        </nav>

        <div className="pages">
          {session.error ? <p className="page-error">{session.error}</p> : null}
          {detail?.file_state === 'conflict' ? (
            <div className="page-error file-conflict">
              <span>{t('file.conflict', { path: detail.file_path ?? '' })}</span>
              <button type="button" onClick={() => void resolveFile('app')}>
                {t('file.keepApp')}
              </button>
              <button type="button" onClick={() => void resolveFile('file')}>
                {t('file.keepFile')}
              </button>
            </div>
          ) : null}
          {page === 'welcome' ? (
            <WelcomePage onNew={() => setDialog('new')} onBrowse={() => setDialog('open')} onOpen={openDocument} />
          ) : null}
          {page === 'editor' && detail ? <EditorPage session={session} actions={actions} fontFamilies={fontFamilies.map((item) => item.family)} /> : null}
          {page === 'properties' && detail ? (
            <PropertiesPage session={session} template={template} onChangeProduct={() => setDialog('change-product')} />
          ) : null}
          {page === 'merge' && detail ? <MergePage session={session} /> : null}
          {page === 'variables' && detail ? <VariablesPage session={session} /> : null}
          {page === 'print' && detail ? <PrintPage session={session} template={template} /> : null}
          {page === 'files' ? (
            <FilesPage
              session={session}
              filesDir={health?.files_dir ?? null}
              onOpenDocument={openDocument}
              onFontsChanged={() => void refreshFonts()}
            />
          ) : null}
        </div>
      </div>

      <footer className="statusbar">
        <span>{session.busy ? t('common.busy') : t(session.status.key, session.status.vars)}</span>
        {detail && session.dirty ? <span className="saving-hint">{t('status.saving')}</span> : null}
        <span className="spacer" />
        {detail ? (
          <>
            <span>
              {detail.template_brand} {detail.template_part}
            </span>
            <span>
              {formatLength(labelSize(detail).w, session.unit)} ×{' '}
              {formatLength(labelSize(detail).h, session.unit)} {t(`unit.${session.unit}`)}
            </span>
            <span title={t('status.fileHint')}>
              {detail.file_path ?? <em>{t('status.notInFolder')}</em>}
            </span>
            <span>{t('status.revision', { number: detail.revision })}</span>
            <span>{Math.round(session.zoom * 100)}%</span>
          </>
        ) : null}
      </footer>

      {dialog === 'new' ? (
        <SelectProductDialog
          title={t('dialog.newProject')}
          unit={session.unit}
          onCancel={() => setDialog('none')}
          onChoose={(chosen) => {
            setDialog('none')
            void createDocument(chosen)
          }}
        />
      ) : null}

      {dialog === 'change-product' ? (
        <SelectProductDialog
          title={t('dialog.changeProduct')}
          unit={session.unit}
          onCancel={() => setDialog('none')}
          onChoose={() => {
            setDialog('none')
            session.setStatus('status.changeProduct')
          }}
        />
      ) : null}

      {dialog === 'fonts' ? (
        <FontsDialog
          families={fontFamilies}
          onRefresh={refreshFonts}
          onOpenFolder={() => {
            setDialog('none')
            setPage('files')
          }}
          onClose={() => setDialog('none')}
        />
      ) : null}

      {dialog === 'preferences' ? (
        <PreferencesDialog
          locale={preferences.locale}
          unit={preferences.unit}
          onClose={() => setDialog('none')}
          onSaved={(values) => {
            onPreferencesChange(values)
            session.setStatus('status.preferencesSaved')
            setDialog('none')
          }}
        />
      ) : null}

      {dialog === 'open' ? (
        <FileDialog
          title={t('dialog.openProject')}
          mode="open"
          accept={['document']}
          showProjects
          onCancel={() => setDialog('none')}
          onChoose={async (result) => {
            if (result.kind === 'project') await openDocument(result.id)
            else if (result.kind === 'file') await openFromFolder(result.path)
          }}
        />
      ) : null}

      {dialog === 'open-on-phone' ? (
        <OpenOnPhoneDialog
          docId={detail?.id ?? null}
          publicUrl={health?.public_url}
          onClose={() => setDialog('none')}
        />
      ) : null}

      {dialog === 'save-as' && detail ? (
        <FileDialog
          title={t('dialog.saveAs')}
          mode="save"
          accept={['document']}
          initialPath={detail.file_path?.includes('/') ? detail.file_path.slice(0, detail.file_path.lastIndexOf('/')) : ''}
          defaultName={`${detail.name}.glabels`}
          onCancel={() => setDialog('none')}
          onChoose={async (result) => {
            if (result.kind === 'save') await saveAs(result.path, result.name)
          }}
        />
      ) : null}


    </div>
  )
}
