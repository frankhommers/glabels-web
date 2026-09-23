/** The "Files" page: the shared folder, mounted as a volume.
 *
 *  It holds merge sources, .glabels files and fonts (subfolder `fonts`).
 *  Files can also be put on the volume directly; this page shows the same
 *  content.
 */

import { useRef, useState } from 'react'
import { api } from '../api/client'
import type { FileEntry } from '../api/files'
import { FileBrowser } from '../components/FileBrowser'
import type { Session } from '../app/session'
import { ProjectsView } from '../components/ProjectsView'

export function FilesPage({
  session,
  filesDir,
  onOpenDocument,
  onFontsChanged,
}: {
  session: Session
  filesDir: string | null
  onOpenDocument: (id: string) => void | Promise<void>
  onFontsChanged: () => void
}) {
  const t = session.t
  const [selected, setSelected] = useState<string | null>(null)
  const [entry, setEntry] = useState<FileEntry | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [inProjects, setInProjects] = useState(false)
  // Where the browser opens again after a visit to Projects.
  const [startPath, setStartPath] = useState('')
  const lastPath = useRef('')
  const [project, setProject] = useState<string | null>(null)

  const openDocument = async (path: string) => {
    setProblem(null)
    try {
      const created = await api.importFromFile(path)
      await onOpenDocument(created.id)
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    }
  }

  return (
    <div className="files-page">
      <div className="files-intro">
        <p className="muted">
          {t('files.intro', { folder: filesDir ? ` — ${filesDir}` : '' })}
        </p>
        {entry?.kind === 'document' ? (
          <button type="button" className="default" onClick={() => void openDocument(entry.path)}>
            {t('files.openAsProject')}
          </button>
        ) : null}
      </div>

      {problem ? <p className="inline-warning">{problem}</p> : null}

      {inProjects ? (
        <ProjectsView
          manage
          selected={project}
          onSelect={setProject}
          onOpen={(id) => void onOpenDocument(id)}
          onLeave={(path) => {
            setStartPath(path)
            setInProjects(false)
          }}
          onRenamed={(info) => {
            // The open project has a new name; the toolbar must follow.
            const current = session.detail
            if (current?.id === info.id) {
              session.setDetail({ ...current, name: info.name, file_path: info.file_path })
            }
            session.setStatus('status.renamed', { name: info.name })
          }}
          onDeleted={(id) => {
            if (session.detail?.id === id) session.setDetail(null)
          }}
        />
      ) : (
        <FileBrowser
          initialPath={startPath}
          onNavigate={(path) => {
            lastPath.current = path
          }}
          selected={selected}
          onSelect={(path, item) => {
            setSelected(path)
            setEntry(item)
          }}
          onActivate={(item) => {
            if (item.kind === 'document') void openDocument(item.path)
          }}
          onChanged={() => {
            onFontsChanged()
            session.setStatus('status.folderUpdated')
          }}
          onProjects={() => {
            setStartPath(lastPath.current)
            setInProjects(true)
            setProject(null)
          }}
        />
      )}
    </div>
  )
}
