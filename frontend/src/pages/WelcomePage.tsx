import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { DocumentInfo, Health } from '../api/types'
import { formatDate } from '../app/locale'
import { useT } from '../i18n'
import { Icon } from '../ui/Icon'

export function WelcomePage({
  onNew,
  onBrowse,
  onOpen,
}: {
  onNew: () => void
  onBrowse: () => void
  onOpen: (id: string) => void
}) {
  const t = useT()
  const [recent, setRecent] = useState<DocumentInfo[]>([])
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    api.listDocuments().then((items) => setRecent(items.slice(0, 8))).catch(() => setRecent([]))
    api.health().then(setHealth).catch(() => setHealth(null))
  }, [])

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-brand">
          <Icon name="glabels" size={48} context="apps" alt="gLabels" />
          <div>
            <h1>{t('app.name')}</h1>
            <p className="muted">{t('welcome.intro')}</p>
          </div>
        </div>

        <div className="welcome-actions">
          <button type="button" onClick={onNew}>
            <Icon name="glabels-file-new" size={32} />
            <strong>{t('welcome.new')}</strong>
            <span>{t('welcome.new.hint')}</span>
          </button>
          <button type="button" onClick={onBrowse}>
            <Icon name="folder" size={32} theme="glabels-web" />
            <strong>{t('welcome.browse')}</strong>
            <span>{t('welcome.browse.hint')}</span>
          </button>
        </div>

        <div className="welcome-recent">
          <h2>
            <Icon name="glabels-file-recent" size={16} /> {t('welcome.recent')}
          </h2>
          {recent.length === 0 ? (
            <p className="placeholder">{t('welcome.noProjects')}</p>
          ) : (
            <ul>
              {recent.map((document) => (
                <li key={document.id}>
                  <button type="button" className="linklike" onClick={() => onOpen(document.id)}>
                    {document.name}
                  </button>
                  <span className="muted">
                    {document.template_brand} {document.template_part} ·{' '}
                    {formatDate(document.updated_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {health ? (
          <p className="welcome-footer muted">
            {t('welcome.status', {
              templates: health.templates,
              renderer: t(
                health.renderer_available
                  ? 'welcome.renderer.available'
                  : 'welcome.renderer.unavailable',
              ),
              commit: health.upstream_commit?.slice(0, 7) ?? t('common.unknown'),
            })}
          </p>
        ) : null}
      </div>
    </div>
  )
}
