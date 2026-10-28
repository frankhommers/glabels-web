/** The label's list on the desktop, on the same grid as the table editor.
 *
 *  The same list the phone adds to. Every change goes to the server as a
 *  change to that one row (or a new row), never as the whole file: a row a
 *  phone adds meanwhile is never written over. Typing in the empty row at
 *  the bottom adds a row; a block pasted from a spreadsheet fills from the
 *  cell it is pasted in.
 */

import { useState } from 'react'
import { DataGrid, type Column, type RenderEditCellContentProps } from 'react-data-grid'
import { lists, type LabelList, type ListRow } from '../api/lists'
import { formatMoment } from '../app/locale'
import { useT } from '../i18n'
import { useDialogs } from '../ui/dialogs'
import { CellEditor, CellText } from './gridCells'
import { parseClipboard } from './tableModel'

const NEW_ROW = '__new'
const NUMBER = '__number'
const COPIES = '__copies'
const STATUS = '__status'
const REMOVE = '__remove'

const emptyRow = (): ListRow => ({ id: NEW_ROW, values: {}, copies: 1, printed: '', printing: false })

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
  const dialogs = useDialogs()
  const fields = list.keys.length > 0 ? list.keys : list.fields

  // What the grid shows: the list, with changes still on their way to the
  // server already in it. A new list from the server replaces it.
  const [shown, setShown] = useState({ list, rows: [...list.rows, emptyRow()] })
  if (shown.list !== list) setShown({ list, rows: [...list.rows, emptyRow()] })
  const rows = shown.rows

  const run = async (work: () => Promise<LabelList>) => {
    try {
      onChange(await work())
    } catch (error) {
      onProblem(String(error instanceof Error ? error.message : error))
      // Show the list as the server has it again.
      setShown({ list, rows: [...list.rows, emptyRow()] })
    }
  }

  /** Send the changed rows, one call per row, in order. */
  const send = async (next: ListRow[], indexes: number[], key: string | undefined) => {
    setShown({ list, rows: next })
    let latest: LabelList | null = null
    try {
      for (const index of indexes) {
        const row = next[index]
        if (!row) continue
        if (row.id === NEW_ROW) {
          if (Object.values(row.values).some((value) => value.trim())) {
            latest = await lists.add(docId, row.values, row.copies)
          }
        } else if (key === COPIES) {
          latest = await lists.change(docId, row.id, { copies: row.copies })
        } else if (key) {
          latest = await lists.change(docId, row.id, { values: { [key]: row.values[key] ?? '' } })
        }
      }
      if (latest) onChange(latest)
    } catch (error) {
      onProblem(String(error instanceof Error ? error.message : error))
      setShown({ list, rows: [...list.rows, emptyRow()] })
    }
  }

  /** A block from a spreadsheet: existing rows are changed field by field,
   *  rows past the end are added. */
  const pasteBlock = async (rowAt: number, fieldAt: number, block: string[][]) => {
    let latest: LabelList | null = null
    try {
      for (const [offset, line] of block.entries()) {
        const values: Record<string, string> = {}
        line.forEach((value, index) => {
          const key = fields[fieldAt + index]
          if (key) values[key] = value
        })
        const row = list.rows[rowAt + offset]
        if (row && !row.printing) latest = await lists.change(docId, row.id, { values })
        else if (!row && Object.values(values).some((value) => value.trim())) latest = await lists.add(docId, values)
      }
      if (latest) onChange(latest)
    } catch (error) {
      onProblem(String(error instanceof Error ? error.message : error))
    }
  }

  const markAllPrinted = async () => {
    const confirmed = await dialogs.confirm({
      title: t('list.markAllPrinted'),
      message: t('list.markAllQuestion', { count: list.pending_rows }),
      confirmLabel: t('list.markAllPrinted'),
    })
    if (confirmed) await run(() => lists.markPrinted(docId, true))
  }

  const clearPrinted = async () => {
    const printed = list.rows.filter((row) => row.printed).length
    const confirmed = await dialogs.confirm({
      title: t('list.clearPrinted'),
      message: t('list.clearQuestion', { count: printed }),
      confirmLabel: t('list.clearPrinted'),
      destructive: true,
    })
    if (confirmed) await run(() => lists.clearPrinted(docId))
  }

  const columns: Column<ListRow>[] = [
    {
      key: NUMBER,
      name: '',
      width: 44,
      frozen: true,
      resizable: false,
      cellClass: 'table-number',
      headerCellClass: 'table-number',
      renderCell: ({ row, rowIdx }) => (row.id === NEW_ROW ? '+' : rowIdx + 1),
    },
    ...fields.map(
      (key): Column<ListRow> => ({
        key,
        name: key,
        minWidth: 80,
        resizable: true,
        editable: (row) => !row.printing,
        editorOptions: { displayCellContent: true },
        renderCell: ({ row }) =>
          row.id === NEW_ROW && key === fields[0] && !row.values[key] ? (
            <span className="muted">{t('list.newRow')}</span>
          ) : (
            <CellText value={row.values[key] ?? ''} />
          ),
        renderEditCell: (props) => <CellEditor {...props} />,
      }),
    ),
    {
      key: COPIES,
      name: t('list.copies'),
      width: 80,
      resizable: false,
      editable: (row) => !row.printing,
      cellClass: 'list-copies-cell',
      renderCell: ({ row }) => row.copies,
      renderEditCell: (props) => <CopiesEditor {...props} />,
    },
    {
      key: STATUS,
      name: t('list.statusColumn'),
      width: 250,
      resizable: false,
      renderCell: ({ row }) => {
        if (row.id === NEW_ROW) return null
        if (row.printing) return <span className="list-badge">{t('list.printing')}</span>
        const printed = Boolean(row.printed)
        return (
          <span className="list-status-cell">
            <button
              type="button"
              className="tool"
              title={t(printed ? 'list.again' : 'list.markPrinted')}
              onClick={(event) => {
                event.stopPropagation()
                void run(() => lists.change(docId, row.id, { printed: !printed }))
              }}
            >
              {printed ? '↺' : '✓'}
            </button>
            {printed ? (
              <span className="muted">{t('list.printedOn', { when: formatMoment(row.printed) })}</span>
            ) : (
              <span>{t('list.toPrintShort')}</span>
            )}
          </span>
        )
      },
    },
    {
      key: REMOVE,
      name: '',
      width: 40,
      resizable: false,
      renderCell: ({ row }) =>
        row.id === NEW_ROW ? null : (
          <button
            type="button"
            className="tool"
            title={t('common.delete')}
            disabled={row.printing}
            onClick={(event) => {
              event.stopPropagation()
              void run(() => lists.remove(docId, row.id))
            }}
          >
            ✕
          </button>
        ),
    },
  ]

  const printed = list.rows.filter((row) => row.printed).length

  return (
    <>
      <div className="toolbar list-toolbar">
        <span className="list-summary">{t('list.toPrint', { count: list.pending_labels })}</span>
        <span className="spacer" />
        <button type="button" disabled={list.pending_rows === 0} onClick={() => void markAllPrinted()}>
          {t('list.markAllPrinted')}
        </button>
        <button type="button" disabled={printed === 0} onClick={() => void clearPrinted()}>
          {t('list.clearPrinted')}
        </button>
      </div>
      <div className="list-grid-wrap">
        <DataGrid
          className="rdg-light table-grid list-grid"
          columns={columns}
          rows={rows}
          rowKeyGetter={(row) => row.id}
          rowHeight={30}
          headerRowHeight={30}
          rowClass={(row) => (row.id === NEW_ROW ? 'table-new-row' : row.printed ? 'list-printed' : undefined)}
          onRowsChange={(next, { indexes, column }) => void send(next, indexes, column.key)}
          onFill={({ columnKey, sourceRow, targetRow }) =>
            columnKey === COPIES
              ? { ...targetRow, copies: sourceRow.copies }
              : { ...targetRow, values: { ...targetRow.values, [columnKey]: sourceRow.values[columnKey] ?? '' } }
          }
          onCellKeyDown={(args, event) => {
            // Delete empties a field, as in a spreadsheet.
            if (args.mode !== 'ACTIVE' || !args.column || args.row.id === NEW_ROW || args.row.printing) return
            if (event.key !== 'Delete' && event.key !== 'Backspace') return
            const key = args.column.key
            if (!fields.includes(key)) return
            event.preventGridDefault()
            event.preventDefault()
            if (args.row.values[key]) void run(() => lists.change(docId, args.row.id, { values: { [key]: '' } }))
          }}
          onCellCopy={({ row, column }, event) => {
            const value = column.key === COPIES ? String(row.copies) : (row.values[column.key] ?? '')
            event.clipboardData.setData('text/plain', value)
            event.preventDefault()
          }}
          onCellPaste={({ row, column }, event) => {
            event.preventDefault()
            const block = parseClipboard(event.clipboardData.getData('text/plain'))
            if (block.length === 0) return row
            if (column.key === COPIES) {
              const copies = Number.parseInt(block[0][0], 10)
              return Number.isFinite(copies) && copies > 0 ? { ...row, copies: Math.min(999, copies) } : row
            }
            if (!fields.includes(column.key)) return row
            if (block.length === 1 && block[0].length === 1) {
              return { ...row, values: { ...row.values, [column.key]: block[0][0] } }
            }
            const rowAt = row.id === NEW_ROW ? list.rows.length : list.rows.findIndex((item) => item.id === row.id)
            void pasteBlock(rowAt, fields.indexOf(column.key), block)
            return row
          }}
        />
      </div>
    </>
  )
}

/** The number of copies: a number field in the cell. */
function CopiesEditor({ row, onRowChange, onClose }: RenderEditCellContentProps<ListRow>) {
  return (
    <input
      className="list-copies-editor"
      type="number"
      min={1}
      max={999}
      autoFocus
      value={row.copies}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        const copies = Number.parseInt(event.target.value, 10)
        onRowChange({ ...row, copies: Number.isFinite(copies) ? Math.max(1, Math.min(999, copies)) : 1 })
      }}
      onBlur={() => onClose(true, false)}
    />
  )
}
