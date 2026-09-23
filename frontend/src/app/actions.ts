/** Operations on the objects of the open project.
 *
 *  The same actions as the Objects/Edit menus of the desktop app, in one
 *  place so the menu, toolbar and shortcuts do exactly the same thing.
 */

import type { DocumentObject } from '../api/types'
import type { Session } from './session'
import { labelSize } from '../editor/label'

let counter = 0

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

  const copy = () => {
    const chosen = editable(session)
    if (chosen.length > 0) {
      session.setClipboard(chosen.map((object) => ({ ...object })))
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
    session.setClipboard(chosen.map((object) => ({ ...object })))
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
