/** The content of a merge source while it is edited: columns and rows with
 *  ids of their own, so inserting or removing one does not shift the rest.
 *
 *  With `header` on, line 1 of the file holds the field names (the columns'
 *  names); otherwise every line is data and gLabels names the fields 1, 2, …
 */

export type TableColumn = { id: string; name: string }
export type TableRow = { id: string; values: Record<string, string> }
export type TableState = { columns: TableColumn[]; rows: TableRow[]; header: boolean }

let counter = 0
export const newId = (prefix: string) => `${prefix}${(counter += 1)}`

/** Our own list columns; a label does not use them. */
export const META_COLUMNS = ['_id', '_copies', '_printed']

export function makeRow(columns: TableColumn[], cells: string[] = []): TableRow {
  return {
    id: newId('r'),
    values: Object.fromEntries(columns.map((column, index) => [column.id, cells[index] ?? ''])),
  }
}

/** Line 1 looks like field names: all filled in and all different. */
export function looksLikeHeader(lines: string[][]): boolean {
  const first = lines[0]
  if (!first || first.length === 0) return false
  const names = first.map((name) => name.trim())
  return names.every(Boolean) && new Set(names).size === names.length
}

/** `keep`: columns whose ids to reuse, so widths stay put after a save. */
export function fromLines(lines: string[][], header: boolean, keep: TableColumn[] = []): TableState {
  const width = Math.max(1, ...lines.map((line) => line.length))
  const names = header ? (lines[0] ?? []) : []
  const columns = Array.from({ length: width }, (_, index) => ({
    id: keep[index]?.id ?? newId('c'),
    name: names[index] ?? '',
  }))
  const data = header ? lines.slice(1) : lines
  return { columns, rows: data.map((cells) => makeRow(columns, cells)), header }
}

export function toLines(state: TableState): string[][] {
  const data = state.rows.map((row) => state.columns.map((column) => row.values[column.id] ?? ''))
  return state.header ? [state.columns.map((column) => column.name), ...data] : data
}

/** The name gLabels gives a field: the header, or its column number. */
export function fieldName(state: TableState, index: number): string {
  return state.header ? state.columns[index]?.name ?? '' : String(index + 1)
}

/** Switch line 1 between field names and data. */
export function setHeader(state: TableState, header: boolean): TableState {
  if (header === state.header) return state
  if (header) {
    const [first, ...rest] = state.rows
    return {
      header,
      columns: state.columns.map((column) => ({ ...column, name: first?.values[column.id] ?? '' })),
      rows: rest,
    }
  }
  const names = makeRow(state.columns, state.columns.map((column) => column.name))
  return {
    header,
    columns: state.columns.map((column) => ({ ...column, name: '' })),
    rows: [names, ...state.rows],
  }
}

export function insertRow(state: TableState, at: number): TableState {
  const rows = [...state.rows]
  rows.splice(Math.max(0, Math.min(at, rows.length)), 0, makeRow(state.columns))
  return { ...state, rows }
}

export function deleteRow(state: TableState, at: number): TableState {
  return { ...state, rows: state.rows.filter((_, index) => index !== at) }
}

export function insertColumn(state: TableState, at: number, name = ''): TableState {
  const column = { id: newId('c'), name }
  const columns = [...state.columns]
  columns.splice(Math.max(0, Math.min(at, columns.length)), 0, column)
  return {
    ...state,
    columns,
    rows: state.rows.map((row) => ({ ...row, values: { ...row.values, [column.id]: '' } })),
  }
}

export function deleteColumn(state: TableState, at: number): TableState {
  if (state.columns.length <= 1) return state
  const gone = state.columns[at]
  if (!gone) return state
  return {
    ...state,
    columns: state.columns.filter((_, index) => index !== at),
    rows: state.rows.map((row) => {
      const values = { ...row.values }
      delete values[gone.id]
      return { ...row, values }
    }),
  }
}

export function renameColumn(state: TableState, at: number, name: string): TableState {
  return {
    ...state,
    columns: state.columns.map((column, index) => (index === at ? { ...column, name } : column)),
  }
}

export function sortRows(state: TableState, at: number, descending: boolean): TableState {
  const column = state.columns[at]
  if (!column) return state
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const rows = [...state.rows].sort((a, b) => {
    const order = collator.compare(a.values[column.id] ?? '', b.values[column.id] ?? '')
    return descending ? -order : order
  })
  return { ...state, rows }
}

/** The list's own columns, when line 1 holds names: hidden in the editor
 *  and kept as they are. */
export function isMeta(state: TableState, column: TableColumn): boolean {
  return state.header && META_COLUMNS.includes(column.name)
}

/** Where a new field goes at the end: before the list's own columns. */
export function endOfFields(state: TableState): number {
  const first = state.columns.findIndex((column) => isMeta(state, column))
  return first < 0 ? state.columns.length : first
}

/** Put a block of cells (from a spreadsheet) at a position, adding rows and
 *  fields where it sticks out. The list's own columns are skipped. */
export function pasteBlock(state: TableState, rowAt: number, columnAt: number, block: string[][]): TableState {
  let next = state
  const width = Math.max(...block.map((line) => line.length))
  const targets = () => next.columns.slice(columnAt).filter((column) => !isMeta(next, column))
  while (targets().length < width) next = insertColumn(next, endOfFields(next))
  while (next.rows.length < rowAt + block.length) next = insertRow(next, next.rows.length)
  const columns = targets()
  const rows = next.rows.map((row, index) => {
    const line = block[index - rowAt]
    if (!line) return row
    const values = { ...row.values }
    line.forEach((value, offset) => {
      const column = columns[offset]
      if (column) values[column.id] = value
    })
    return { ...row, values }
  })
  return { ...next, rows }
}

/** What a spreadsheet puts on the clipboard: tab separated lines, a cell with
 *  a line break or tab in it between double quotes. */
export function parseClipboard(text: string): string[][] {
  const lines: string[][] = []
  let line: string[] = []
  let cell = ''
  let quoted = false
  const source = text.replace(/\r\n?/g, '\n')
  for (let index = 0; index < source.length; index += 1) {
    const c = source[index]
    if (quoted) {
      if (c === '"' && source[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (c === '"') {
        quoted = false
      } else {
        cell += c
      }
    } else if (c === '"' && cell === '') {
      quoted = true
    } else if (c === '\t') {
      line.push(cell)
      cell = ''
    } else if (c === '\n') {
      line.push(cell)
      lines.push(line)
      line = []
      cell = ''
    } else {
      cell += c
    }
  }
  if (cell !== '' || line.length > 0) {
    line.push(cell)
    lines.push(line)
  }
  return lines
}
