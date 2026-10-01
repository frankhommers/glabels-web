/** On a phone: add rows to a label's list, and see what is still to print.
 *
 *  One field per ${field} on the label and a number of copies; "Add" puts
 *  the row on the list and empties the form for the next one, so going
 *  through a pile of books is quick. Printed rows stay below, to print again
 *  or clear away.
 */

import { useEffect, useRef, useState } from 'react'
import { lists, type LabelList, type ListRow } from '../api/lists'
import { useT } from '../i18n'

export function ListPanel({
  docId,
  list,
  chosenRow,
  onChange,
  onDraft,
  onChoose,
  onProblem,
}: {
  docId: string
  list: LabelList
  /** The row the preview shows. */
  chosenRow: string | null
  onChange: (list: LabelList) => void
  /** What is being typed, after a short pause, for the preview; null when empty. */
  onDraft: (values: Record<string, string> | null) => void
  /** Show this row in the preview. */
  onChoose: (row: string) => void
  onProblem: (message: string) => void
}) {
  const t = useT()
  const [values, setValues] = useState<Record<string, string>>({})
  const [copies, setCopies] = useState(1)
  const [adding, setAdding] = useState(false)
  const [showPrinted, setShowPrinted] = useState(false)
  const fieldRefs = useRef<(HTMLInputElement | HTMLTextAreaElement | null)[]>([])

  /** One line or several: the opposite of now; back to automatic when that
   *  is what the design gives anyway, so the label keeps no needless setting. */
  const toggleLines = (field: string) => {
    const next = list.lines[field] === 'multi' ? 'single' : 'multi'
    void run(() => lists.setLines(docId, field, next === list.lines_auto[field] ? 'auto' : next))
  }

  // A row being changed: the form holds its values until Save or Cancel.
  const [editing, setEditing] = useState<ListRow | null>(null)
  const unchanged =
    editing !== null &&
    copies === editing.copies &&
    list.fields.every((field) => (values[field] ?? '') === (editing.values[field] ?? ''))

  // The preview follows the typing once it pauses, not every key. A row
  // loaded for changing shows as itself until something is changed.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onDraft(!unchanged && Object.values(values).some((value) => value.trim()) ? values : null)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [values, onDraft, unchanged])

  const startEditing = (row: ListRow) => {
    onChoose(row.id)
    if (row.printing) return
    setEditing(row)
    setValues({ ...row.values })
    setCopies(row.copies)
  }

  const stopEditing = () => {
    setEditing(null)
    setValues({})
    setCopies(1)
  }

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
    if (editing) {
      await run(() => lists.change(docId, editing.id, { values, copies }))
      setAdding(false)
      stopEditing()
      return
    }
    await run(() => lists.add(docId, values, copies))
    setAdding(false)
    setValues({})
    setCopies(1)
    fieldRefs.current[0]?.focus()
  }

  const toPrint = list.rows.filter((row) => !row.printed)
  const printed = list.rows.filter((row) => row.printed)
  const describe = (row: ListRow) =>
    list.fields
      .map((field) => row.values[field]?.replace(/\n+/g, ' / '))
      .filter(Boolean)
      .join(' · ') || '—'

  return (
    <>
      <form
        className="mobile-list-form"
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <h2>{editing ? t('list.editTitle') : t('list.addTitle')}</h2>
        {list.fields.map((field, index) => {
          const multi = list.lines[field] === 'multi'
          const last = index === list.fields.length - 1
          return (
            <label key={field} className="mobile-field">
              <span className="mobile-field-head">
                {field}
                <button
                  type="button"
                  className="mobile-lines-toggle"
                  aria-pressed={multi}
                  title={multi ? t('list.oneLine') : t('list.moreLines')}
                  onClick={(event) => {
                    event.preventDefault()
                    toggleLines(field)
                  }}
                >
                  ↵
                </button>
              </span>
              {multi ? (
                <textarea
                  ref={(element) => {
                    fieldRefs.current[index] = element
                  }}
                  value={values[field] ?? ''}
                  rows={Math.max(2, (values[field] ?? '').split('\n').length)}
                  onChange={(event) => setValues({ ...values, [field]: event.target.value })}
                />
              ) : (
                <input
                  ref={(element) => {
                    fieldRefs.current[index] = element
                  }}
                  value={values[field] ?? ''}
                  enterKeyHint={last ? 'done' : 'next'}
                  onKeyDown={(event) => {
                    // Enter goes to the next field; on the last one it adds the row.
                    if (event.key !== 'Enter' || last) return
                    event.preventDefault()
                    fieldRefs.current[index + 1]?.focus()
                  }}
                  onChange={(event) => setValues({ ...values, [field]: event.target.value })}
                />
              )}
            </label>
          )
        })}
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
        {editing ? (
          <div className="mobile-edit-buttons">
            <button type="button" className="mobile-add secondary" onClick={stopEditing}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="mobile-add" disabled={adding || unchanged}>
              {t('common.save')}
            </button>
          </div>
        ) : (
          <button type="submit" className="mobile-add" disabled={adding}>
            {t('list.add')}
          </button>
        )}
      </form>

      <section className="mobile-rows">
        <h2>{t('list.toPrint', { count: list.pending_labels })}</h2>
        {toPrint.length === 0 ? <p className="mobile-note">{t('list.empty')}</p> : null}
        <ul>
          {toPrint.map((row) => (
            <li key={row.id} className={row.id === chosenRow ? 'chosen' : undefined}>
              <button type="button" className="mobile-row-text" onClick={() => startEditing(row)}>
                {describe(row)}
              </button>
              {row.copies > 1 ? <span className="mobile-row-badge">×{row.copies}</span> : null}
              {row.printing ? <span className="mobile-row-badge">{t('list.printing')}</span> : null}
              <button
                type="button"
                className="mobile-row-button"
                aria-label={t('common.delete')}
                disabled={row.printing}
                onClick={() => {
                  if (editing?.id === row.id) stopEditing()
                  void run(() => lists.remove(docId, row.id))
                }}
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
                  <li key={row.id} className={row.id === chosenRow ? 'chosen' : undefined}>
                    <button type="button" className="mobile-row-text" onClick={() => startEditing(row)}>
                      {describe(row)}
                    </button>
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
