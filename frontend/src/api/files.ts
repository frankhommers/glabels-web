/** The shared folder: merge sources, .glabels files and fonts. */

export type FileKind = 'folder' | 'document' | 'data' | 'font' | 'definition' | 'other'

export type FileEntry = {
  path: string
  name: string
  is_dir: boolean
  size_bytes: number
  modified_at: string
  kind: FileKind
}

export type DirectoryListing = {
  path: string
  parent: string | null
  available: boolean
  entries: FileEntry[]
}

/** A merge source as lines of cells, read the way gLabels reads it. */
export type Table = {
  path: string
  delimiter: string
  rows: string[][]
  /** The version read; saving over a newer one is refused. */
  sha256: string
}

/** An earlier version of a data file, kept before the application changed it. */
export type FileVersion = { id: string; saved_at: string; size_bytes: number; lines: number }

/** The file changed after it was read (a row from a phone, for example). */
export class ChangedElsewhere extends Error {}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`
    try {
      const body = await response.json()
      if (typeof body?.detail === 'string') detail = body.detail
    } catch {
      // no JSON body
    }
    throw new Error(detail)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const files = {
  list: (path = '') =>
    fetch(`/api/files?path=${encodeURIComponent(path)}`).then((response) =>
      json<DirectoryListing>(response),
    ),

  upload: (path: string, file: File) => {
    const form = new FormData()
    form.append('path', path)
    form.append('file', file)
    return fetch('/api/files/upload', { method: 'POST', body: form }).then((response) =>
      json<FileEntry>(response),
    )
  },

  makeDirectory: (path: string, name: string) =>
    fetch('/api/files/directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name }),
    }).then((response) => json<FileEntry>(response)),

  remove: (path: string) =>
    fetch(`/api/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' }).then((response) =>
      json<void>(response),
    ),

  /** With `version`: that earlier version, stamped as the file is now. */
  readTable: (path: string, delimiter?: string, version?: string) => {
    const query = new URLSearchParams({ path })
    if (delimiter) query.set('delimiter', delimiter)
    if (version) query.set('version', version)
    return fetch(`/api/files/table?${query}`).then((response) => json<Table>(response))
  },

  versions: (path: string) =>
    fetch(`/api/files/versions?${new URLSearchParams({ path })}`).then((response) => json<FileVersion[]>(response)),

  /** Without `sha256` whatever is there is overwritten. */
  saveTable: async (table: { path: string; delimiter: string; rows: string[][]; sha256?: string }) => {
    const response = await fetch('/api/files/table', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(table),
    })
    if (response.status === 409) throw new ChangedElsewhere('changed-elsewhere')
    return json<Table>(response)
  },

  downloadUrl: (path: string) => `/api/files/download?path=${encodeURIComponent(path)}`,
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`
  return `${bytes} B`
}
