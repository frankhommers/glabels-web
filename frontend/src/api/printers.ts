/** Printer management and printing. */

import type { MessageKey, Translate } from '../i18n'
import type { PrintSettings } from './types'

export type Printer = {
  name: string
  uri: string
  info: string
  location: string
  is_default: boolean
  /** Queried live from the printer; empty when it does not respond. */
  state: string
  /** IPP printer-state (3 idle, 4 processing, 5 stopped); 0 when unreachable. */
  state_code: number
  state_message: string
  accepting: boolean
  make_and_model: string
  reachable: boolean
}

export type PrinterList = {
  available: boolean
  message?: string | null
  printers: Printer[]
}

export type ProbeResult = {
  reachable: boolean
  uri: string
  name: string
  make_and_model: string
  state: string
  state_code: number
  accepting: boolean
  document_formats: string[]
  media: string[]
  media_ready: string[]
  resolutions: string[]
  accepts_pdf: boolean
  problems: string[]
}

export type PrintJob = {
  request_id: string
  job_id: number
  printer: string
  title: string
  created_at: string
  state: string
  /** IPP job-state (3 pending … 9 completed); 0 when the printer reported nothing. */
  state_code: number
  state_message: string
  reachable: boolean
  finished: boolean
  /** Still pending or processing: worth asking again. */
  active: boolean
}

export type PrintJobList = { items: PrintJob[]; total: number }

export type PrintResult = {
  job_id: number
  printer: string
  document: string
  revision: number
  state: string
  duplicate: boolean
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

const asJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const printers = {
  /** With `status`, every printer is asked for its state, which can take a
   *  few seconds; without it the list comes straight from our own records. */
  list: (status = true) =>
    fetch(status ? '/api/printers' : '/api/printers?status=false').then((response) =>
      json<PrinterList>(response),
    ),

  probe: (uri: string) =>
    fetch('/api/printers/probe', asJson({ uri })).then((response) => json<ProbeResult>(response)),

  add: (body: { name: string; uri: string; info?: string; location?: string }) =>
    fetch('/api/printers', asJson(body)).then((response) => json<Printer>(response)),

  remove: (name: string) =>
    fetch(`/api/printers/${encodeURIComponent(name)}`, { method: 'DELETE' }).then((response) =>
      json<void>(response),
    ),

  setDefault: (name: string) =>
    fetch(`/api/printers/${encodeURIComponent(name)}/default`, { method: 'POST' }).then((response) =>
      json<PrinterList>(response),
    ),

  jobs: (limit = 10, offset = 0) =>
    fetch(`/api/printers/jobs?limit=${limit}&offset=${offset}`).then((response) =>
      json<PrintJobList>(response),
    ),

  clearJobs: () =>
    fetch('/api/printers/jobs/clear', { method: 'POST' }).then((response) =>
      json<{ removed: number }>(response),
    ),

  cancelJob: (requestId: string) =>
    fetch(`/api/printers/jobs/${encodeURIComponent(requestId)}`, { method: 'DELETE' }).then(
      (response) => json<void>(response),
    ),

  print: (documentId: string, printer: string, settings: PrintSettings, requestId: string) =>
    fetch(
      `/api/documents/${documentId}/print`,
      asJson({ printer, settings, request_id: requestId }),
    ).then((response) => json<PrintResult>(response)),
}

/** A printer's state in the user's language. */
export function printerState(
  t: Translate,
  printer: { state_code: number; reachable?: boolean },
): string {
  if (printer.reachable === false) return t('printers.state.unreachable')
  const keys: Record<number, MessageKey> = {
    3: 'printers.state.idle',
    4: 'printers.state.processing',
    5: 'printers.state.stopped',
  }
  const key = keys[printer.state_code]
  return key ? t(key) : t('common.unknown')
}

/** An id per print action, so a repeated submission does not print twice. */
export function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
