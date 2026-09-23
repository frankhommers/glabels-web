/** Physical measurements. Internally, like the file format, everything is in points. */

export const PT_PER_UNIT = {
  pt: 1,
  in: 72,
  mm: 72 / 25.4,
  cm: 72 / 2.54,
  pc: 12,
} as const

export type UnitId = keyof typeof PT_PER_UNIT

/** The units in the order they are offered. Their names live in the
 *  translation catalogues under `unit.<id>`. */
export const UNIT_IDS: UnitId[] = ['mm', 'cm', 'in', 'pt', 'pc']

export function fromPt(points: number, unit: UnitId): number {
  return points / PT_PER_UNIT[unit]
}

export function toPt(value: number, unit: UnitId): number {
  return value * PT_PER_UNIT[unit]
}

export function formatLength(points: number, unit: UnitId): string {
  const value = fromPt(points, unit)
  const decimals = unit === 'pt' || unit === 'pc' ? 1 : 2
  return value.toFixed(decimals)
}
