import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { preferences as preferencesApi } from '../api/preferences'
import type { DocumentDetail, DocumentObject, PrintSettings } from '../api/types'
import { labelSize, rotateFor, type Orientation } from '../editor/label'
import { useHistory } from '../editor/useHistory'
import type { UnitId } from '../editor/units'
import type { MessageKey, Translate, Vars } from '../i18n'
import { MIN_ZOOM } from '../editor/CanvasViewport'

/** A message in the status bar. We keep the key rather than the text, so
 *  the bar follows along when the language changes. */
export type Notice = { key: MessageKey; vars?: Vars }

export type PageId =
  | 'welcome'
  | 'editor'
  | 'properties'
  | 'merge'
  | 'variables'
  | 'print'
  | 'files'

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  sheets: null,
  copies: 1,
  first: 1,
  outlines: false,
  crop_marks: false,
  reverse: false,
  collate: false,
  group_per_page: false,
}

/** Zoom factor at which the label fills the canvas, with some room around it. */
export function fitZoom(widthPt: number, heightPt: number): number {
  const availableWidth = Math.max(240, window.innerWidth - 96 - 344 - 120)
  const availableHeight = Math.max(240, window.innerHeight - 190)
  if (widthPt <= 0 || heightPt <= 0) return 2
  const factor = Math.min(availableWidth / widthPt, availableHeight / heightPt)
  // A tiny label is not blown up all the way on opening; zooming in further
  // stays possible.
  return Math.max(MIN_ZOOM, Math.min(12, factor))
}

