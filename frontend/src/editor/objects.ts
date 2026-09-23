import type { DocumentObject } from '../api/types'

const noShadow = () => ({
  enabled: false,
  x_pt: 1.3,
  y_pt: 1.3,
  opacity: 0.5,
  color: { color: '#000000ff' },
})

const base = (x: number, y: number) => ({
  x_pt: x,
  y_pt: y,
  affine: [1, 0, 0, 1, 0, 0],
  shadow: noShadow(),
})

export function createObject(
  type: Exclude<DocumentObject['type'], 'unsupported' | 'image'>,
  x: number,
  y: number,
  /** First line of a new text object, in the user's language. */
  defaultText = 'Text',
): DocumentObject {
  switch (type) {
    case 'text':
      return {
        ...base(x, y),
        type: 'text',
        w_pt: 144,
        h_pt: 36,
        lock_aspect_ratio: false,
        lines: [defaultText],
        font_family: 'Liberation Sans',
        font_size: 12,
        font_weight: 'normal',
        font_italic: false,
        font_underline: false,
        color: { color: '#000000ff' },
        line_spacing: 1,
        align: 'left',
        valign: 'top',
        wrap: 'word',
        auto_shrink: false,
      }
    case 'box':
    case 'ellipse':
      return {
        ...base(x, y),
        type,
        w_pt: 72,
        h_pt: 48,
        lock_aspect_ratio: false,
        line_width_pt: 1,
        line_color: { color: '#000000ff' },
        fill_color: { color: '#00000000' },
      }
    case 'line':
      return {
        ...base(x, y),
        type: 'line',
        dx_pt: 72,
        dy_pt: 0,
        line_width_pt: 1,
        line_color: { color: '#000000ff' },
      }
    case 'barcode':
      return {
        ...base(x, y),
        type: 'barcode',
        w_pt: 144,
        h_pt: 54,
        lock_aspect_ratio: false,
        // Zint is available in our image and covers Code 128 and QR.
        backend: 'zint',
        style: 'code128',
        show_text: true,
        checksum: true,
        data: '1234567890',
        color: { color: '#000000ff' },
      }
  }
}

export function isSized(
  object: DocumentObject,
): object is Extract<DocumentObject, { w_pt: number }> {
  return 'w_pt' in object
}

/** Bounding box in label coordinates, ignoring the affine matrix. */
export function boundsOf(object: DocumentObject) {
  if (object.type === 'line') {
    const x = Math.min(object.x_pt, object.x_pt + object.dx_pt)
    const y = Math.min(object.y_pt, object.y_pt + object.dy_pt)
    return { x, y, w: Math.abs(object.dx_pt), h: Math.abs(object.dy_pt) }
  }
  if (isSized(object)) {
    return { x: object.x_pt, y: object.y_pt, w: object.w_pt, h: object.h_pt }
  }
  return { x: object.x_pt, y: object.y_pt, w: 0, h: 0 }
}

export function cssColor(spec: { color?: string | null; field?: string | null } | undefined): string {
  if (!spec) return 'none'
  // A field reference only gets a value when printing; in the editor we show
  // a neutral fill, like the desktop app.
  if (spec.field) return '#c0c0c080'
  return spec.color ?? 'none'
}

export function isTransparent(spec: { color?: string | null; field?: string | null } | undefined): boolean {
  if (!spec || spec.field) return false
  const value = spec.color
  if (!value) return true
  return value.length === 9 && value.slice(7) === '00'
}
