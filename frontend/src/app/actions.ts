/** Operations on the objects of the open project.
 *
 *  The same actions as the Objects/Edit menus of the desktop app, in one
 *  place so the menu, toolbar and shortcuts do exactly the same thing.
 */

import { api } from '../api/client'
import type { DocumentObject, TextObject } from '../api/types'
import type { Session } from './session'
import { labelSize } from '../editor/label'
import { createObject } from '../editor/objects'
import { isPictureFile, isSvgText, preparePicture, PictureError } from '../editor/pictures'
import { lineMetrics, measureLine, pixelSize, TEXT_MARGIN_PT } from '../editor/textLayout'

let counter = 0

/** What arrives from the clipboard or a drop. */
export type Incoming = { files: File[]; text: string }

/** A point on the label, in pt. */
export type LabelPoint = { x: number; y: number }

/** The text put on the system clipboard at the last copy of objects. If the
 *  clipboard still holds exactly that, pasting gives those objects back. */
let copiedText: string | null = null

function textOf(objects: DocumentObject[]): string {
  return objects
    .filter((object): object is TextObject => object.type === 'text')
    .map((object) => object.lines.join('\n'))
    .join('\n')
}

function freshId(): string {
  counter += 1
  return `new-${Date.now().toString(36)}-${counter}`
}

function editable(session: Session): DocumentObject[] {
  return session.objects.filter(
    (object) => object.id && session.selection.includes(object.id) && object.type !== 'unsupported',
  )
}

