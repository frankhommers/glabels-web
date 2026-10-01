/** A label's list: rows added from any device, printed when you like.
 *  See `routes_lists.py` in the backend. */

import { ApiError } from './client'

export type ListRow = {
  id: string
  values: Record<string, string>
  copies: number
  /** When it was printed; empty while still to print. */
  printed: string
  /** A job with this row is on its way to the printer. */
  printing: boolean
}

export type LabelList = {
  available: boolean
  reason?: 'no-fields' | 'needs-field-names' | null
  source_path?: string | null
  /** The fields the label uses. */
  fields: string[]
  /** All columns of the source. */
  keys: string[]
  rows: ListRow[]
  pending_rows: number
  pending_labels: number
  /** Per field: "multi" (several lines) or "single". */
  lines: Record<string, 'multi' | 'single'>
  /** Choices made in the label; a field without one follows the design. */
  lines_chosen: Record<string, 'multi' | 'single'>
  /** What the design gives. */
  lines_auto: Record<string, 'multi' | 'single'>
}

async function call(path: string, init?: RequestInit): Promise<LabelList> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!response.ok) {
    let detail = `${response.status}`
    try {
      detail = (await response.json()).detail ?? detail
    } catch {
      // no JSON body
    }
    throw new ApiError(detail, response.status)
  }
  return (await response.json()) as LabelList
}

const base = (id: string) => `/api/documents/${id}/list`

export const lists = {
  get: (id: string) => call(base(id)),
  add: (id: string, values: Record<string, string>, copies = 1) =>
    call(`${base(id)}/rows`, { method: 'POST', body: JSON.stringify({ values, copies }) }),
  change: (id: string, row: string, change: { values?: Record<string, string>; copies?: number; printed?: boolean }) =>
    call(`${base(id)}/rows/${row}`, { method: 'PUT', body: JSON.stringify(change) }),
  remove: (id: string, row: string) => call(`${base(id)}/rows/${row}`, { method: 'DELETE' }),
  markPrinted: (id: string, printed = true, ids?: string[]) =>
    call(`${base(id)}/printed`, { method: 'POST', body: JSON.stringify({ printed, ids: ids ?? null }) }),
  clearPrinted: (id: string) => call(`${base(id)}/clear-printed`, { method: 'POST' }),
  setLines: (id: string, field: string, lines: 'auto' | 'multi' | 'single') =>
    call(`${base(id)}/fields/${encodeURIComponent(field)}`, { method: 'PUT', body: JSON.stringify({ lines }) }),
}
