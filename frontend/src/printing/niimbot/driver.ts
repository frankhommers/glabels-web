/** The part of the NIIMBOT plugin that talks to the printer; loaded when a
 *  NIIMBOT printer is added or used. */

import {
  ImageEncoder,
  LabelType,
  modelsLibrary,
  NiimbotBluetoothClient,
  PageColorType,
  type PrintTaskName,
} from '@mmote/niimbluelib'
import { DeviceError, type DeviceJob, type DevicePrinter } from '../devices'

// One connection per page: within a visit, printing again needs no picker.
let client: NiimbotBluetoothClient | null = null
let device: BluetoothDevice | null = null

// What niimbluelib looks for in its own picker: a NIIMBOT model name, or
// the printer's service.
const SERVICE = 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
const NAME_PREFIXES = [...new Set(modelsLibrary.map((meta) => meta.model[0]))]

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The printer to talk to: the one picked before in this visit, one the
 *  browser still allows (where it lets a page see those), or a new pick. */
async function pickDevice(deviceId?: string): Promise<BluetoothDevice> {
  if (device && (!deviceId || device.id === deviceId)) return device
  if (deviceId && typeof navigator.bluetooth.getDevices === 'function') {
    try {
      const known = (await navigator.bluetooth.getDevices()).find((item) => item.id === deviceId)
      if (known) return known
    } catch {
      // Not allowed here; the picker will do.
    }
  }
  try {
    return await navigator.bluetooth.requestDevice({
      filters: [...NAME_PREFIXES.map((namePrefix) => ({ namePrefix })), { services: [SERVICE] }],
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') throw new DeviceError('cancelled')
    throw new DeviceError('failed', describe(error))
  }
}

type Connection = { client: NiimbotBluetoothClient; device: BluetoothDevice }

async function connect(deviceId?: string): Promise<Connection> {
  if (client && device && client.isConnected() && (!deviceId || device.id === deviceId)) return { client, device }
  await client?.disconnect().catch(() => undefined)
  const picked = await pickDevice(deviceId)
  const fresh = new NiimbotBluetoothClient()
  try {
    await fresh.connect({ authorizedDevice: picked })
  } catch (error) {
    throw new DeviceError('unreachable', describe(error))
  }
  device = picked
  client = fresh
  return { client: fresh, device: picked }
}

export async function discover(): Promise<Omit<DevicePrinter, 'id'>> {
  device = null
  const { client: connected, device: found } = await connect()
  const meta = connected.getModelMetadata()
  if (!meta) throw new DeviceError('failed', 'this NIIMBOT model is not known to niimbluelib')
  return {
    driver: 'niimbot',
    name: found.name || meta.model,
    model: meta.model,
    dpi: meta.dpi,
    details: {
      deviceId: found.id,
      headPixels: meta.printheadPixels,
      density: meta.densityDefault,
      printTask: connected.getPrintTaskType() ?? '',
    },
  }
}

/** The page as the head prints it: as wide as the head, centred on the
 *  label (a label is often a little wider), and only black and white. */
function forHead(page: HTMLCanvasElement, headPixels: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = headPixels
  canvas.height = page.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new DeviceError('failed', 'no canvas')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(page, Math.round((headPixels - page.width) / 2), 0)
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const data = image.data
  for (let index = 0; index < data.length; index += 4) {
    const light = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
    const value = light < 128 ? 0 : 255
    data[index] = data[index + 1] = data[index + 2] = value
    data[index + 3] = 255
  }
  context.putImageData(image, 0, 0)
  return canvas
}

export async function print(printer: DevicePrinter, job: DeviceJob): Promise<void> {
  const { client: connected } = await connect(String(printer.details.deviceId || '') || undefined)
  const meta = connected.getModelMetadata()
  const taskName = (connected.getPrintTaskType() ?? printer.details.printTask) as PrintTaskName | ''
  const headPixels = meta?.printheadPixels ?? Number(printer.details.headPixels)
  if (!taskName || !headPixels) throw new DeviceError('failed', 'unknown print method for this model')

  // Make every page before printing, so a slow page never stalls the printer.
  const pages: HTMLCanvasElement[] = []
  for (let index = 0; index < job.pages; index += 1) pages.push(forHead(await job.page(index), headPixels))

  connected.stopHeartbeat()
  const task = connected.protocol.newPrintTask(taskName, {
    totalPages: pages.length,
    density: Number(printer.details.density) || meta?.densityDefault || 2,
    labelType: LabelType.WithGaps,
    pageColor: PageColorType.SingleColor,
    statusPollIntervalMs: 100,
    statusTimeoutMs: 8_000,
  })
  try {
    await task.printInit()
    for (const [index, page] of pages.entries()) {
      // The picture is upright: its first row comes out first.
      await task.printPage(ImageEncoder.encodeCanvas(page, PageColorType.SingleColor, 'top'), 1)
      await task.waitForPageFinished()
      job.onProgress?.(index + 1, pages.length)
    }
    await task.waitForFinished()
  } catch (error) {
    throw new DeviceError(/paper|lid|cover|label/i.test(describe(error)) ? 'no-paper' : 'failed', describe(error))
  } finally {
    await task.printEnd().catch(() => undefined)
  }
}
