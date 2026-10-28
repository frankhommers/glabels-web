/** A merge source (.csv, .tsv, .txt) as a table you can edit, like a small
 *  spreadsheet: type in a cell, paste a block from Excel or Numbers, add or
 *  remove rows and fields.
 *
 *  The server reads and writes the file the way gLabels does, so a line
 *  break in a cell ends up as `\n`, which gLabels prints as a new line.
 *  Saving is refused when the file changed after it was opened (a row from a
 *  phone, for example); you then choose whether to save over it.
 */

import 'react-data-grid/lib/styles.css'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DataGrid, type Column, type RenderEditCellContentProps } from 'react-data-grid'
import { ChangedElsewhere, files } from '../api/files'
import { useHistory } from '../editor/useHistory'
import { useT } from '../i18n'
import { useDialogs } from '../ui/dialogs'
import * as model from './tableModel'

type GridRow = model.TableRow

/** The empty row at the bottom: typing in it adds a row. */
const NEW_ROW = '__new'
const NUMBER_COLUMN = '__number'

const DELIMITERS = [
  { value: ',', label: 'table.delimiter.comma' },
  { value: ';', label: 'table.delimiter.semicolon' },
  { value: '\t', label: 'table.delimiter.tab' },
  { value: ':', label: 'table.delimiter.colon' },
] as const

type Menu = { x: number; y: number; rowIdx: number; columnIdx: number }

