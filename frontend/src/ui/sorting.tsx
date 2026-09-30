/** Sortable table columns.
 *
 *  Click a column header to sort on it, click again to reverse. The choice is
 *  remembered per table in this browser. Names compare the way people read
 *  them: "Box 2" before "Box 10", capitals and accents aside.
 */

import { useState } from 'react'

export type SortState = { key: string; descending: boolean }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function compareText(a: string, b: string): number {
  return collator.compare(a, b)
}

export function compareNumber(a: number, b: number): number {
  return a - b
}

export function useSort(storageKey: string, initial: SortState) {
  const [state, setState] = useState<SortState>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')
      if (stored && typeof stored.key === 'string' && typeof stored.descending === 'boolean') return stored
    } catch {
      // unreadable: start from the default
    }
    return initial
  })

  /** Sort on this column; the same column again reverses the order. A new
   *  column starts in its own natural direction (newest first for dates). */
  const sortBy = (key: string, descendingFirst = false) => {
    const next = key === state.key ? { key, descending: !state.descending } : { key, descending: descendingFirst }
    setState(next)
    window.localStorage.setItem(storageKey, JSON.stringify(next))
  }

  return [state, sortBy] as const
}

/** Order a list: `compare` sorts ascending, the direction is applied here. */
export function sorted<T>(items: T[], state: SortState, compare: (a: T, b: T) => number): T[] {
  const direction = state.descending ? -1 : 1
  return [...items].sort((a, b) => compare(a, b) * direction)
}

export function SortHeader({
  label,
  column,
  state,
  onSort,
  descendingFirst = false,
}: {
  label: string
  column: string
  state: SortState
  onSort: (key: string, descendingFirst?: boolean) => void
  descendingFirst?: boolean
}) {
  const active = state.key === column
  return (
    <th aria-sort={active ? (state.descending ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="sort-header" onClick={() => onSort(column, descendingFirst)}>
        <span>{label}</span>
        <span className="sort-arrow" aria-hidden="true">
          {active ? (state.descending ? '▼' : '▲') : ''}
        </span>
      </button>
    </th>
  )
}
