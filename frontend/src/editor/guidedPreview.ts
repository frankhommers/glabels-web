/** The guides of the product drawn over a preview picture: where the text
 *  goes, a fold, a tail. The picture shows what gets printed; the guides
 *  show where that lands on the label. They are drawn on a copy, so the
 *  picture can be turned or scaled like any other. */

import { useEffect, useState } from 'react'
import type { Markup } from '../api/types'

export type PreviewGuides = {
  markups: Markup[]
  labelWidthPt: number
  labelHeightPt: number
  /** The page in the picture, and where its labels are on it. */
  pageWidthPt: number
  pageHeightPt: number
  cells: { x: number; y: number }[]
}

function trace(context: CanvasRenderingContext2D, markup: Markup, width: number, height: number) {
  const v = markup.values
  context.beginPath()
  switch (markup.type) {
    case 'margin': {
      const x = v.x_size ?? v.size ?? 0
      const y = v.y_size ?? v.size ?? 0
      context.rect(x, y, width - 2 * x, height - 2 * y)
      break
    }
    case 'line':
      context.moveTo(v.x1 ?? 0, v.y1 ?? 0)
      context.lineTo(v.x2 ?? 0, v.y2 ?? 0)
      break
    case 'rect':
      context.roundRect(v.x1 ?? 0, v.y1 ?? 0, v.w ?? 0, v.h ?? 0, v.r ?? 0)
      break
    case 'circle':
      context.arc(v.x0 ?? 0, v.y0 ?? 0, v.radius ?? 0, 0, 2 * Math.PI)
      break
    case 'ellipse':
      context.ellipse(
        (v.x1 ?? 0) + (v.w ?? 0) / 2,
        (v.y1 ?? 0) + (v.h ?? 0) / 2,
        (v.w ?? 0) / 2,
        (v.h ?? 0) / 2,
        0,
        0,
        2 * Math.PI,
      )
      break
  }
  context.stroke()
}

/** The picture with the guides on it; the plain picture until that is ready,
 *  or when there are no guides to draw. */
export function useGuidedSrc(src: string, guides: PreviewGuides | null): string {
  const [guided, setGuided] = useState<{ from: string; url: string } | null>(null)
  const key = guides && guides.markups.length > 0 && guides.cells.length > 0 ? JSON.stringify(guides) : ''

  useEffect(() => {
    if (!key || !src) return
    const wanted: PreviewGuides = JSON.parse(key)
    let url: string | null = null
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context || wanted.pageWidthPt <= 0) return
      context.drawImage(image, 0, 0)
      const scale = canvas.width / wanted.pageWidthPt
      // A thin dashed line of about one screen pixel, whatever the resolution.
      context.lineWidth = 1 / scale
      context.setLineDash([4 / scale, 3 / scale])
      context.strokeStyle = 'rgba(42, 96, 153, 0.75)'
      for (const cell of wanted.cells) {
        context.save()
        context.scale(scale, scale)
        context.translate(cell.x, cell.y)
        for (const markup of wanted.markups) trace(context, markup, wanted.labelWidthPt, wanted.labelHeightPt)
        context.restore()
      }
      canvas.toBlob((blob) => {
        if (!blob || cancelled) return
        url = URL.createObjectURL(blob)
        setGuided({ from: src, url })
      })
    }
    image.src = src
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [src, key])

  return key && guided?.from === src ? guided.url : src
}
