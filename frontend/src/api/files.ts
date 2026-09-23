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

  downloadUrl: (path: string) => `/api/files/download?path=${encodeURIComponent(path)}`,
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`
  return `${bytes} B`
}
