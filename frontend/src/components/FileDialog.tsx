/** File dialog: the same browser as the Files page, in a window with
 *  OK/Cancel. Used for opening, saving and picking a merge source. */

import { useState } from 'react'
import type { FileKind } from '../api/files'
import { useT } from '../i18n'
import { FileBrowser } from './FileBrowser'
import { ProjectsView } from './ProjectsView'

export type FileDialogMode = 'open' | 'save' | 'select'

export type FileDialogResult =
  | { kind: 'project'; id: string }
  | { kind: 'file'; path: string }
  | { kind: 'save'; path: string; name: string }

export function FileDialog({
  title,
  mode,
  accept,
  initialPath = '',
  showProjects = false,
  defaultName = '',
  confirmLabel,
  onChoose,
  onCancel,
}: {
  title: string
  mode: FileDialogMode
  accept?: FileKind[]
  initialPath?: string
  showProjects?: boolean
  defaultName?: string
  confirmLabel?: string
  onChoose: (result: FileDialogResult) => void | Promise<void>
  onCancel: () => void
}) {
  const t = useT()
  const [inProjects, setInProjects] = useState(showProjects && mode === 'open')
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedKind, setSelectedKind] = useState<FileKind | null>(null)
  const [name, setName] = useState(defaultName)
  // The folder that is open in the browser; Save puts the file there.
  const [folder, setFolder] = useState(initialPath)
  // Where the browser opens again after a visit to Projects.
  const [startPath, setStartPath] = useState(initialPath)

  const confirm = async () => {
    if (inProjects) {
      if (selected) await onChoose({ kind: 'project', id: selected })
      return
    }
    if (mode === 'save') {
      if (name.trim()) await onChoose({ kind: 'save', path: folder, name: name.trim() })
      return
    }
    if (selected) await onChoose({ kind: 'file', path: selected })
  }

  const acceptable = !accept || selectedKind === null || accept.includes(selectedKind)
  const confirmDisabled = mode === 'save' ? !name.trim() : !selected || (!inProjects && !acceptable)

  return (
    <div className="modal-backdrop" role="dialog" aria-modal aria-label={title}>
      <div className="modal file-dialog">
        <div className="modal-title">{title}</div>

        <div className="modal-body file-body">
          {inProjects ? (
            <ProjectsView
              selected={selected}
              onSelect={setSelected}
              onOpen={(id) => void onChoose({ kind: 'project', id })}
              accept={accept}
              onLeave={(path) => {
                setStartPath(path)
                setInProjects(false)
                setSelected(null)
              }}
            />
          ) : (
            <>
              <FileBrowser
                initialPath={startPath}
                onNavigate={setFolder}
                accept={accept}
                selected={selected}
                onSelect={(path, entry) => {
                  setSelected(path)
                  setSelectedKind(entry?.kind ?? null)
                }}
                onActivate={(entry) => {
                  setSelectedKind(entry.kind)
                  setSelected(entry.path)
                  setFolder(entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '')
                  if (mode === 'save') setName(entry.name)
                  else void onChoose({ kind: 'file', path: entry.path })
                }}
                onProjects={
                  showProjects
                    ? () => {
                        setStartPath(folder)
                        setInProjects(true)
                        setSelected(null)
                      }
                    : undefined
                }
              />
              {mode === 'save' ? (
                <div className="form-row file-name-row">
                  <label>{t('fileBrowser.fileName')}</label>
                  <input value={name} onChange={(event) => setName(event.target.value)} />
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="modal-buttons">
          <span className="spacer" />
          <button type="button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="default" disabled={confirmDisabled} onClick={() => void confirm()}>
            {confirmLabel ?? t(mode === 'save' ? 'common.save' : 'common.open')}
          </button>
        </div>
      </div>
    </div>
  )
}
