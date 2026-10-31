/** Printers attached to this device: a label printer next to the phone, on
 *  Bluetooth or USB, that only this browser can reach.
 *
 *  The server knows the network printers; these live in the browser, so a
 *  printer only shows up where it works. Talking to one is up to a driver: a
 *  plugin that registers itself with `registerDriver`. The rest of the
 *  application knows drivers only through this file. The server renders the
 *  label as for any printer; the driver gets it as pictures at the
 *  printer's resolution and sends them.
 */

/** A printer attached to this device, as kept in this browser. */
export type DevicePrinter = {
  id: string
  /** The driver that talks to it, by its `id`. */
  driver: string
  name: string
  /** Model and other facts the driver learned when it was added. */
  model: string
  /** Dots per inch: the pictures it gets are made at this resolution. */
  dpi: number
  /** Whatever else the driver needs to find and use it again. */
  details: Record<string, string | number | boolean>
}

/** A label to judge a printer by, like `PageQuestion` for the server. */
export type DevicePage = { widthPt: number; heightPt: number; continuous: boolean }

export type Fit = 'yes' | 'maybe' | 'no' | 'unknown'

/** What to print: the pages of the label, each as a picture at the
 *  printer's resolution, white where nothing is printed. */
export type DeviceJob = {
  title: string
  pages: number
  page: (index: number) => Promise<HTMLCanvasElement>
  onProgress?: (done: number, total: number) => void
}

export interface DeviceDriver {
  id: string
  /** Its name in the interface, such as "Bluetooth (NIIMBOT)": made of
   *  names, so it needs no translation. */
  title: string
  /** Can this browser use it at all (Bluetooth, USB)? */
  supported(): boolean
  /** Get ready to be used soon, for instance by loading its code: the
   *  browser allows a device picker only shortly after a click. */
  prepare?(): void
  /** Find a printer and learn what it is. Called from a click: browsers
   *  only show their device picker in answer to the user. */
  discover(): Promise<Omit<DevicePrinter, 'id' | 'name'> & { name: string }>
  /** Does a label of this size fit the printer? */
  fit(printer: DevicePrinter, page: DevicePage): Fit
  /** Print. Called from a click, so the driver may ask for the device again. */
  print(printer: DevicePrinter, job: DeviceJob): Promise<void>
}

/** What went wrong, for the interface to say in the user's language. The
 *  detail is the driver's own words, shown after it. */
export type DeviceProblem =
  | 'cancelled' // the user closed the device picker
  | 'unreachable' // the printer is off, out of range or in use elsewhere
  | 'no-paper' // no labels loaded, or the lid is open
  | 'failed' // anything else

export class DeviceError extends Error {
  readonly problem: DeviceProblem
  constructor(problem: DeviceProblem, detail = '') {
    super(detail || problem)
    this.problem = problem
  }
}

/** Drivers register themselves; the heavy part they may load when used. */
const registry = new Map<string, DeviceDriver>()

export function registerDriver(driver: DeviceDriver) {
  registry.set(driver.id, driver)
}

export function deviceDrivers(): DeviceDriver[] {
  return [...registry.values()]
}

export function driverOf(printer: DevicePrinter): DeviceDriver | undefined {
  return registry.get(printer.driver)
}

const STORE_KEY = 'glabels-web.device-printers'

/** The printers of this device whose driver is present. */
export function devicePrinters(): DevicePrinter[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? '[]') as DevicePrinter[]
    return Array.isArray(stored) ? stored.filter((printer) => registry.has(printer.driver)) : []
  } catch {
    return []
  }
}

function storeAll(printers: DevicePrinter[]) {
  // Keep printers of drivers that are absent right now; they come back with the driver.
  let others: DevicePrinter[] = []
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? '[]') as DevicePrinter[]
    others = Array.isArray(stored) ? stored.filter((printer) => !registry.has(printer.driver)) : []
  } catch {
    // start afresh
  }
  window.localStorage.setItem(STORE_KEY, JSON.stringify([...others, ...printers]))
}

export function addDevicePrinter(printer: Omit<DevicePrinter, 'id'>): DevicePrinter {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const added = { ...printer, id }
  storeAll([...devicePrinters(), added])
  return added
}

export function removeDevicePrinter(id: string) {
  storeAll(devicePrinters().filter((printer) => printer.id !== id))
}

/** A name not yet in use, among the network printers and these. */
export function freeName(wanted: string, taken: string[]): string {
  const names = new Set([...taken, ...devicePrinters().map((printer) => printer.name)])
  if (!names.has(wanted)) return wanted
  for (let number = 2; ; number += 1) {
    const candidate = `${wanted} (${number})`
    if (!names.has(candidate)) return candidate
  }
}

/** Load a picture of a page and put it on a canvas. */
export async function pageCanvas(url: string): Promise<HTMLCanvasElement> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const bitmap = await createImageBitmap(await response.blob())
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas
}
