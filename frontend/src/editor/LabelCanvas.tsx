import { useCallback, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { DocumentDetail, DocumentObject } from '../api/types'
import { useT } from '../i18n'
import { labelSize } from './label'
import { boundsOf, cssColor, isSized } from './objects'
import { layoutText, useFontsVersion } from './textLayout'

type Drag =
  | { kind: 'move'; startX: number; startY: number; origin: DocumentObject[] }
  | { kind: 'resize'; handle: Handle; startX: number; startY: number; origin: DocumentObject[] }
  | { kind: 'marquee'; startX: number; startY: number; x: number; y: number }

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const HANDLES: { id: Handle; fx: number; fy: number; cursor: string }[] = [
  { id: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { id: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { id: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { id: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { id: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { id: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { id: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { id: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' },
]

export type CanvasProps = {
  document: DocumentDetail
  objects: DocumentObject[]
  selection: string[]
  zoom: number
  showGrid: boolean
  showMarkup: boolean
  snap: boolean
  gridPt: number
  onSelectionChange: (ids: string[]) => void
  onObjectsPreview: (objects: DocumentObject[]) => void
  onObjectsCommit: (objects: DocumentObject[]) => void
}

function transformOf(object: DocumentObject): string {
  const [a0, a1, a2, a3, a4, a5] = object.affine
  const matrix = `matrix(${a0} ${a1} ${a2} ${a3} ${a4} ${a5})`
  return `translate(${object.x_pt} ${object.y_pt}) ${matrix}`
}

function LabelOutline({ document: doc }: { document: DocumentDetail }) {
  const { label_width_pt: w, label_height_pt: h, label_shape: shape } = doc
  const style = { fill: '#ffffff', stroke: '#8a8a8a', strokeWidth: 0.5, vectorEffect: 'non-scaling-stroke' as const }

  if (shape === 'ellipse') return <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...style} />
  if (shape === 'round' || shape === 'cd') {
    const r = doc.label_radius_pt ?? Math.min(w, h) / 2
    return (
      <>
        <circle cx={w / 2} cy={h / 2} r={r} {...style} />
        {doc.label_hole_pt ? (
          <circle cx={w / 2} cy={h / 2} r={doc.label_hole_pt} fill="#e8e8e8" stroke="#8a8a8a" strokeWidth={0.5} />
        ) : null}
      </>
    )
  }
  return <rect x={0} y={0} width={w} height={h} rx={doc.label_round_pt || 0} ry={doc.label_round_pt || 0} {...style} />
}

function ObjectShape({ object, docId }: { object: DocumentObject; docId: string }) {
  const t = useT()
  // Text is measured with the label's fonts; measure again once they are in.
  useFontsVersion()
  switch (object.type) {
    case 'box':
      return (
        <rect
          width={object.w_pt}
          height={object.h_pt}
          fill={cssColor(object.fill_color)}
          stroke={cssColor(object.line_color)}
          strokeWidth={object.line_width_pt}
        />
      )
    case 'ellipse':
      return (
        <ellipse
          cx={object.w_pt / 2}
          cy={object.h_pt / 2}
          rx={Math.max(0, object.w_pt / 2 - object.line_width_pt / 2)}
          ry={Math.max(0, object.h_pt / 2 - object.line_width_pt / 2)}
          fill={cssColor(object.fill_color)}
          stroke={cssColor(object.line_color)}
          strokeWidth={object.line_width_pt}
        />
      )
    case 'line':
      return (
        <line
          x1={0}
          y1={0}
          x2={object.dx_pt}
          y2={object.dy_pt}
          stroke={cssColor(object.line_color)}
          strokeWidth={object.line_width_pt}
        />
      )
    case 'text': {
      const layout = layoutText(object)
      const clipId = `clip-${object.id ?? 'text'}`
      return (
        <g clipPath={`url(#${clipId})`}>
          <clipPath id={clipId}>
            <rect width={object.w_pt} height={object.h_pt} />
          </clipPath>
          <text
            fill={cssColor(object.color)}
            fontFamily={`${JSON.stringify(object.font_family)}, "DejaVu Sans", sans-serif`}
            fontSize={layout.fontSize}
            fontWeight={object.font_weight}
            fontStyle={object.font_italic ? 'italic' : 'normal'}
            textDecoration={object.font_underline ? 'underline' : 'none'}
            xmlSpace="preserve"
          >
            {layout.lines.map((line, index) => (
              <tspan key={index} x={line.x} y={line.y}>
                {line.text}
              </tspan>
            ))}
          </text>
        </g>
      )
    }
    case 'barcode':
      return (
        <g>
          <rect width={object.w_pt} height={object.h_pt} fill="#f4f4f4" stroke="#9a9a9a" strokeDasharray="3 2" strokeWidth={0.5} />
          {Array.from({ length: 28 }, (_, index) => (
            <rect
              key={index}
              x={4 + index * ((object.w_pt - 8) / 28)}
              y={4}
              width={((object.w_pt - 8) / 28) * (index % 3 === 0 ? 0.7 : 0.35)}
              height={object.h_pt - (object.show_text ? 14 : 8)}
              fill={cssColor(object.color)}
            />
          ))}
          {object.show_text ? (
            <text x={object.w_pt / 2} y={object.h_pt - 3} textAnchor="middle" fontSize={7} fill="#333">
              {object.data}
            </text>
          ) : null}
        </g>
      )
    case 'image':
      // An embedded image is drawn stretched over its frame, as gLabels does.
      // One taken from a merge field differs per record: a placeholder.
      if (object.embedded && object.src && !object.src_field) {
        return (
          <image
            href={api.embeddedFileUrl(docId, object.src)}
            width={object.w_pt}
            height={object.h_pt}
            preserveAspectRatio="none"
          />
        )
      }
      return (
        <g>
          <rect width={object.w_pt} height={object.h_pt} fill="#f0f4f8" stroke="#9a9a9a" strokeDasharray="3 2" strokeWidth={0.5} />
          <text x={object.w_pt / 2} y={object.h_pt / 2} textAnchor="middle" fontSize={8} fill="#556">
            {object.src ?? object.src_field ?? t('object.image')}
          </text>
        </g>
      )
    case 'unsupported':
      return (
        <g>
          <rect width={40} height={20} fill="#fde8e8" stroke="#c44" strokeDasharray="2 2" strokeWidth={0.5} />
          <text x={20} y={13} textAnchor="middle" fontSize={7} fill="#a33">
            {object.tag}
          </text>
        </g>
      )
  }
}

export function LabelCanvas(props: CanvasProps) {
  const { document: doc, objects, selection, zoom, showGrid, showMarkup, snap, gridPt } = props
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  const { w: width, h: height } = labelSize(doc)
  // The label itself (shape and markup) lies in the direction of the product
  // definition; when rotated we draw it a quarter turn, like upstream.
  const frameTransform = doc.content.rotate
    ? `rotate(-90) translate(${-doc.label_width_pt} 0)`
    : undefined

  const selected = useMemo(
    () => objects.filter((object) => object.id && selection.includes(object.id)),
    [objects, selection],
  )

  const selectionBounds = useMemo(() => {
    if (selected.length === 0) return null
    const boxes = selected.map(boundsOf)
    const x = Math.min(...boxes.map((b) => b.x))
    const y = Math.min(...boxes.map((b) => b.y))
    const right = Math.max(...boxes.map((b) => b.x + b.w))
    const bottom = Math.max(...boxes.map((b) => b.y + b.h))
    return { x, y, w: right - x, h: bottom - y }
  }, [selected])

  const pointAt = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom }
    },
    [zoom],
  )

  const snapValue = useCallback(
    (value: number) => (snap ? Math.round(value / gridPt) * gridPt : value),
    [snap, gridPt],
  )

  const startMove = (event: React.PointerEvent, object: DocumentObject) => {
    event.stopPropagation()
    const point = pointAt(event)
    const ids = object.id
      ? event.shiftKey
        ? selection.includes(object.id)
          ? selection.filter((id) => id !== object.id)
          : [...selection, object.id]
        : selection.includes(object.id)
          ? selection
          : [object.id]
      : selection
    props.onSelectionChange(ids)
    if (object.type === 'unsupported') return
    setDrag({ kind: 'move', startX: point.x, startY: point.y, origin: objects })
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
  }

  const startResize = (event: React.PointerEvent, handle: Handle) => {
    event.stopPropagation()
    const point = pointAt(event)
    setDrag({ kind: 'resize', handle, startX: point.x, startY: point.y, origin: objects })
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag) return
    const point = pointAt(event)

    if (drag.kind === 'marquee') {
      setDrag({ ...drag, x: point.x, y: point.y })
      return
    }

    const dx = point.x - drag.startX
    const dy = point.y - drag.startY

    if (drag.kind === 'move') {
      props.onObjectsPreview(
        drag.origin.map((object) => {
          if (!object.id || !selection.includes(object.id) || object.type === 'unsupported') return object
          return { ...object, x_pt: snapValue(object.x_pt + dx), y_pt: snapValue(object.y_pt + dy) }
        }),
      )
      return
    }

    const handle = drag.handle
    props.onObjectsPreview(
      drag.origin.map((object) => {
        if (!object.id || !selection.includes(object.id)) return object
        if (object.type === 'line') {
          if (handle === 'se' || handle === 'e' || handle === 's') {
            return { ...object, dx_pt: object.dx_pt + dx, dy_pt: object.dy_pt + dy }
          }
          return object
        }
        if (!isSized(object)) return object

        let { x_pt, y_pt, w_pt, h_pt } = object
        if (handle.includes('w')) {
          const right = x_pt + w_pt
          x_pt = snapValue(x_pt + dx)
          w_pt = right - x_pt
        }
        if (handle.includes('n')) {
          const bottom = y_pt + h_pt
          y_pt = snapValue(y_pt + dy)
          h_pt = bottom - y_pt
        }
        if (handle.includes('e')) w_pt = snapValue(w_pt + dx)
        if (handle.includes('s')) h_pt = snapValue(h_pt + dy)

        if (object.lock_aspect_ratio && object.w_pt > 0 && object.h_pt > 0) {
          const ratio = object.h_pt / object.w_pt
          h_pt = w_pt * ratio
        }
        return { ...object, x_pt, y_pt, w_pt: Math.max(1, w_pt), h_pt: Math.max(1, h_pt) }
      }),
    )
  }

  const onPointerUp = () => {
    if (!drag) return
    if (drag.kind === 'marquee') {
      const x1 = Math.min(drag.startX, drag.x)
      const y1 = Math.min(drag.startY, drag.y)
      const x2 = Math.max(drag.startX, drag.x)
      const y2 = Math.max(drag.startY, drag.y)
      const ids = objects
        .filter((object) => {
          const b = boundsOf(object)
          return b.x >= x1 && b.y >= y1 && b.x + b.w <= x2 && b.y + b.h <= y2
        })
        .map((object) => object.id)
        .filter((id): id is string => Boolean(id))
      props.onSelectionChange(ids)
    } else {
      props.onObjectsCommit(objects)
    }
    setDrag(null)
  }

  const onBackgroundDown = (event: React.PointerEvent) => {
    const point = pointAt(event)
    if (!event.shiftKey) props.onSelectionChange([])
    setDrag({ kind: 'marquee', startX: point.x, startY: point.y, x: point.x, y: point.y })
  }

  const margin = doc.markups.find((markup) => markup.type === 'margin')

  return (
    <svg
      ref={svgRef}
      className="label-canvas"
      width={width * zoom}
      height={height * zoom}
      viewBox={`0 0 ${width} ${height}`}
      onPointerDown={onBackgroundDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <g transform={frameTransform}>
        <LabelOutline document={doc} />
      </g>

      {showGrid ? (
        <g pointerEvents="none" opacity={0.5}>
          {Array.from({ length: Math.floor(width / gridPt) }, (_, index) => (
            <line key={`v${index}`} x1={(index + 1) * gridPt} y1={0} x2={(index + 1) * gridPt} y2={height} stroke="#d5dde5" strokeWidth={0.25} />
          ))}
          {Array.from({ length: Math.floor(height / gridPt) }, (_, index) => (
            <line key={`h${index}`} x1={0} y1={(index + 1) * gridPt} x2={width} y2={(index + 1) * gridPt} stroke="#d5dde5" strokeWidth={0.25} />
          ))}
        </g>
      ) : null}

      {margin && showMarkup ? (
        <rect
          transform={frameTransform}
          pointerEvents="none"
          x={margin.values.x_size ?? margin.values.size ?? 0}
          y={margin.values.y_size ?? margin.values.size ?? 0}
          width={doc.label_width_pt - 2 * (margin.values.x_size ?? margin.values.size ?? 0)}
          height={doc.label_height_pt - 2 * (margin.values.y_size ?? margin.values.size ?? 0)}
          fill="none"
          stroke="#b0bcc8"
          strokeDasharray="4 3"
          strokeWidth={0.4}
        />
      ) : null}

      {objects.map((object, index) => (
        <g
          key={object.id ?? `new-${index}`}
          transform={transformOf(object)}
          onPointerDown={(event) => startMove(event, object)}
          style={{ cursor: object.type === 'unsupported' ? 'not-allowed' : 'move' }}
        >
          <ObjectShape object={object} docId={doc.id} />
        </g>
      ))}

      {selectionBounds ? (
        <g pointerEvents="none">
          <rect
            x={selectionBounds.x}
            y={selectionBounds.y}
            width={selectionBounds.w}
            height={selectionBounds.h}
            fill="none"
            stroke="#1668c1"
            strokeDasharray="3 2"
            strokeWidth={0.6}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ) : null}

      {selectionBounds && selected.every((object) => object.type !== 'unsupported') ? (
        <g>
          {HANDLES.map((handle) => (
            <rect
              key={handle.id}
              x={selectionBounds.x + selectionBounds.w * handle.fx - 3 / zoom}
              y={selectionBounds.y + selectionBounds.h * handle.fy - 3 / zoom}
              width={6 / zoom}
              height={6 / zoom}
              fill="#ffffff"
              stroke="#1668c1"
              strokeWidth={0.5}
              style={{ cursor: handle.cursor }}
              onPointerDown={(event) => startResize(event, handle.id)}
            />
          ))}
        </g>
      ) : null}

      {drag?.kind === 'marquee' ? (
        <rect
          pointerEvents="none"
          x={Math.min(drag.startX, drag.x)}
          y={Math.min(drag.startY, drag.y)}
          width={Math.abs(drag.x - drag.startX)}
          height={Math.abs(drag.y - drag.startY)}
          fill="#1668c11a"
          stroke="#1668c1"
          strokeWidth={0.4}
        />
      ) : null}
    </svg>
  )
}
