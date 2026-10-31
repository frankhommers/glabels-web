/** NIIMBOT label printers (D11, D110, B1, B21, ...) over Bluetooth.
 *
 *  A plugin: it registers a driver for printers attached to this device and
 *  is otherwise unknown to the application. The protocol comes from
 *  niimbluelib (MIT, https://github.com/MultiMote/niimbluelib), loaded only
 *  once a NIIMBOT printer is used. Remove this folder and its line in
 *  `../plugins.ts`, and NIIMBOT support is gone.
 */

import { registerDriver, type DevicePage, type DevicePrinter, type Fit } from '../devices'

const POINTS_PER_MM = 72 / 25.4
// A label may be this much wider than the print head: the head prints its
// middle, as NIIMBOT's own 12.5 mm and 15 mm labels on a 12 mm head show.
const WIDER_THAN_HEAD_MM = 4
// The longest label we send; NIIMBOT's own catalogue stops well before this.
const MAX_LENGTH_MM = 250

const load = () => import('./driver')

/** Does a label fit, judged by the print head: across the roll it may be
 *  somewhat wider than the head, along the roll it has a limit. */
export function fit(printer: DevicePrinter, page: DevicePage): Fit {
  const headMm = Number(printer.details.headPixels) / (printer.dpi / 25.4)
  if (!headMm) return 'unknown'
  const [across, along] = [page.widthPt, page.heightPt].map((value) => value / POINTS_PER_MM).sort((a, b) => a - b)
  if (across > headMm + WIDER_THAN_HEAD_MM || along > MAX_LENGTH_MM) return 'no'
  // These printers feed labels with gaps; tape may work, but is not theirs.
  return page.continuous ? 'maybe' : 'yes'
}

registerDriver({
  id: 'niimbot',
  title: 'Bluetooth (NIIMBOT)',
  supported: () => typeof navigator !== 'undefined' && 'bluetooth' in navigator,
  prepare: () => void load(),
  discover: async () => (await load()).discover(),
  fit,
  print: async (printer, job) => (await load()).print(printer, job),
})
