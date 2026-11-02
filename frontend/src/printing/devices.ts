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

import type { PrinterTakes } from '../api/printers'

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
  /** What it takes, when the driver's judgement should be overruled; as
   *  for a network printer. */
  takes?: PrinterTakes
  /** How dark it prints, when set here; else the printer's own default.
   *  Within the driver's `darkness` range. */
  darkness?: number
}

/** The darkness settings a printer has: whole steps from `min` to `max`. */
export type DarknessRange = { min: number; max: number; normal: number }

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
  /** How it is reached, as the list of printers says it: "Bluetooth". */
  connection: string
  /** Whose printers it drives, shown with the model: "NIIMBOT". Names, so
   *  neither needs translating. */
  brand: string
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
  /** How dark this printer can print, when that can be set; `null` when it
   *  cannot (or is not known yet). */
  darkness?(printer: DevicePrinter): DarknessRange | null
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

export function updateDevicePrinter(id: string, change: Partial<Omit<DevicePrinter, 'id'>>) {
  storeAll(devicePrinters().map((printer) => (printer.id === id ? { ...printer, ...change } : printer)))
}

export function removeDevicePrinter(id: string) {
  storeAll(devicePrinters().filter((printer) => printer.id !== id))
  if (deviceDefault() === id) setDeviceDefault(null)
}

const DEFAULT_KEY = 'glabels-web.device-default'

/** The printer of this device that is the default here, instead of the
 *  network's default; `null` when the network's default applies. */
export function deviceDefault(): string | null {
  return window.localStorage.getItem(DEFAULT_KEY)
}

export function setDeviceDefault(id: string | null) {
  if (id) window.localStorage.setItem(DEFAULT_KEY, id)
  else window.localStorage.removeItem(DEFAULT_KEY)
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

/** Load a picture of a page and put it on a canvas. The address asks for
 *  a crisp picture: one without smoothed edges, made to be printed as it is. */
export async function pageCanvas(url: string): Promise<HTMLCanvasElement> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  // The pixels as they are: no colour correction, which could turn white
  // into almost white.
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  })
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

/** The page in black and white, for a printer that prints dots. What is
 *  already black or white stays exactly so: text and lines come crisp from
 *  the server. Only grey (a photo, a grey fill) becomes a pattern of dots,
 *  with Atkinson's dithering: it spreads just part of the error, so light
 *  areas stay clean and small details keep their contrast, which suits
 *  small thermal labels better than Floyd-Steinberg. */
export function blackAndWhite(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new DeviceError('failed', 'no canvas')
  const { width, height } = canvas
  const image = context.getImageData(0, 0, width, height)
  const data = image.data
  const light = new Float32Array(width * height)
  for (let index = 0; index < light.length; index += 1) {
    const at = index * 4
    // Transparent counts as white paper.
    const alpha = data[at + 3] / 255
    const value = 0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2]
    light[index] = value * alpha + 255 * (1 - alpha)
  }
  const spread = (x: number, y: number, error: number) => {
    if (x >= 0 && x < width && y < height) light[y * width + x] += error
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const old = light[index]
      const value = old < 128 ? 0 : 255
      const error = (old - value) / 8
      if (error !== 0) {
        spread(x + 1, y, error)
        spread(x + 2, y, error)
        spread(x - 1, y + 1, error)
        spread(x, y + 1, error)
        spread(x + 1, y + 1, error)
        spread(x, y + 2, error)
      }
      const at = index * 4
      data[at] = data[at + 1] = data[at + 2] = value
      data[at + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return canvas
}
