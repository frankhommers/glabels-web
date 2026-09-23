/** Browsing the shared folder: places, path, actions and content.
 *
 *  Shown both as a page of its own and inside the file dialog, so both do
 *  exactly the same and look the same.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { files, formatBytes, type DirectoryListing, type FileEntry, type FileKind } from '../api/files'
import { formatMoment } from '../app/locale'
import { useDialogs } from '../ui/dialogs'
import { useT, type MessageKey } from '../i18n'
import { Icon } from '../ui/Icon'

type IconSpec = { name: string; theme?: 'glabels-flat' | 'glabels-web' }

const UNKNOWN: IconSpec = { name: 'glabels-file-new' }

// Everything at 16 px, the size these icons were drawn for.
const KIND_ICON: Record<string, IconSpec> = {
  folder: { name: 'folder', theme: 'glabels-web' },
  document: { name: 'glabels-file-new' },
  data: { name: 'glabels-data', theme: 'glabels-web' },
  font: { name: 'glabels-text' },
  definition: { name: 'glabels-template', theme: 'glabels-web' },
  other: UNKNOWN,
}

/** A kind this version does not know yet must not crash the list. */
function kindIcon(kind: string): IconSpec {
  return KIND_ICON[kind] ?? UNKNOWN
}

const KNOWN_KINDS = ['folder', 'document', 'data', 'font', 'definition'] as const

function kindLabelKey(kind: string): MessageKey {
  const known = KNOWN_KINDS.find((candidate) => candidate === kind)
  return known ? `fileBrowser.kind.${known}` : 'fileBrowser.kind.other'
}

type Place = {
  id: string
  label: MessageKey
  icon: string
  theme?: 'glabels-flat' | 'glabels-web'
  path: string
  kind?: FileKind
}

const ALL_PLACES: Place[] = [
  { id: 'shared', label: 'fileBrowser.sharedFolder', icon: 'folder', theme: 'glabels-web', path: '' },
  {
    id: 'templates',
    label: 'fileBrowser.productDefinitions',
    icon: 'glabels-template',
    theme: 'glabels-web',
    path: 'templates',
    kind: 'definition',
  },
  { id: 'fonts', label: 'fileBrowser.fonts', icon: 'glabels-text', path: 'fonts', kind: 'font' },
]

/** Show only the places that belong to the requested file kind. */
function placesFor(accept?: FileKind[]): Place[] {
  if (!accept) return ALL_PLACES
  return ALL_PLACES.filter((place) => !place.kind || accept.includes(place.kind))
}

/** The places bar, shared by the file browser and the Projects view, so
 *  both always list the same places. */
export function PlacesNav({
  accept,
  activePath,
  projectsActive = false,
  onProjects,
  onPlace,
}: {
  accept?: FileKind[]
  /** The folder that is open, or `null` when none of the places is. */
  activePath: string | null
  projectsActive?: boolean
  /** Shows the Projects place when given. */
  onProjects?: () => void
  onPlace: (path: string) => void
}) {
  const t = useT()
  return (
    <nav className="places" aria-label={t('fileBrowser.places')}>
      {onProjects ? (
        <button
          type="button"
          className={projectsActive ? 'place active' : 'place'}
          onClick={onProjects}
        >
          <Icon name="glabels-file-recent" size={16} />
          <span>{t('fileBrowser.projects')}</span>
        </button>
      ) : null}
      {placesFor(accept).map((item) => (
        <button
          key={item.id}
          type="button"
          className={!projectsActive && activePath === item.path ? 'place active' : 'place'}
          onClick={() => onPlace(item.path)}
        >
          <Icon name={item.icon} size={16} theme={item.theme} />
          <span>{t(item.label)}</span>
        </button>
      ))}
    </nav>
  )
}

export type FileBrowserProps = {
  initialPath?: string
  accept?: FileKind[]
  selected: string | null
  onSelect: (path: string | null, entry: FileEntry | null) => void
  onActivate?: (entry: FileEntry) => void
  onChanged?: () => void
  /** Shows the Projects place; called when it is clicked. */
  onProjects?: () => void
  /** Called with the folder that is open after every navigation. */
  onNavigate?: (path: string) => void
}