export function TableEditor({
  path,
  header,
  onClose,
  onSaved,
}: {
  path: string
  /** Line 1 holds the field names; guessed from the content when not given. */
  header?: boolean
  onClose: () => void
  onSaved?: () => void
}) {
  const t = useT()
  const dialogs = useDialogs()
  const history = useHistory<model.TableState>({ columns: [], rows: [], header: true })
  const table = history.present
  const [saved, setSaved] = useState<model.TableState | null>(null)
  const [source, setSource] = useState<{ delimiter: string; sha256: string } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState<{ rowIdx: number; columnIdx: number } | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const dirty = saved !== null && table !== saved
  const name = path.split('/').pop() ?? path

  const load = useCallback(
    async (delimiter?: string) => {
      setBusy(true)
      setProblem(null)
      try {
        const result = await files.readTable(path, delimiter)
        const next = model.fromLines(result.rows, header ?? model.looksLikeHeader(result.rows))
        history.reset(next)
        setSaved(next)
        setSource({ delimiter: result.delimiter, sha256: result.sha256 })
      } catch (error) {
        setProblem(String(error instanceof Error ? error.message : error))
      } finally {
        setBusy(false)
      }
    },
    // history.reset is stable; header only counts when opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path],
  )

  useEffect(() => {
    void load()
  }, [load])

  const change = (next: model.TableState) => {
    if (next !== table) history.commit(next)
  }

  const save = async (overwrite = false): Promise<void> => {
    if (!source) return
    setBusy(true)
    setProblem(null)
    const lines = model.toLines(table)
    try {
      const result = await files.saveTable({
        path,
        delimiter: source.delimiter,
        rows: lines,
        sha256: overwrite ? undefined : source.sha256,
      })
      setSource({ delimiter: result.delimiter, sha256: result.sha256 })
      // The server leaves out empty lines and gives new list rows an id: take
      // that over, without losing undo.
      if (JSON.stringify(result.rows) === JSON.stringify(lines)) {
        setSaved(table)
      } else {
        const next = model.fromLines(result.rows, table.header, table.columns)
        history.adopt(next)
        setSaved(next)
      }
      onSaved?.()
    } catch (error) {
      if (error instanceof ChangedElsewhere) {
        setBusy(false)
        const confirmed = await dialogs.confirm({
          title: t('table.changedTitle'),
          message: t('table.changedMessage'),
          confirmLabel: t('table.overwrite'),
          destructive: true,
        })
        if (confirmed) await save(true)
        return
      }
      setProblem(String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  const discardFirst = async (message: string) =>
    !dirty ||
    dialogs.confirm({
      title: t('table.discardTitle'),
      message,
      confirmLabel: t('table.discard'),
      destructive: true,
    })

  const close = async () => {
    if (await discardFirst(t('table.discardMessage'))) onClose()
  }

  const reload = async (delimiter?: string) => {
    if (await discardFirst(t('table.reloadMessage'))) await load(delimiter)
  }

  // Keyboard shortcuts of the window, except while typing in a cell.
  const shortcuts = useRef<(event: KeyboardEvent) => void>(() => {})
  shortcuts.current = (event) => {
    if (!(event.ctrlKey || event.metaKey)) return
    const key = event.key.toLowerCase()
    if (key === 's') {
      event.preventDefault()
      if (dirty && !busy) void save()
      return
    }
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, select')) return
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault()
      history.undo()
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault()
      history.redo()
    }
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => shortcuts.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const rename = async (columnIdx: number) => {
    if (!table.header) return
    const current = table.columns[columnIdx]
    if (!current) return
    const next = await dialogs.prompt({
      title: t('table.renameTitle'),
      label: t('table.fieldName'),
      value: current.name,
      confirmLabel: t('common.ok'),
    })
    if (next !== null && next.trim() !== current.name) change(model.renameColumn(table, columnIdx, next.trim()))
  }

  const rows = useMemo<GridRow[]>(() => [...table.rows, { id: NEW_ROW, values: {} }], [table.rows])

  const columns = useMemo<Column<GridRow>[]>(
    () => [
      {
        key: NUMBER_COLUMN,
        name: '',
        width: 44,
        frozen: true,
        resizable: false,
        cellClass: 'table-number',
        headerCellClass: 'table-number',
        renderCell: ({ row, rowIdx }) => (row.id === NEW_ROW ? '+' : rowIdx + 1),
      },
      ...table.columns.map((column, index): Column<GridRow> => {
        const field = model.fieldName(table, index)
        const meta = table.header && model.META_COLUMNS.includes(column.name)
        return {
          key: column.id,
          name: field,
          minWidth: 60,
          resizable: true,
          editable: !(table.header && column.name === '_id'),
          cellClass: meta ? 'table-meta' : undefined,
          headerCellClass: meta ? 'table-meta' : undefined,
          editorOptions: { displayCellContent: true },
          renderHeaderCell: () => (
            <span
              className="table-header"
              title={meta ? t('table.metaColumn') : table.header ? t('table.renameHint') : undefined}
              onDoubleClick={() => void rename(index)}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenu({ x: event.clientX, y: event.clientY, rowIdx: -1, columnIdx: index })
              }}
            >
              {field || <span className="muted">{t('table.noName')}</span>}
            </span>
          ),
          renderCell: ({ row }) => <CellText value={row.values[column.id] ?? ''} />,
          renderEditCell: (props) => <CellEditor {...props} />,
        }
      }),
    ],
    // rename reads the table it was made with, which is this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table.columns, table.header, t],
  )

  /** Grid rows back to the table: the new row becomes a real one once it
   *  holds something. */
  const rowsChanged = (next: GridRow[]) => {
    const real = next.flatMap((row) => {
      if (row.id !== NEW_ROW) return [row]
      return Object.values(row.values).some(Boolean) ? [{ ...row, id: model.newId('r') }] : []
    })
    change({ ...table, rows: real })
  }

  const columnIndex = (key: string) => table.columns.findIndex((column) => column.id === key)
  const rowIndex = (row: GridRow) => (row.id === NEW_ROW ? table.rows.length : table.rows.indexOf(row))

  const menuItems = (target: Menu) => {
    const { rowIdx, columnIdx } = target
    const realRow = rowIdx >= 0 && rowIdx < table.rows.length
    const items: ({ label: string; run: () => void; disabled?: boolean } | 'separator')[] = []
    if (rowIdx >= 0) {
      items.push(
        { label: t('table.insertRowAbove'), run: () => change(model.insertRow(table, rowIdx)) },
        { label: t('table.insertRowBelow'), run: () => change(model.insertRow(table, rowIdx + 1)), disabled: !realRow },
        { label: t('table.deleteRow'), run: () => change(model.deleteRow(table, rowIdx)), disabled: !realRow },
        'separator',
      )
    }
    items.push(
      { label: t('table.insertColumnLeft'), run: () => change(model.insertColumn(table, columnIdx)) },
      { label: t('table.insertColumnRight'), run: () => change(model.insertColumn(table, columnIdx + 1)) },
      { label: t('table.renameColumn'), run: () => void rename(columnIdx), disabled: !table.header },
      {
        label: t('table.deleteColumn'),
        run: () => change(model.deleteColumn(table, columnIdx)),
        disabled: table.columns.length <= 1,
      },
      'separator',
      { label: t('table.sortAscending'), run: () => change(model.sortRows(table, columnIdx, false)) },
      { label: t('table.sortDescending'), run: () => change(model.sortRows(table, columnIdx, true)) },
    )
    return items
  }

  const activeRowIsReal = active !== null && active.rowIdx >= 0 && active.rowIdx < table.rows.length
  const activeColumn = active !== null && active.columnIdx >= 0 ? active.columnIdx : null

  return (
    <div className="modal-backdrop" role="dialog" aria-modal aria-label={t('table.title', { name })}>
      <div className="modal table-editor">
        <div className="modal-title">
          {t('table.title', { name })}
          {dirty ? <span className="table-dirty"> — {t('table.unsaved')}</span> : null}
        </div>

        <div className="toolbar table-toolbar">
          <button type="button" className="default" disabled={!dirty || busy} onClick={() => void save()}>
            {t('common.save')}
          </button>
          <button type="button" className="tool text-tool" disabled={!history.canUndo} onClick={history.undo}>
            {t('menu.edit.undo')}
          </button>
          <button type="button" className="tool text-tool" disabled={!history.canRedo} onClick={history.redo}>
            {t('menu.edit.redo')}
          </button>
          <span className="toolbar-separator" />
          <button
            type="button"
            className="tool text-tool"
            disabled={busy}
            onClick={() => change(model.insertRow(table, activeRowIsReal ? active.rowIdx + 1 : table.rows.length))}
          >
            {t('table.addRow')}
          </button>
          <button
            type="button"
            className="tool text-tool"
            disabled={!activeRowIsReal}
            onClick={() => active && change(model.deleteRow(table, active.rowIdx))}
          >
            {t('table.deleteRow')}
          </button>
          <button
            type="button"
            className="tool text-tool"
            disabled={busy}
            onClick={() => change(model.insertColumn(table, activeColumn !== null ? activeColumn + 1 : table.columns.length))}
          >
            {t('table.addColumn')}
          </button>
          <button
            type="button"
            className="tool text-tool"
            disabled={activeColumn === null || table.columns.length <= 1}
            onClick={() => activeColumn !== null && change(model.deleteColumn(table, activeColumn))}
          >
            {t('table.deleteColumn')}
          </button>
          <span className="toolbar-separator" />
          <label className="table-option">
            <input
              type="checkbox"
              checked={table.header}
              disabled={busy}
              onChange={(event) => change(model.setHeader(table, event.target.checked))}
            />
            {t('table.header')}
          </label>
          <label className="table-option">
            {t('table.delimiter')}
            <select
              value={source?.delimiter ?? ','}
              disabled={busy || !source}
              onChange={(event) => void reload(event.target.value)}
            >
              {DELIMITERS.map((item) => (
                <option key={item.label} value={item.value}>
                  {t(item.label)}
                </option>
              ))}
            </select>
          </label>
          <span className="spacer" />
          <button type="button" className="tool text-tool" disabled={busy} onClick={() => void reload(source?.delimiter)}>
            {t('table.reload')}
          </button>
        </div>

        {problem ? <p className="inline-warning table-problem">{problem}</p> : null}

        <div className="table-grid-wrap">
          {saved ? (
            <DataGrid
              className="rdg-light table-grid"
              columns={columns}
              rows={rows}
              rowKeyGetter={(row) => row.id}
              rowHeight={30}
              headerRowHeight={30}
              rowClass={(row) => (row.id === NEW_ROW ? 'table-new-row' : undefined)}
              onRowsChange={rowsChanged}
              onActivePositionChange={({ rowIdx, column }) =>
                setActive(column ? { rowIdx, columnIdx: columnIndex(column.key) } : null)
              }
              onFill={({ columnKey, sourceRow, targetRow }) => ({
                ...targetRow,
                values: { ...targetRow.values, [columnKey]: sourceRow.values[columnKey] ?? '' },
              })}
              onCellKeyDown={(args, event) => {
                // Delete empties the cell, as in a spreadsheet.
                if (args.mode !== 'ACTIVE' || !args.column || args.row.id === NEW_ROW) return
                if (event.key !== 'Delete' && event.key !== 'Backspace') return
                const key = args.column.key
                if (columnIndex(key) < 0 || (table.header && table.columns[columnIndex(key)]?.name === '_id')) return
                event.preventGridDefault()
                event.preventDefault()
                const row = args.row
                if (row.values[key]) {
                  change({
                    ...table,
                    rows: table.rows.map((item) =>
                      item === row ? { ...item, values: { ...item.values, [key]: '' } } : item,
                    ),
                  })
                }
              }}
              onCellCopy={({ row, column }, event) => {
                event.clipboardData.setData('text/plain', row.values[column.key] ?? '')
                event.preventDefault()
              }}
              onCellPaste={({ row, column }, event) => {
                const block = model.parseClipboard(event.clipboardData.getData('text/plain'))
                event.preventDefault()
                if (block.length === 0) return row
                if (block.length === 1 && block[0].length === 1) {
                  return { ...row, values: { ...row.values, [column.key]: block[0][0] } }
                }
                // A block from a spreadsheet: fill from this cell on.
                change(model.pasteBlock(table, rowIndex(row), columnIndex(column.key), block))
                return row
              }}
              onCellContextMenu={({ row, rowIdx, column, setActivePosition }, event) => {
                const index = columnIndex(column.key)
                if (index < 0) return
                event.preventGridDefault()
                event.preventDefault()
                setActivePosition()
                setMenu({ x: event.clientX, y: event.clientY, rowIdx: row.id === NEW_ROW ? table.rows.length : rowIdx, columnIdx: index })
              }}
            />
          ) : (
            <p className="muted table-loading">{busy ? t('common.busy') : null}</p>
          )}
        </div>

        <div className="modal-buttons">
          <span className="muted table-summary">
            {t('table.rows', { count: table.rows.length })} · {t('table.fields', { count: table.columns.length })}
            {' — '}
            {t('table.hint')}
          </span>
          <span className="spacer" />
          <button type="button" onClick={() => void close()}>
            {t('common.close')}
          </button>
        </div>
      </div>

      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />
      ) : null}
    </div>
  )
}

