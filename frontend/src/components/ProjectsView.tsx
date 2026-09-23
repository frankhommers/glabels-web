/** The "Projects" place in the file browser.
 *
 *  Projects live in the app; once a project has been given a name, it is
 *  also a .glabels file in the shared folder. All of them are listed here —
 *  including projects that have no file yet.
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { DocumentInfo } from '../api/types'
import { formatMoment } from '../app/locale'
import { useT } from '../i18n'
import { useDialogs } from '../ui/dialogs'
import { Icon } from '../ui/Icon'
import type { FileKind } from '../api/files'
import { PlacesNav } from './FileBrowser'

export function ProjectsView({
  selected,
  onSelect,
  onOpen,
  onLeave,
  accept,
  manage = false,
  onRenamed,
  onDeleted,
}: {
  selected: string | null
  onSelect: (id: string | null) => void
  onOpen: (id: string) => void
  /** Go to one of the other places; gets its folder. */
  onLeave: (path: string) => void
  /** The file kinds the surrounding browser shows, so the places match. */
  accept?: FileKind[]
  /** Show buttons for renaming and deleting. */
  manage?: boolean
  onRenamed?: (info: DocumentInfo) => void
  onDeleted?: (id: string) => void
}) {
  const t = useT()
  const dialogs = useDialogs()
  const [projects, setProjects] = useState<DocumentInfo[]>([])
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setProjects(await api.listDocuments())
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const chosen = projects.find((project) => project.id === selected) ?? null

  const rename = async () => {
    if (!chosen) return
    const name = await dialogs.prompt({
      title: t('projects.rename'),
      label: t('projects.newName'),
      value: chosen.name,
      confirmLabel: t('projects.renameButton'),
    })
    if (!name?.trim() || name.trim() === chosen.name) return
    setProblem(null)
    try {
      const info = await api.renameDocument(chosen.id, name.trim())
      onRenamed?.(info)
      await load()
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    }
  }

  const remove = async () => {
    if (!chosen) return
    const confirmed = await dialogs.confirm({
      title: t('projects.deleteTitle'),
      message: chosen.file_path
        ? t('projects.deleteWithFile', { name: chosen.name, path: chosen.file_path })
        : t('projects.deleteQuestion', { name: chosen.name }),
      confirmLabel: t('common.delete'),
      destructive: true,
    })
    if (!confirmed) return
    setProblem(null)
    try {
      await api.deleteDocument(chosen.id)
      onDeleted?.(chosen.id)
      onSelect(null)
      await load()
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    }
  }

  return (
    <div className="file-browser">
      <PlacesNav
        accept={accept}
        activePath={null}
        projectsActive
        onProjects={() => undefined}
        onPlace={onLeave}
      />

      <div className="file-main">
        {manage ? (
          <div className="toolbar file-toolbar">
            <button type="button" disabled={!chosen} onClick={() => chosen && onOpen(chosen.id)}>
              {t('common.open')}
            </button>
            <button type="button" disabled={!chosen} onClick={() => void rename()}>
              {t('projects.rename')}
            </button>
            <button type="button" disabled={!chosen} onClick={() => void remove()}>
              {t('common.delete')}
            </button>
          </div>
        ) : null}

        <table className="project-table file-table">
          <thead>
            <tr>
              <th>{t('fileBrowser.name')}</th>
              <th>{t('projects.file')}</th>
              <th>{t('fileBrowser.product')}</th>
              <th>{t('fileBrowser.modified')}</th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 ? (
              <tr>
                <td colSpan={4} className="placeholder">
                  {t('fileBrowser.noProjects')}
                </td>
              </tr>
            ) : (
              projects.map((project) => (
                <tr
                  key={project.id}
                  className={selected === project.id ? 'selected' : undefined}
                  onClick={() => onSelect(project.id)}
                  onDoubleClick={() => onOpen(project.id)}
                >
                  <td className="file-name">
                    <Icon name="glabels-file-new" size={16} />
                    {project.name}
                  </td>
                  <td>{project.file_path ?? <em className="muted">{t('projects.noFile')}</em>}</td>
                  <td>
                    {project.template_brand} {project.template_part}
                  </td>
                  <td>{formatMoment(project.updated_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {problem ? <p className="inline-warning">{problem}</p> : null}
      </div>
    </div>
  )
}
