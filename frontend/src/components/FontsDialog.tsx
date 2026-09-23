/** Font management: the list the renderer knows, plus own uploads. */

import { useRef, useState } from 'react'
import type { FontFamily } from '../app/fonts'
import { deleteFont, uploadFont } from '../app/fonts'
import { useDialogs } from '../ui/dialogs'
import { useT } from '../i18n'

function formatSize(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} kB`
}

export function FontsDialog({
  families,
  onRefresh,
  onOpenFolder,
  onClose,
}: {
  families: FontFamily[]
  onRefresh: () => Promise<void>
  onOpenFolder: () => void
  onClose: () => void
}) {
  const t = useT()
  const dialogs = useDialogs()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const handleUpload = async (files: FileList) => {
    setBusy(true)
    setProblem(null)
    try {
      for (const file of Array.from(files)) {
        await uploadFont(file)
      }
      await onRefresh()
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal aria-label={t('fonts.title')}>
      <div className="modal">
        <div className="modal-title">{t('fonts.title')}</div>
        <div className="modal-body">
          <p className="muted">{t('fonts.intro')}</p>

          <table className="project-table">
            <thead>
              <tr>
                <th>{t('fonts.family')}</th>
                <th>{t('fonts.styles')}</th>
                <th>{t('fonts.source')}</th>
                <th>{t('fonts.size')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {families.map((family) => (
                <tr key={family.family}>
                  <td style={{ fontFamily: `"${family.family}"` }}>{family.family}</td>
                  <td>{family.faces.map((face) => face.subfamily).join(', ')}</td>
                  <td>{t(family.source === 'uploaded' ? 'fonts.added' : 'fonts.builtin')}</td>
                  <td>{formatSize(family.faces.reduce((total, face) => total + face.size_bytes, 0))}</td>
                  <td>
                    {family.source === 'uploaded' ? (
                      <button
                        type="button"
                        className="linklike"
                        disabled={busy}
                        onClick={async () => {
                          const confirmed = await dialogs.confirm({
                            title: t('fonts.deleteTitle'),
                            message: (
                              <>
                                <strong>{family.family}</strong>
                                <br />
                                {t('fonts.deleteQuestion')}
                              </>
                            ),
                            confirmLabel: t('common.delete'),
                            destructive: true,
                          })
                          if (!confirmed) return
                          setBusy(true)
                          try {
                            for (const face of family.faces) await deleteFont(face.id)
                            await onRefresh()
                          } catch (error) {
                            setProblem(String(error))
                          } finally {
                            setBusy(false)
                          }
                        }}
                      >
                        {t('common.delete')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {problem ? <p className="inline-warning">{problem}</p> : null}
        </div>
        <div className="modal-buttons">
          <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
            {t('fonts.add')}
          </button>
          <button type="button" onClick={onOpenFolder}>
            {t('fonts.openFolder')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".ttf,.otf,.ttc,font/ttf,font/otf"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files?.length) void handleUpload(event.target.files)
              event.target.value = ''
            }}
          />
          <span className="spacer" />
          <button type="button" className="default" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
