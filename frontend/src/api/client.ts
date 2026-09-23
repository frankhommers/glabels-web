import type {
  DocumentContent,
  DocumentDetail,
  DocumentInfo,
  Health,
  MergePreview,
  PreviewInfo,
  PrintSettings,
  Template,
} from './types'

function printQuery(settings: PrintSettings): string {
  const query = new URLSearchParams()
  if (settings.sheets) query.set('sheets', String(settings.sheets))
  else query.set('copies', String(settings.copies ?? 1))
  query.set('first', String(settings.first ?? 1))
  if (settings.outlines) query.set('outlines', 'true')
  if (settings.crop_marks) query.set('crop_marks', 'true')
  if (settings.reverse) query.set('reverse', 'true')
  if (settings.collate) query.set('collate', 'true')
  if (settings.group_per_page) query.set('group_per_page', 'true')
  return query.toString()
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`
    try {
      const body = await response.json()
      if (typeof body?.detail === 'string') detail = body.detail
    } catch {
      // no JSON body; the status text will do
    }
    throw new ApiError(detail, response.status)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  health: () => request<Health>('/api/health'),

  brands: () => request<string[]>('/api/templates/brands'),

  searchTemplates: (params: {
    q?: string
    brand?: string
    category?: string
    paper_size?: string
    limit?: number
    offset?: number
  }) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value))
    }
    return request<{ total: number; items: Template[] }>(`/api/templates?${query}`)
  },

  saveTemplate: (template: Template) =>
    request<Template>('/api/templates', { method: 'POST', body: JSON.stringify(template) }),

  deleteTemplate: (brand: string, part: string) =>
    request<void>(`/api/templates/${encodeURIComponent(brand)}/${encodeURIComponent(part)}`, {
      method: 'DELETE',
    }),

  listDocuments: () => request<DocumentInfo[]>('/api/documents'),

  createDocument: (body: { name: string; brand: string; part: string; rotate?: boolean }) =>
    request<DocumentDetail>('/api/documents', { method: 'POST', body: JSON.stringify(body) }),

  importDocument: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<DocumentDetail>('/api/documents/import', { method: 'POST', body: form })
  },

  getDocument: (id: string) => request<DocumentDetail>(`/api/documents/${id}`),

  saveAs: (id: string, body: { path: string; name: string; overwrite?: boolean }) =>
    request<DocumentDetail>(`/api/documents/${id}/save-as`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  resolveFile: (id: string, keep: 'app' | 'file') =>
    request<DocumentDetail>(`/api/documents/${id}/file/resolve`, {
      method: 'POST',
      body: JSON.stringify({ keep }),
    }),

  renameDocument: (id: string, name: string) =>
    request<DocumentInfo>(`/api/documents/${id}/name`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),

  importFromFile: (path: string) =>
    request<DocumentDetail>('/api/documents/import-from-file', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  exportToFile: (id: string, path: string, name: string) =>
    request<DocumentInfo>(`/api/documents/${id}/export-to-file`, {
      method: 'POST',
      body: JSON.stringify({ path, name, overwrite: false }),
    }),

  mergePreview: (id: string) => request<MergePreview>(`/api/documents/${id}/merge`),

  setMerge: (id: string, type: string, sourcePath: string | null) =>
    request<DocumentDetail>(`/api/documents/${id}/merge`, {
      method: 'PUT',
      body: JSON.stringify({ type, source_path: sourcePath }),
    }),

  saveDocument: (id: string, content: DocumentContent, name?: string) =>
    request<DocumentDetail>(`/api/documents/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ content, name }),
    }),

  deleteDocument: (id: string) =>
    request<void>(`/api/documents/${id}`, { method: 'DELETE' }),

  downloadUrl: (id: string) => `/api/documents/${id}/file`,

  previewInfo: (id: string, settings: PrintSettings) =>
    request<PreviewInfo>(`/api/documents/${id}/preview?${printQuery(settings)}`),

  previewImageUrl: (id: string, settings: PrintSettings, page: number, dpi: number, revision: number) =>
    `/api/documents/${id}/preview.png?${printQuery(settings)}&page=${page}&dpi=${dpi}&rev=${revision}`,

  printPdfUrl: (id: string, settings: PrintSettings) =>
    `/api/documents/${id}/print.pdf?${printQuery(settings)}`,
}