export function createActions(session: Session) {
  const { objects, selection } = session

  const selectAll = () =>
    session.setSelection(objects.map((object) => object.id).filter((id): id is string => Boolean(id)))

  /** Keep the objects, and put their text on the system clipboard: other
   *  programs get the text, and a paste here recognises it. */
  const keep = (chosen: DocumentObject[]) => {
    session.setClipboard(chosen.map((object) => ({ ...object })))
    copiedText = textOf(chosen)
    void navigator.clipboard?.writeText(copiedText).catch(() => undefined)
  }

  const copy = () => {
    const chosen = editable(session)
    if (chosen.length > 0) {
      keep(chosen)
      session.setStatus('status.copied', { count: chosen.length })
    }
  }

  const remove = () => {
    const chosen = editable(session)
    if (chosen.length === 0) return
    session.commit(objects.filter((object) => !chosen.includes(object)))
    session.setSelection([])
  }

  const cut = () => {
    const chosen = editable(session)
    if (chosen.length === 0) return
    keep(chosen)
    remove()
    session.setStatus('status.cut', { count: chosen.length })
  }

  const paste = () => {
    if (session.clipboard.length === 0) return
    const copies = session.clipboard.map((object) => ({
      ...object,
      id: freshId(),
      x_pt: object.x_pt + 9,
      y_pt: object.y_pt + 9,
    }))
    session.commit([...objects, ...copies])
    session.setSelection(copies.map((object) => object.id as string))
  }

  /** Where a new object of this size goes: centred on the point, or on the
   *  label, and inside the label as far as it fits. */
  const place = (w: number, h: number, at?: LabelPoint) => {
    const label = session.detail ? labelSize(session.detail) : { w: w, h: h }
    const cx = at?.x ?? label.w / 2
    const cy = at?.y ?? label.h / 2
    const x = Math.min(Math.max(cx - w / 2, 0), Math.max(label.w - w, 0))
    const y = Math.min(Math.max(cy - h / 2, 0), Math.max(label.h - h, 0))
    return { x, y }
  }

  /** Embed a picture and put it on the label, as large as fits. */
  const insertPicture = async (blob: Blob, filename: string, at?: LabelPoint) => {
    const detail = session.detail
    if (!detail) return
    session.setStatus('status.addingPicture')
    try {
      const picture = await preparePicture(blob, filename)
      // Pending edits first, so they do not race the new revision.
      await session.flush()
      const embedded = await api.addImage(detail.id, picture.blob, picture.filename)
      const label = labelSize(detail)
      // One pixel is one point, as in gLabels; smaller when it does not fit.
      const scale = Math.min(1, (label.w * 0.9) / picture.width, (label.h * 0.9) / picture.height)
      const w = picture.width * scale
      const h = picture.height * scale
      const { x, y } = place(w, h, at)
      session.addObjects([
        {
          id: freshId(),
          type: 'image',
          x_pt: x,
          y_pt: y,
          w_pt: w,
          h_pt: h,
          lock_aspect_ratio: true,
          affine: [1, 0, 0, 1, 0, 0],
          shadow: { enabled: false, x_pt: 1.3, y_pt: 1.3, opacity: 0.5, color: { color: '#000000ff' } },
          src: embedded.name,
          src_field: null,
          embedded: true,
        },
      ])
      session.setStatus('status.pictureAdded')
    } catch (error) {
      session.setStatus('common.ready')
      session.setError(
        error instanceof PictureError
          ? session.t('error.pictureUnreadable', { name: filename })
          : String(error instanceof Error ? error.message : error),
      )
    }
  }

  /** A text object with this text, sized to it. */
  const insertText = (text: string, at?: LabelPoint) => {
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
    const created = createObject('text', 0, 0, '') as TextObject
    const size = pixelSize(created.font_size)
    const widest = Math.max(
      ...lines.map((line) => measureLine(created.font_family, false, false, created.font_size, line)),
    )
    const label = session.detail ? labelSize(session.detail) : { w: 144, h: 36 }
    const { lineSpacing, ascent, descent } = lineMetrics(created.font_family, false, false, size)
    const w = Math.min(Math.ceil(widest) + 2 * TEXT_MARGIN_PT + 1, label.w)
    const h = (lines.length - 1) * lineSpacing + ascent + descent + 2 * TEXT_MARGIN_PT
    const { x, y } = place(w, h, at)
    session.addObjects([{ ...created, id: freshId(), lines, x_pt: x, y_pt: y, w_pt: w, h_pt: h }])
  }

  /** Paste or drop: the objects copied here, a picture, an SVG drawing, or text. */
  const receive = async (incoming: Incoming, at?: LabelPoint) => {
    const pictures = incoming.files.filter(isPictureFile)
    if (pictures.length > 0) {
      for (const [index, file] of pictures.entries()) {
        const offset = at ? { x: at.x + index * 9, y: at.y + index * 9 } : undefined
        await insertPicture(file, file.name || 'picture.png', offset)
      }
      return
    }
    const text = incoming.text
    if (session.clipboard.length > 0 && copiedText !== null && text === copiedText) {
      paste()
      return
    }
    if (isSvgText(text)) {
      await insertPicture(new Blob([text], { type: 'image/svg+xml' }), 'drawing.svg', at)
      return
    }
    if (text.trim()) {
      insertText(text, at)
      return
    }
    paste()
  }

  /** Pick picture files from the computer, as with Objects ▸ Create image. */
  const choosePicture = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*,.svg'
    input.multiple = true
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      if (files.length > 0) void receive({ files, text: '' })
    }
    input.click()
  }

  /** Paste from the menu: read the system clipboard, if the browser lets us. */
  const pasteFromSystem = async () => {
    try {
      const items = await navigator.clipboard.read()
      const files: File[] = []
      let text = ''
      for (const item of items) {
        const picture = item.types.find((type) => type.startsWith('image/'))
        if (picture) {
          const blob = await item.getType(picture)
          files.push(new File([blob], `picture.${picture.split('/')[1].replace('svg+xml', 'svg')}`, { type: picture }))
        } else if (item.types.includes('text/plain')) {
          text = await (await item.getType('text/plain')).text()
        }
      }
      await receive({ files, text })
    } catch {
      // Not allowed or not supported: what was copied here is still there.
      paste()
    }
  }

  const duplicate = () => {
    const chosen = editable(session)
    if (chosen.length === 0) return
    const copies = chosen.map((object) => ({
      ...object,
      id: freshId(),
      x_pt: object.x_pt + 9,
      y_pt: object.y_pt + 9,
    }))
    session.commit([...objects, ...copies])
    session.setSelection(copies.map((object) => object.id as string))
  }

  const raise = () => {
    const chosen = objects.filter((object) => object.id && selection.includes(object.id))
    if (chosen.length === 0) return
    session.commit([...objects.filter((object) => !chosen.includes(object)), ...chosen])
  }

  const lower = () => {
    const chosen = objects.filter((object) => object.id && selection.includes(object.id))
    if (chosen.length === 0) return
    session.commit([...chosen, ...objects.filter((object) => !chosen.includes(object))])
  }

  const nudge = (dx: number, dy: number) => {
    const chosen = editable(session)
    if (chosen.length === 0) return
    session.commit(
      objects.map((object) =>
        chosen.includes(object) ? { ...object, x_pt: object.x_pt + dx, y_pt: object.y_pt + dy } : object,
      ),
    )
  }

  const transform = (mapper: (object: DocumentObject) => DocumentObject) => {
    const chosen = editable(session)
    if (chosen.length === 0) return
    session.commit(objects.map((object) => (chosen.includes(object) ? mapper(object) : object)))
  }

  const align = (mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => {
    const chosen = editable(session)
    if (chosen.length === 0) return
    const boxes = chosen.map((object) => ({
      object,
      w: 'w_pt' in object ? object.w_pt : object.type === 'line' ? Math.abs(object.dx_pt) : 0,
      h: 'h_pt' in object ? object.h_pt : object.type === 'line' ? Math.abs(object.dy_pt) : 0,
    }))
    const left = Math.min(...boxes.map((item) => item.object.x_pt))
    const right = Math.max(...boxes.map((item) => item.object.x_pt + item.w))
    const top = Math.min(...boxes.map((item) => item.object.y_pt))
    const bottom = Math.max(...boxes.map((item) => item.object.y_pt + item.h))

    transform((object) => {
      const box = boxes.find((item) => item.object === object)
      if (!box) return object
      switch (mode) {
        case 'left':
          return { ...object, x_pt: left }
        case 'right':
          return { ...object, x_pt: right - box.w }
        case 'hcenter':
          return { ...object, x_pt: (left + right) / 2 - box.w / 2 }
        case 'top':
          return { ...object, y_pt: top }
        case 'bottom':
          return { ...object, y_pt: bottom - box.h }
        case 'vcenter':
          return { ...object, y_pt: (top + bottom) / 2 - box.h / 2 }
      }
    })
  }

  const centerOnLabel = (axis: 'horizontal' | 'vertical' | 'both') => {
    const detail = session.detail
    if (!detail) return
    transform((object) => {
      const w = 'w_pt' in object ? object.w_pt : object.type === 'line' ? object.dx_pt : 0
      const h = 'h_pt' in object ? object.h_pt : object.type === 'line' ? object.dy_pt : 0
      const next = { ...object }
      const label = labelSize(detail)
      if (axis !== 'vertical') next.x_pt = (label.w - w) / 2
      if (axis !== 'horizontal') next.y_pt = (label.h - h) / 2
      return next
    })
  }

  /** Rotate and flip through the file format's affine matrix.
   *
   *  Upstream does ``mMatrix *= m`` with QTransform, which uses row vectors:
   *  the result is A × B, including the translation row. We follow that order
   *  exactly, otherwise web and desktop drift apart.
   */
  const multiply = (a: number[], b: number[]): number[] => {
    const [a0, a1, a2, a3, a4, a5] = a
    const [b0, b1, b2, b3, b4, b5] = b
    return [
      a0 * b0 + a1 * b2,
      a0 * b1 + a1 * b3,
      a2 * b0 + a3 * b2,
      a2 * b1 + a3 * b3,
      a4 * b0 + a5 * b2 + b4,
      a4 * b1 + a5 * b3 + b5,
    ]
  }

  const rotate = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    transform((object) => ({ ...object, affine: multiply(object.affine, [cos, sin, -sin, cos, 0, 0]) }))
  }

  const flip = (axis: 'horizontal' | 'vertical') => {
    const matrix = axis === 'horizontal' ? [-1, 0, 0, 1, 0, 0] : [1, 0, 0, -1, 0, 0]
    transform((object) => ({ ...object, affine: multiply(object.affine, matrix) }))
  }

  return {
    selectAll,
    selectNone: () => session.setSelection([]),
    copy,
    cut,
    paste,
    pasteFromSystem,
    receive,
    choosePicture,
    insertPicture,
    remove,
    duplicate,
    raise,
    lower,
    nudge,
    align,
    centerOnLabel,
    rotate,
    flip,
    hasSelection: selection.length > 0,
    hasClipboard: session.clipboard.length > 0,
  }
}

export type Actions = ReturnType<typeof createActions>
