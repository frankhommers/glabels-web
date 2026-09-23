import type { Session } from '../app/session'

export function VariablesPage({ session }: { session: Session }) {
  const t = session.t
  const detail = session.detail
  if (!detail) return null

  return (
    <div className="page-form">
      <fieldset>
        <legend>{t('variables.title')}</legend>
        {detail.variables.length === 0 ? (
          <p className="placeholder">{t('variables.none')}</p>
        ) : (
          <table className="project-table">
            <thead>
              <tr>
                <th>{t('variables.name')}</th>
                <th>{t('variables.type')}</th>
                <th>{t('variables.value')}</th>
                <th>{t('variables.increment')}</th>
                <th>{t('variables.step')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.variables.map((variable) => (
                <tr key={variable.name}>
                  <td>{variable.name}</td>
                  <td>{variable.type}</td>
                  <td>{variable.value}</td>
                  <td>{variable.increment}</td>
                  <td>{variable.step_size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="inline-notice">
{t('variables.hint')}
        </p>
      </fieldset>
    </div>
  )
}
