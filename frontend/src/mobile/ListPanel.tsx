/** On a phone: add rows to a label's list, and see what is still to print.
 *
 *  One field per ${field} on the label and a number of copies; "Add" puts
 *  the row on the list and empties the form for the next one, so going
 *  through a pile of books is quick. Printed rows stay below, to print again
 *  or clear away.
 */

import { useRef, useState } from 'react'
import { lists, type LabelList, type ListRow } from '../api/lists'
import { useT } from '../i18n'

export function ListPanel({
  docId,
  list,
  onChange,
  onProblem,
}: {
  docId: string
  list: LabelList
  onChange: (list: LabelList) => void
  onProblem: (message: string) => void
}) {
  const t = useT()
  const [values, setValues] = useState<Record<string, string>>({})
  const [copies, setCopies] = useState(1)
  const [adding, setAdding] = useState(false)
  const [showPrinted, setShowPrinted] = useState(false)
  const firstField = useRef<HTMLInputElement | null>(null)

  const run = async (work: () => Promise<LabelList>) => {
    try {
      onChange(await work())
    } catch (error) {
      onProblem(String(error instanceof Error ? error.message : error))
    }
  }

  const add = async () => {
    if (!Object.values(values).some((value) => value.trim())) return
    setAdding(true)
    await run(() => lists.add(docId, values, copies))
    setAdding(false)
    setValues({})
    setCopies(1)
    firstField.current?.focus()
  }

  const toPrint = list.rows.filter((row) => !row.printed)
  const printed = list.rows.filter((row) => row.printed)
  const describe = (row: ListRow) =>
    list.fields.map((field) => row.values[field]).filter(Boolean).join(' · ') || '—'

  return (
    <>
      <form
        className="mobile-list-form"
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <h2>{t('list.addTitle')}</h2>
        {list.fields.map((field, index) => (
          <label key={field} className="mobile-field">
            <span>{field}</span>
            <input
              ref={index === 0 ? firstField : undefined}
              value={values[field] ?? ''}
              enterKeyHint={index === list.fields.length - 1 ? 'done' : 'next'}
              onChange={(event) => setValues({ ...values, [field]: event.target.value })}
            />
          </label>
        ))}
        <div className="mobile-copies">
          <span>{t('mobile.copies')}</span>
          <button type="button" aria-label="−" disabled={copies <= 1} onClick={() => setCopies(copies - 1)}>
            −
          </button>
          <output>{copies}</output>
          <button type="button" aria-label="+" disabled={copies >= 99} onClick={() => setCopies(copies + 1)}>
            +
          </button>
        </div>
        <button type="submit" className="mobile-add" disabled={adding}>
          {t('list.add')}
        </button>
      </form>

      <section className="mobile-rows">
        <h2>{t('list.toPrint', { count: list.pending_labels })}</h2>
        {toPrint.length === 0 ? <p className="mobile-note">{t('list.empty')}</p> : null}
        <ul>
          {toPrint.map((row) => (
            <li key={row.id}>
              <span className="mobile-row-text">{describe(row)}</span>
              {row.copies > 1 ? <span className="mobile-row-badge">×{row.copies}</span> : null}
              {row.printing ? <span className="mobile-row-badge">{t('list.printing')}</span> : null}
              <button
                type="button"
                className="mobile-row-button"
                aria-label={t('common.delete')}
                disabled={row.printing}
                onClick={() => void run(() => lists.remove(docId, row.id))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        {toPrint.length > 5 ? (
          <button type="button" className="mobile-link" onClick={() => void run(() => lists.markPrinted(docId, true))}>
            {t('list.markAllPrinted')}
          </button>
        ) : null}
      </section>

      {printed.length > 0 ? (
        <section className="mobile-rows printed">
          <button type="button" className="mobile-link" onClick={() => setShowPrinted(!showPrinted)}>
            {showPrinted ? '▾' : '▸'} {t('list.printed', { count: printed.length })}
          </button>
          {showPrinted ? (
            <>
              <ul>
                {printed.map((row) => (
                  <li key={row.id}>
                    <span className="mobile-row-text">{describe(row)}</span>
                    {row.copies > 1 ? <span className="mobile-row-badge">×{row.copies}</span> : null}
                    <button
                      type="button"
                      className="mobile-row-button"
                      aria-label={t('list.again')}
                      title={t('list.again')}
                      onClick={() => void run(() => lists.change(docId, row.id, { printed: false }))}
                    >
                      ↺
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="mobile-link" onClick={() => void run(() => lists.clearPrinted(docId))}>
                {t('list.clearPrinted')}
              </button>
            </>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
