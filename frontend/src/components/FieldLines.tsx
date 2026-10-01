/** The ${fields} in a text object, and how each is filled in.
 *
 *  A field takes one line or several when rows of the label's list are
 *  entered (on a phone, or on the Merge page). Automatic follows the
 *  design: a text box with room for two lines or more gives several. A
 *  choice of one's own is kept in the label; gLabels on a desktop drops it
 *  when it saves, and then the field is automatic again.
 */

import { useEffect, useState } from 'react'
import { lists, type LabelList } from '../api/lists'
import { useT } from '../i18n'

const FIELD = /\$\{([^}:]+)/g

export function fieldsIn(text: string): string[] {
  return [...new Set([...text.matchAll(FIELD)].map((match) => match[1].trim()).filter(Boolean))]
}

export function FieldLines({ docId, text, revision }: { docId: string; text: string; revision: number }) {
  const t = useT()
  const [list, setList] = useState<LabelList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const fields = fieldsIn(text)

  useEffect(() => {
    lists
      .get(docId)
      .then(setList)
      .catch(() => setList(null))
  }, [docId, revision])

  if (fields.length === 0) return null

  return (
    <fieldset>
      <legend>{t('fieldLines.title')}</legend>
      <p className="muted">{t('fieldLines.hint')}</p>
      {fields.map((field) => {
        const auto = list?.lines_auto[field]
        return (
          <div key={field} className="form-row">
            <label htmlFor={`field-lines-${field}`}>
              <code>{'${' + field + '}'}</code>
            </label>
            <select
              id={`field-lines-${field}`}
              value={list?.lines_chosen[field] ?? 'auto'}
              disabled={!list}
              onChange={async (event) => {
                setProblem(null)
                try {
                  setList(await lists.setLines(docId, field, event.target.value as 'auto' | 'multi' | 'single'))
                } catch (error) {
                  setProblem(String(error instanceof Error ? error.message : error))
                }
              }}
            >
              <option value="auto">
                {auto
                  ? t('fieldLines.auto', { mode: t(auto === 'multi' ? 'list.moreLines' : 'list.oneLine') })
                  : t('fieldLines.autoUnknown')}
              </option>
              <option value="single">{t('list.oneLine')}</option>
              <option value="multi">{t('list.moreLines')}</option>
            </select>
          </div>
        )
      })}
      {problem ? <p className="inline-warning">{problem}</p> : null}
    </fieldset>
  )
}
