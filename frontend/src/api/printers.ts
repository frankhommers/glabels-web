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
  /** What it takes: by the sizes it reports, or set by hand. */
  takes: PrinterTakes
  /** Does the label asked about fit? "maybe": only within a range of sizes
   *  its driver accepts, which many drivers do for nearly any size. Empty
   *  when no label was asked about; "unknown" when the printer never said
   *  which sizes it takes. */
  fit: '' | 'yes' | 'maybe' | 'no' | 'unknown'
}

export type PrinterTakes = 'auto' | 'continuous' | 'fixed' | 'any'

/** A label to judge the printers by: the size of its page, and whether it
 *  is on a continuous roll (tape). */
export type PageQuestion = { widthPt: number; heightPt: number; continuous: boolean }

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
  list: (status = true, page?: PageQuestion) => {
    const query = new URLSearchParams()
    if (!status) query.set('status', 'false')
    if (page) {
      query.set('page_width_pt', String(page.widthPt))
      query.set('page_height_pt', String(page.heightPt))
      query.set('continuous', String(page.continuous))
    }
    const suffix = query.toString() ? `?${query}` : ''
    return fetch(`/api/printers${suffix}`).then((response) => json<PrinterList>(response))
  },

  setTakes: (name: string, takes: PrinterTakes) =>
    fetch(`/api/printers/${encodeURIComponent(name)}/takes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ takes }),
    }).then((response) => json<Printer>(response)),

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

/** The printer chosen last, in this browser or on this phone. */
const PRINTER_KEY = 'glabels-web.printer'
const printerKeyFor = (docId: string) => `${PRINTER_KEY}.${docId}`

/** Remember the printer chosen, for this label and as the latest overall. */
export function rememberPrinter(docId: string, name: string) {
  window.localStorage.setItem(PRINTER_KEY, name)
  window.localStorage.setItem(printerKeyFor(docId), name)
}

/** The printer to preselect for a label: the one chosen for it before,
 *  unless the label does not fit it; else the one chosen last or the
 *  default, if the label fits it; else the first printer it fits. */
export function choosePrinter(printers: Printer[], docId: string): string {
  const named = (name: string | null | undefined) => printers.find((item) => item.name === name)
  const fits = (printer: Printer | undefined) => printer !== undefined && (printer.fit === 'yes' || printer.fit === '')
  const possible = (printer: Printer | undefined) => printer !== undefined && printer.fit !== 'no'
  const forLabel = named(window.localStorage.getItem(printerKeyFor(docId)))
  const others = [named(window.localStorage.getItem(PRINTER_KEY)), printers.find((item) => item.is_default)]
  const chosen =
    (possible(forLabel) ? forLabel : undefined) ??
    others.find(fits) ??
    printers.find(fits) ??
    others.find(possible) ??
    printers.find(possible) ??
    forLabel ??
    others.find(Boolean) ??
    printers[0]
  return chosen?.name ?? ''
}

/** Printers the label fits first, then the ones it may fit or we cannot
 *  tell, then the rest; otherwise as listed. */
export function byFit(printers: Printer[]): Printer[] {
  const rank = { yes: 0, '': 0, maybe: 1, unknown: 2, no: 3 }
  return [...printers].sort((a, b) => rank[a.fit] - rank[b.fit])
}

/** The printer's name in a list, with a word on whether the label fits. */
export function printerOption(t: Translate, printer: Printer, name = printer.name): string {
  if (printer.fit === 'no') return t('print.doesNotFit', { name })
  if (printer.fit === 'maybe') return t('print.mayNotFit', { name })
  return name
}

const mm = (points: number) => (points / (72 / 25.4)).toFixed(1).replace(/\.0$/, '')

/** Why a label does not fit a printer, or may not; `null` when it does. */
export function fitProblem(t: Translate, printer: Printer, page: PageQuestion | null): string | null {
  if (!page || printer.fit === 'yes' || printer.fit === '') return null
  if (printer.fit === 'unknown') return t('printers.fit.unknown')
  if (printer.fit === 'maybe') {
    return t(page.continuous ? 'printers.fit.maybeTape' : 'printers.fit.maybeSize', {
      width: mm(page.widthPt),
      height: mm(page.heightPt),
    })
  }
  if (printer.takes === 'continuous') return t('printers.fit.onlyContinuous')
  if (printer.takes === 'fixed') return t('printers.fit.onlyFixed')
  return t(page.continuous ? 'printers.fit.noTape' : 'printers.fit.noSize', {
    width: mm(page.widthPt),
    height: mm(page.heightPt),
  })
}
