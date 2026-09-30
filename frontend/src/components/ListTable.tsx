/** The label's list on the desktop: the rows as a table you can edit.
 *
 *  The same list the phone adds to. A cell is saved when you leave it; the
 *  empty row at the bottom adds a new one.
 */

import { useEffect, useState } from 'react'
import { lists, type LabelList, type ListRow } from '../api/lists'
import { formatMoment } from '../app/locale'
import { useT } from '../i18n'

export function ListTable({
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
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [draftCopies, setDraftCopies] = useState(1)
  const columns = list.keys.length > 0 ? list.keys : list.fields

  const run = async (work: () => Promise<LabelList>) => {
    try {
      onChange(await work())
    } catch (error) {
      onProblem(String(error instanceof Error ? error.message : error))
    }
  }

  const add = async () => {
    if (!Object.values(draft).some((value) => value.trim())) return
    await run(() => lists.add(docId, draft, draftCopies))
    setDraft({})
    setDraftCopies(1)
  }

  return (
    <>
      <div className="toolbar list-toolbar">
        <span className="list-summary">
          {t('list.toPrint', { count: list.pending_labels })}
        </span>
        <span className="spacer" />
        <button type="button" disabled={list.pending_rows === 0} onClick={() => void run(() => lists.markPrinted(docId, true))}>
          {t('list.markAllPrinted')}
        </button>
        <button
          type="button"
          disabled={!list.rows.some((row) => row.printed)}
          onClick={() => void run(() => lists.clearPrinted(docId))}
        >
          {t('list.clearPrinted')}
        </button>
      </div>
      <div className="merge-table-wrap">
        <table className="project-table list-table">
          <thead>
            <tr>
              {columns.map((key) => (
                <th key={key}>{key}</th>
              ))}
              <th className="list-copies">{t('list.copies')}</th>
              <th>{t('list.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.rows.map((row) => (
              <RowEditor key={row.id} docId={docId} row={row} columns={columns} run={run} />
            ))}
            <tr className="list-new">
              {columns.map((key, index) => (
                <td key={key}>
                  <input
                    value={draft[key] ?? ''}
                    placeholder={index === 0 ? t('list.newRow') : undefined}
                    onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void add()
                    }}
                  />
                </td>
              ))}
              <td className="list-copies">
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={draftCopies}
                  onChange={(event) => setDraftCopies(Math.max(1, Number(event.target.value) || 1))}
                />
              </td>
              <td colSpan={2}>
                <button type="button" onClick={() => void add()}>
                  {t('list.add')}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

function RowEditor({
  docId,
  row,
  columns,
  run,
}: {
  docId: string
  row: ListRow
  columns: string[]
  run: (work: () => Promise<LabelList>) => Promise<void>
}) {
  const t = useT()
  const [values, setValues] = useState(row.values)
  const [copies, setCopies] = useState(row.copies)
  // Another device may change the row; take that over.
  useEffect(() => setValues(row.values), [row.values])
  useEffect(() => setCopies(row.copies), [row.copies])

  const saveValue = (key: string) => {
    if ((values[key] ?? '') === (row.values[key] ?? '')) return
    void run(() => lists.change(docId, row.id, { values: { [key]: values[key] ?? '' } }))
  }

  return (
    <tr className={row.printed ? 'list-printed' : undefined}>
      {columns.map((key) => (
        <td key={key}>
          <input
            value={values[key] ?? ''}
            onChange={(event) => setValues({ ...values, [key]: event.target.value })}
            onBlur={() => saveValue(key)}
          />
        </td>
      ))}
      <td className="list-copies">
        <input
          type="number"
          min={1}
          max={999}
          value={copies}
          onChange={(event) => setCopies(Math.max(1, Number(event.target.value) || 1))}
          onBlur={() => {
            if (copies !== row.copies) void run(() => lists.change(docId, row.id, { copies }))
          }}
        />
      </td>
      <td>
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(row.printed)}
            disabled={row.printing}
            onChange={(event) => void run(() => lists.change(docId, row.id, { printed: event.target.checked }))}
          />
          {row.printing ? t('list.printing') : row.printed ? formatMoment(row.printed) : t('list.toPrintShort')}
        </label>
      </td>
      <td>
        <button
          type="button"
          className="tool"
          title={t('common.delete')}
          disabled={row.printing}
          onClick={() => void run(() => lists.remove(docId, row.id))}
        >
          ✕
        </button>
      </td>
    </tr>
  )
}