/** A cell's text on one line; a line break shows as ↵. */
function CellText({ value }: { value: string }) {
  if (!value.includes('\n')) return <>{value}</>
  const lines = value.split('\n')
  return (
    <>
      {lines.map((line, index) => (
        <span key={index}>
          {index > 0 ? <span className="table-newline">↵</span> : null}
          {line}
        </span>
      ))}
    </>
  )
}

/** Editing a cell: a text area over the cell, so a value can hold several
 *  lines. Enter is done, Shift+Enter (or Alt+Enter) a new line, Escape
 *  undoes the typing. */
function CellEditor({ row, column, onRowChange, onClose }: RenderEditCellContentProps<GridRow>) {
  const anchor = useRef<HTMLSpanElement | null>(null)
  const area = useRef<HTMLTextAreaElement | null>(null)
  const value = row.values[column.key] ?? ''

  // Over the cell, a bit wider when the cell is narrow; focused right away so
  // the key that started editing ends up in it.
  useLayoutEffect(() => {
    const cell = anchor.current?.closest('[role="gridcell"]')
    const element = area.current
    if (!cell || !element) return
    const box = cell.getBoundingClientRect()
    element.style.left = `${box.left}px`
    element.style.top = `${box.top}px`
    element.style.width = `${Math.max(box.width, 220)}px`
    element.style.minHeight = `${box.height}px`
    element.focus()
    element.select()
  }, [])

  const set = (next: string) => onRowChange({ ...row, values: { ...row.values, [column.key]: next } })

  return (
    <>
      <span ref={anchor} hidden />
      {createPortal(
        <textarea
          ref={area}
          className="table-cell-editor"
          rows={Math.min(8, value.split('\n').length)}
          value={value}
          onChange={(event) => set(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.shiftKey || event.altKey)) {
              // A new line in the cell; the grid must not see this Enter.
              event.stopPropagation()
              if (event.altKey) {
                event.preventDefault()
                const { selectionStart, selectionEnd } = event.currentTarget
                set(value.slice(0, selectionStart) + '\n' + value.slice(selectionEnd))
                requestAnimationFrame(() => area.current?.setSelectionRange(selectionStart + 1, selectionStart + 1))
              }
            } else if (event.key === 'Enter') {
              event.preventDefault()
            } else if (event.key === 'Tab') {
              event.preventDefault()
              event.stopPropagation()
              onClose(true)
            }
          }}
        />,
        document.body,
      )}
    </>
  )
}

function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: ({ label: string; run: () => void; disabled?: boolean } | 'separator')[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', away, true)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('mousedown', away, true)
      window.removeEventListener('keydown', escape, true)
    }
  }, [onClose])

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const box = element.getBoundingClientRect()
    element.style.left = `${Math.min(x, window.innerWidth - box.width - 4)}px`
    element.style.top = `${Math.min(y, window.innerHeight - box.height - 4)}px`
  }, [x, y])

  return (
    <div ref={ref} className="menu-popup table-menu" role="menu" style={{ left: x, top: y }}>
      {items.map((item, index) =>
        item === 'separator' ? (
          <hr key={index} />
        ) : (
          <button
            key={index}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.run()
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  )
}