export function FileBrowser({
  initialPath = '',
  accept,
  selected,
  onSelect,
  onActivate,
  onChanged,
  onProjects,
  onNavigate,
}: FileBrowserProps) {
  const t = useT()
  const dialogs = useDialogs()
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const uploadInput = useRef<HTMLInputElement | null>(null)
  const path = listing?.path ?? initialPath

  // Through a ref, so a new callback from the parent does not reload the list.
  const navigated = useRef(onNavigate)
  useEffect(() => {
    navigated.current = onNavigate
  }, [onNavigate])

  const load = useCallback(
    async (target: string) => {
      setBusy(true)
      setProblem(null)
      try {
        const result = await files.list(target)
        setListing(result)
        onSelect(null, null)
        navigated.current?.(result.path)
      } catch (error) {
        setProblem(String(error instanceof Error ? error.message : error))
      } finally {
        setBusy(false)
      }
    },
    [onSelect],
  )

  useEffect(() => {
    void load(initialPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath])

  // If the caller asks for a certain kind of file, we hide the rest.
  // Otherwise fonts suddenly show up in "Open project".
  const visible = (entry: FileEntry) => entry.is_dir || !accept || accept.includes(entry.kind)
  const entries = (listing?.entries ?? []).filter(visible)
  const selectedEntry = entries.find((entry) => entry.path === selected) ?? null

  const activate = async (entry: FileEntry) => {
    if (entry.is_dir) {
      await load(entry.path)
      return
    }
    onActivate?.(entry)
  }

  const upload = async (list: FileList | File[]) => {
    setBusy(true)
    setProblem(null)
    try {
      for (const file of Array.from(list)) await files.upload(path, file)
      await load(path)
      onChanged?.()
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  // Drag and drop from the desktop: files dropped on the list go into the
  // folder that is open. Enter and leave fire for every child element, so a
  // counter tells when the pointer really leaves the area.
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const carriesFiles = (event: React.DragEvent) => event.dataTransfer.types.includes('Files')

  const onDragEnter = (event: React.DragEvent) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  const onDragOver = (event: React.DragEvent) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = listing?.available ? 'copy' : 'none'
  }

  const onDragLeave = (event: React.DragEvent) => {
    if (!carriesFiles(event)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const onDrop = (event: React.DragEvent) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (!listing?.available) return

    // A dropped folder shows up as a file without content; uploading it
    // would fail halfway. Take only real files and say what was skipped.
    const dropped: File[] = []
    let folders = 0
    for (const item of Array.from(event.dataTransfer.items)) {
      if (item.kind !== 'file') continue
      if (item.webkitGetAsEntry?.()?.isDirectory) {
        folders += 1
        continue
      }
      const file = item.getAsFile()
      if (file) dropped.push(file)
    }
    if (dropped.length > 0) void upload(dropped)
    if (folders > 0) setProblem(t('fileBrowser.dropFolders', { count: folders }))
  }

  // A file dropped next to the list must not make the browser open it and
  // leave the application.
  useEffect(() => {
    const guard = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    window.addEventListener('dragover', guard)
    window.addEventListener('drop', guard)
    return () => {
      window.removeEventListener('dragover', guard)
      window.removeEventListener('drop', guard)
    }
  }, [])

  const makeDirectory = async () => {
    const folder = await dialogs.prompt({
      title: t('fileBrowser.newFolder'),
      label: t('fileBrowser.newFolderName'),
      placeholder: t('fileBrowser.newFolderPlaceholder'),
      confirmLabel: t('fileBrowser.create'),
    })
    if (!folder) return
    try {
      await files.makeDirectory(path, folder)
      await load(path)
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    }
  }

  const remove = async () => {
    if (!selectedEntry) return
    const confirmed = await dialogs.confirm({
      title: t(selectedEntry.is_dir ? 'fileBrowser.deleteFolder' : 'fileBrowser.deleteFile'),
      message: t('fileBrowser.deleteQuestion', { name: selectedEntry.name }),
      confirmLabel: t('common.delete'),
      destructive: true,
    })
    if (!confirmed) return
    try {
      await files.remove(selectedEntry.path)
      await load(path)
      onChanged?.()
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    }
  }

  const crumbs = path ? path.split('/') : []

  return (
    <div className="file-browser">
      <PlacesNav
        accept={accept}
        activePath={path}
        onProjects={onProjects}
        onPlace={(target) => void load(target)}
      />

      <div
        className="file-main"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >

        <div className="path-bar">
          <button
            type="button"
            className="tool"
            title={t('fileBrowser.parent')}
            disabled={!listing?.parent && listing?.parent !== ''}
            onClick={() => void load(listing?.parent ?? '')}
          >
            ↑
          </button>
          <button type="button" className="crumb" onClick={() => void load('')}>
            {t('fileBrowser.sharedFolder')}
          </button>
          {crumbs.map((crumb, index) => (
            <span key={crumb + index}>
              <span className="crumb-sep">/</span>
              <button
                type="button"
                className="crumb"
                onClick={() => void load(crumbs.slice(0, index + 1).join('/'))}
              >
                {crumb}
              </button>
            </span>
          ))}
          <span className="spacer" />
          <button type="button" className="tool" title={t('fileBrowser.refresh')} onClick={() => void load(path)}>
            ⟳
          </button>
        </div>

        <div className="toolbar file-toolbar">
          <button type="button" disabled={busy} onClick={() => uploadInput.current?.click()}>
            {t('fileBrowser.upload')}
          </button>
          <input
            ref={uploadInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files?.length) void upload(event.target.files)
              event.target.value = ''
            }}
          />
          <button type="button" disabled={busy} onClick={() => void makeDirectory()}>
            {t('fileBrowser.newFolder')}
          </button>
          <button type="button" disabled={!selectedEntry} onClick={() => void remove()}>
            {t('common.delete')}
          </button>
          {selectedEntry && !selectedEntry.is_dir ? (
            <a className="button" href={files.downloadUrl(selectedEntry.path)} download>
              {t('common.download')}
            </a>
          ) : (
            <button type="button" disabled>
              {t('common.download')}
            </button>
          )}
        </div>

        {listing && !listing.available ? (
          <p className="inline-warning">
            {t('fileBrowser.unavailable')}
          </p>
        ) : null}

        <div className="file-list">
          {dragging ? (
            <div className="drop-overlay" aria-hidden>
              <Icon name="folder" size={32} theme="glabels-web" />
              <span>
                {listing?.available
                  ? t('fileBrowser.dropHere', { folder: path || t('fileBrowser.sharedFolder') })
                  : t('fileBrowser.unavailable')}
              </span>
            </div>
          ) : null}
          <table className="project-table file-table">
            <thead>
              <tr>
                <th>{t('fileBrowser.name')}</th>
                <th>{t('fileBrowser.kind')}</th>
                <th>{t('fileBrowser.size')}</th>
                <th>{t('fileBrowser.modified')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="placeholder">
                    {t(
                      listing && listing.entries.length > 0 ? 'fileBrowser.noneOfThisKind' : 'fileBrowser.empty',
                    )}
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr
                    key={entry.path}
                    className={selected === entry.path ? 'selected' : undefined}
                    onClick={() => onSelect(entry.path, entry)}
                    onDoubleClick={() => void activate(entry)}
                  >
                    <td className="file-name">
                      <Icon name={kindIcon(entry.kind).name} size={16} theme={kindIcon(entry.kind).theme} />
                      {entry.name}
                    </td>
                    <td>{t(kindLabelKey(entry.kind))}</td>
                    <td>{entry.is_dir ? '' : formatBytes(entry.size_bytes)}</td>
                    <td>{formatMoment(entry.modified_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {problem ? <p className="inline-warning">{problem}</p> : null}
      </div>
    </div>
  )
}
