/** The scrolling area around the label.
 *
 *  Zooming keeps a point of the label in place on screen: the middle of the
 *  view for the zoom buttons, the spot under the pointer for Ctrl/Cmd +
 *  wheel and trackpad pinching (which browsers report as a wheel event with
 *  the Ctrl key held). Without this, every zoom step would throw the view
 *  back to the top left corner.
 */

import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Incoming, LabelPoint } from '../app/actions'

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 32

/** A point of the label (in pt) and where it should appear in the view (px). */
type Anchor = { x: number; y: number; viewX: number; viewY: number }

export function CanvasViewport({
  zoom,
  onZoom,
  resetKey,
  onDropped,
  children,
}: {
  zoom: number
  onZoom: (zoom: number) => void
  /** Files or text dropped on the label, and where. */
  onDropped?: (incoming: Incoming, at: LabelPoint) => void
  /** Changes when another document is opened: start again in the middle. */
  resetKey: string
  children: ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const anchor = useRef<Anchor | null>(null)
  const zoomRef = useRef(zoom)

  /** Where the label starts inside the scrolled content, in px. */
  const origin = () => {
    const el = scrollRef.current
    const svg = el?.querySelector<SVGSVGElement>('svg.label-canvas')
    if (!el || !svg) return null
    const view = el.getBoundingClientRect()
    const label = svg.getBoundingClientRect()
    return { el, left: label.left - view.left + el.scrollLeft, top: label.top - view.top + el.scrollTop }
  }

  /** The label point now at the given place in the view. */
  const anchorAt = (viewX: number, viewY: number): Anchor | null => {
    const at = origin()
    if (!at) return null
    const current = zoomRef.current
    return {
      x: (at.el.scrollLeft + viewX - at.left) / current,
      y: (at.el.scrollTop + viewY - at.top) / current,
      viewX,
      viewY,
    }
  }

  // After a zoom step, scroll so the anchored point is back where it was.
  useLayoutEffect(() => {
    const at = origin()
    const point = anchor.current
    zoomRef.current = zoom
    if (!at || !point) return
    at.el.scrollLeft = at.left + point.x * zoom - point.viewX
    at.el.scrollTop = at.top + point.y * zoom - point.viewY
    // The next zoom button press works from the middle again.
    anchor.current = null
  }, [zoom])

  // Another document: forget the old point, so the next zoom uses the middle.
  useEffect(() => {
    anchor.current = null
  }, [resetKey])

  // Remember the middle of the view as the user scrolls, for the zoom buttons.
  const onScroll = () => {
    const el = scrollRef.current
    if (el) anchor.current = anchorAt(el.clientWidth / 2, el.clientHeight / 2)
  }

  // Ctrl/Cmd + wheel and pinch zoom around the pointer. This needs a
  // listener that may cancel the event, which React's onWheel cannot be.
  const onZoomRef = useRef(onZoom)
  onZoomRef.current = onZoom
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      anchor.current = anchorAt(event.clientX - rect.left, event.clientY - rect.top)
      const factor = Math.exp(-event.deltaY * 0.01)
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current * factor))
      if (next !== zoomRef.current) onZoomRef.current(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // The zoom buttons zoom around the middle of what is visible now.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && !anchor.current) anchor.current = anchorAt(el.clientWidth / 2, el.clientHeight / 2)
  })

  // Dropping files or text on the label puts them where they land.
  const [dropping, setDropping] = useState(false)
  const accepts = (event: DragEvent) =>
    Boolean(onDropped) && ['Files', 'text/plain'].some((type) => event.dataTransfer.types.includes(type))

  const onDragOver = (event: DragEvent) => {
    if (!accepts(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDropping(true)
  }

  const onDrop = (event: DragEvent) => {
    setDropping(false)
    if (!accepts(event)) return
    event.preventDefault()
    const at = origin()
    if (!at || !onDropped) return
    const view = at.el.getBoundingClientRect()
    onDropped(
      { files: Array.from(event.dataTransfer.files), text: event.dataTransfer.getData('text/plain') },
      {
        x: (event.clientX - view.left + at.el.scrollLeft - at.left) / zoomRef.current,
        y: (event.clientY - view.top + at.el.scrollTop - at.top) / zoomRef.current,
      },
    )
  }

  // A file dropped beside the label must not make the browser open it and
  // leave the editor.
  useEffect(() => {
    const keep = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    window.addEventListener('dragover', keep)
    window.addEventListener('drop', keep)
    return () => {
      window.removeEventListener('dragover', keep)
      window.removeEventListener('drop', keep)
    }
  }, [])

  return (
    <div
      className={dropping ? 'canvas-scroll dropping' : 'canvas-scroll'}
      ref={scrollRef}
      onScroll={onScroll}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={onDrop}
    >
      {children}
    </div>
  )
}