/** All state of the open project, like MainWindow keeps it in the desktop app. */
export function useSession(t: Translate) {
  const [detail, setDetail] = useState<DocumentDetail | null>(null)
  const [selection, setSelection] = useState<string[]>([])
  const [zoom, setZoom] = useState(2)
  const [unit, setUnitState] = useState<UnitId>('mm')
  const [showGrid, setShowGrid] = useState(true)
  const [showMarkup, setShowMarkup] = useState(true)
  const [snap, setSnap] = useState(true)
  const [dirty, setDirty] = useState(false)
  // Refs so the save loop never works on stale values.
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatusNotice] = useState<Notice>({ key: 'common.ready' })
  const setStatus = useCallback(
    (key: MessageKey, vars?: Vars) => setStatusNotice({ key, vars }),
    [],
  )
  // Brief confirmation after a manual save; disappears by itself.
  const [savedFlash, setSavedFlash] = useState<Notice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [printSettings, setPrintSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS)
  // Clipboard within this session; pasting objects from the system clipboard
  // needs an exchange format of its own and comes later.
  const [clipboard, setClipboard] = useState<DocumentObject[]>([])
  const history = useHistory<DocumentObject[]>([])

  const open = useCallback(
    async (id: string) => {
      setBusy(true)
      setError(null)
      try {
        const document = await api.getDocument(id)
        setDetail(document)
        const size = labelSize(document)
        setZoom(fitZoom(size.w, size.h))
        history.reset(document.content.objects)
        setSelection([])
        setDirty(false)
        dirtyRef.current = false
        setStatus('status.opened', { name: document.name })
        return document
      } catch (problem) {
        setError(String(problem))
        return null
      } finally {
        setBusy(false)
      }
    },
    [history],
  )

  /** Save the current content.
   *
   *  This also happens by itself: after a short pause while editing, and
   *  always before a preview or print. The user never has to think about
   *  revisions. That is why the selection and the undo history stay put here:
   *  saving must not interrupt the work.
   */
  const save = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!detail || savingRef.current) return
      if (!dirtyRef.current && options.silent) return

      savingRef.current = true
      if (!options.silent) setBusy(true)
      setError(null)
      const sent = history.present
      try {
        const saved = await api.saveDocument(detail.id, {
          rotate: detail.content.rotate,
          objects: sent,
        })
        setDetail(saved)

        // New objects get a lasting id from the server. We update it
        // everywhere — in the selection and in the history — so the next
        // save updates the same object instead of creating a new one.
        const renewed = new Map<string, string>()
        sent.forEach((object, index) => {
          const fresh = saved.content.objects[index]
          if (object.id && fresh?.id && object.id !== fresh.id) {
            renewed.set(object.id, fresh.id)
          }
        })
        if (renewed.size > 0) {
          const rename = (objects: DocumentObject[]) =>
            objects.map((object) =>
              object.id && renewed.has(object.id)
                ? { ...object, id: renewed.get(object.id) as string }
                : object,
            )
          history.remap(rename)
          setSelection((current) => current.map((id) => renewed.get(id) ?? id))
        }
        history.adopt(saved.content.objects)
        setDirty(false)
        if (options.silent) {
          setStatus('status.autosaved')
        } else {
          const notice: Notice = { key: 'status.saved', vars: { number: saved.revision } }
          setStatusNotice(notice)
          setSavedFlash(notice)
        }
        return saved
      } catch (problem) {
        setError(String(problem))
        return null
      } finally {
        savingRef.current = false
        if (!options.silent) setBusy(false)
      }
    },
    [detail, history, t],
  )

  /** Make sure what is on screen has been saved. */
  const flush = useCallback(async () => {
    if (!dirtyRef.current) return
    await save({ silent: true })
  }, [save])

  /** The unit is a preference of the installation, not of this tab. */
  const setUnit = useCallback((next: UnitId, persist = true) => {
    setUnitState(next)
    if (persist) void preferencesApi.write({ unit: next }).catch(() => undefined)
  }, [])

  const markDirty = useCallback(() => {
    setDirty(true)
    dirtyRef.current = true
  }, [])

  /** A name of its own for the project. That is not content, so no revision. */
  const rename = useCallback(
    async (name: string) => {
      if (!detail) return
      setError(null)
      try {
        const info = await api.renameDocument(detail.id, name)
        setDetail((current) =>
          current && current.id === info.id
            ? { ...current, name: info.name, file_path: info.file_path }
            : current,
        )
        setStatus('status.renamed', { name: info.name })
      } catch (problem) {
        setError(String(problem))
      }
    },
    [detail, setStatus],
  )

  /** Horizontal or vertical. Objects stay where they are, like upstream; the
   *  zoom adapts to the new size. */
  const setOrientation = useCallback(
    (orientation: Orientation) => {
      if (!detail) return
      const rotate = rotateFor(detail, orientation)
      if (rotate === detail.content.rotate) return
      const next = { ...detail, content: { ...detail.content, rotate } }
      setDetail(next)
      const size = labelSize(next)
      setZoom(fitZoom(size.w, size.h))
      markDirty()
    },
    [detail, markDirty],
  )

  const commit = useCallback(
    (next: DocumentObject[]) => {
      history.commit(next)
      markDirty()
    },
    [history, markDirty],
  )

  // Undo and redo change the document too, so they must be written as well.
  const undo = useCallback(() => {
    history.undo()
    markDirty()
  }, [history, markDirty])

  const redo = useCallback(() => {
    history.redo()
    markDirty()
  }, [history, markDirty])

  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  useEffect(() => {
    if (!savedFlash) return
    const timer = window.setTimeout(() => setSavedFlash(null), 2500)
    return () => window.clearTimeout(timer)
  }, [savedFlash])

  // Save automatically after a short pause in editing. A burst of small
  // changes (dragging, typing) thus becomes one save.
  useEffect(() => {
    if (!detail || !dirty) return
    const timer = window.setTimeout(() => void save({ silent: true }), 1200)
    return () => window.clearTimeout(timer)
  }, [detail, dirty, save])

  // No warning when closing the tab: that is a browser dialog we cannot
  // style, and with autosave at most a second of work is outstanding.

  return {
    t,
    detail,
    setDetail,
    setOrientation,
    rename,
    objects: history.present,
    history,
    commit,
    selection,
    setSelection,
    zoom,
    setZoom,
    unit,
    setUnit,
    showGrid,
    setShowGrid,
    showMarkup,
    setShowMarkup,
    snap,
    setSnap,
    dirty,
    busy,
    status,
    setStatus,
    error,
    setError,
    printSettings,
    setPrintSettings,
    clipboard,
    setClipboard,
    open,
    save,
    flush,
    savedFlash,
    undo,
    redo,
  }
}

export type Session = ReturnType<typeof useSession>
