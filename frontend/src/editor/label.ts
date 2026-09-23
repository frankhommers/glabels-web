import type { DocumentDetail } from '../api/types'

/** Size of the label as the user sees it.
 *
 *  A product definition always describes the label in one direction. With
 *  `rotate` on, the label is turned a quarter: width and height swap, and all
 *  objects live in that rotated coordinate system — just like `Model::w()` and
 *  `Model::h()` upstream.
 */
export function labelSize(doc: DocumentDetail): { w: number; h: number } {
  return doc.content.rotate
    ? { w: doc.label_height_pt, h: doc.label_width_pt }
    : { w: doc.label_width_pt, h: doc.label_height_pt }
}

/** Can this label be rotated? Round and square labels cannot. */
export function canRotate(doc: DocumentDetail): boolean {
  return Math.abs(doc.label_width_pt - doc.label_height_pt) > 1e-6
}

/** Orientation as the user picks it: horizontal or vertical. */
export type Orientation = 'horizontal' | 'vertical'

export function orientationOf(doc: DocumentDetail): Orientation {
  const { w, h } = labelSize(doc)
  return w >= h ? 'horizontal' : 'vertical'
}

/** Which `rotate` goes with a chosen orientation (like PropertiesView upstream). */
export function rotateFor(doc: DocumentDetail, orientation: Orientation): boolean {
  if (!canRotate(doc)) return false
  const naturallyWide = doc.label_width_pt > doc.label_height_pt
  return naturallyWide ? orientation === 'vertical' : orientation === 'horizontal'
}
