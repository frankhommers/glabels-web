/** Printers attached to this device next to the network printers: one list
 *  to choose from, and printing to whichever is chosen. */

import { newRequestId, printers as printerApi, type PageQuestion, type Printer, type PrinterList } from '../api/printers'
import type { MessageKey, Translate } from '../i18n'
import {
  DeviceError,
  deviceDefault,
  devicePrinters,
  driverOf,
  pageCanvas,
  type DevicePage,
  type DevicePrinter,
  type DeviceProblem,
  type Fit,
} from './devices'

/** Does the label fit: what it was set to take, or else the driver's word. */
function fitOf(printer: DevicePrinter, page: DevicePage): Fit {
  switch (printer.takes) {
    case 'any':
      return 'yes'
    case 'continuous':
      return page.continuous ? 'yes' : 'no'
    case 'fixed':
      return page.continuous ? 'no' : 'yes'
    default:
      return driverOf(printer)?.fit(printer, page) ?? 'unknown'
  }
}

/** A printer of this device in the shape of a network printer. */
function asPrinter(printer: DevicePrinter, page: PageQuestion | null): Printer {
  const driver = driverOf(printer)
  return {
    name: printer.name,
    uri: `${printer.driver}:${printer.model}`,
    info: driver ? `${driver.brand} ${printer.model}` : printer.model,
    location: '',
    is_default: deviceDefault() === printer.id,
    state: '',
    state_code: 0,
    state_message: '',
    accepting: true,
    make_and_model: printer.model,
    reachable: true,
    takes: printer.takes ?? 'auto',
    fit: page && driver ? fitOf(printer, page) : '',
    device: printer,
  }
}

/** The network printers plus the ones of this device this browser can use. */
export function withDevicePrinters(list: PrinterList, page: PageQuestion | null): PrinterList {
  const usable = devicePrinters().filter((printer) => driverOf(printer)?.supported())
  for (const printer of usable) driverOf(printer)?.prepare?.()
  const taken = new Set(list.printers.map((printer) => printer.name))
  const extra = usable.filter((printer) => !taken.has(printer.name)).map((printer) => asPrinter(printer, page))
  // A default chosen on this device takes over from the network's default.
  const ownDefault = extra.some((printer) => printer.is_default)
  const network = ownDefault ? list.printers.map((printer) => ({ ...printer, is_default: false })) : list.printers
  return {
    ...list,
    // Without a print service the network printers are out, these are not.
    available: list.available || extra.length > 0,
    printers: [...network, ...extra],
  }
}

/** Print on a printer of this device. The pages are the preview pictures of
 *  exactly what a network printer would get, at the printer's resolution,
 *  made crisp: without the smoothed edges meant for a screen.
 *
 *  The server never sees such a print, so the outcome is told to it after:
 *  it lands in the job history, and a completed print marks its list rows
 *  printed, as a network job does. Says whether that report got through; a
 *  print that went fine stays fine when it did not. */
export async function printOnDevice(
  printer: DevicePrinter,
  job: {
    documentId: string
    title: string
    pages: number
    pageUrl: (page: number, dpi: number) => string
    listRows?: string[]
  },
  onProgress?: (done: number, total: number) => void,
): Promise<{ recorded: boolean }> {
  const driver = driverOf(printer)
  if (!driver) throw new DeviceError('failed', `no driver for ${printer.driver}`)
  const report = async (completed: boolean, message = '') => {
    try {
      await printerApi.reportDevicePrint({
        request_id: newRequestId(),
        document_id: job.documentId,
        printer: printer.name,
        connection: driver.connection,
        completed,
        message: message.slice(0, 500),
        list_rows: job.listRows ?? [],
      })
      return true
    } catch {
      return false
    }
  }
  try {
    await driver.print(printer, {
      title: job.title,
      pages: job.pages,
      page: (index) => pageCanvas(`${job.pageUrl(index + 1, printer.dpi)}&crisp=true`),
      onProgress,
    })
  } catch (error) {
    // Closing the picker printed nothing: not worth a line in the history.
    if (!(error instanceof DeviceError && error.problem === 'cancelled')) {
      await report(false, problemWords(error))
    }
    throw error
  }
  return { recorded: await report(true) }
}

/** What went wrong, for the history: a keyword like the ones a network
 *  printer reports ("no-paper"), with the driver's detail. */
function problemWords(error: unknown): string {
  if (error instanceof DeviceError) {
    return error.message && error.message !== error.problem ? `${error.problem}: ${error.message}` : error.problem
  }
  return error instanceof Error ? error.message : String(error)
}

const PROBLEMS: Record<DeviceProblem, MessageKey> = {
  cancelled: 'devices.problem.cancelled',
  unreachable: 'devices.problem.unreachable',
  'no-paper': 'devices.problem.noPaper',
  failed: 'devices.problem.failed',
}

/** What went wrong, in the user's language, with the driver's detail. */
export function deviceProblem(t: Translate, error: unknown): string {
  if (error instanceof DeviceError) {
    const said = t(PROBLEMS[error.problem])
    return error.message && error.message !== error.problem ? `${said} (${error.message})` : said
  }
  return t('devices.problem.failed') + ` (${error instanceof Error ? error.message : String(error)})`
}
