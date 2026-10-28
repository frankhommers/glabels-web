/** Cells shared by the table editor and the list on the Merge page: a
 *  value shown on one line, and an editor that can hold several lines. */

import 'react-data-grid/lib/styles.css'
import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { RenderEditCellContentProps } from 'react-data-grid'

/** A cell's text on one line; a line break shows as ↵. */
export function CellText({ value }: { value: string }) {
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
export function CellEditor<R extends { values: Record<string, string> }>({
  row,
  column,
  onRowChange,
  onClose,
}: RenderEditCellContentProps<R>) {
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
