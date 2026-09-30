/** Type straight onto the label.
 *
 *  A text field over the text object, in its font, size, colour, alignment
 *  and line spacing, so what you type sits where it will be printed. Enter
 *  starts a new line; clicking elsewhere or Ctrl/Cmd+Enter keeps the text,
 *  Escape leaves it as it was.
 */

import { useEffect, useRef, useState } from 'react'
import type { TextObject } from '../api/types'
import { cssColor } from './objects'
import { layoutText, lineMetrics, pixelSize, TEXT_MARGIN_PT } from './textLayout'

export function TextEditor({
  object,
  zoom,
  selectAll,
  onDone,
}: {
  object: TextObject
  zoom: number
  selectAll: boolean
  /** The new lines, or null to keep the text as it was. */
  onDone: (lines: string[] | null) => void
}) {
  const [value, setValue] = useState(object.lines.join('\n'))
  const field = useRef<HTMLTextAreaElement | null>(null)
  const finished = useRef(false)

  useEffect(() => {
    const element = field.current
    if (!element) return
    element.focus()
    if (selectAll) element.select()
    else element.setSelectionRange(element.value.length, element.value.length)
  }, [selectAll])

  const finish = (lines: string[] | null) => {
    if (finished.current) return
    finished.current = true
    onDone(lines)
  }

  const bold = object.font_weight === 'bold'
  const size = pixelSize(object.font_size)
  const { ascent, descent, lineSpacing } = lineMetrics(object.font_family, bold, object.font_italic, size)
  const dy = lineSpacing * object.line_spacing
  // Where the first line starts, laid out as it will be printed; a text
  // field puts half the extra line height above the letters, so take that off.
  const layout = layoutText({ ...object, lines: value.split('\n') })
  const firstTop = (layout.lines[0]?.y ?? TEXT_MARGIN_PT + ascent) - ascent
  const halfLeading = (dy - ascent - descent) / 2
  const [a0, a1, a2, a3, a4, a5] = object.affine

  return (
    <textarea
      ref={field}
      className="text-on-label"
      value={value}
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value.split('\n'))}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          finish(null)
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          finish(value.split('\n'))
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        left: (object.x_pt + a4) * zoom,
        top: (object.y_pt + a5) * zoom,
        width: object.w_pt * zoom,
        height: object.h_pt * zoom,
        transform: `matrix(${a0}, ${a1}, ${a2}, ${a3}, 0, 0)`,
        paddingTop: Math.max(0, (firstTop - halfLeading) * zoom),
        paddingLeft: TEXT_MARGIN_PT * zoom,
        paddingRight: TEXT_MARGIN_PT * zoom,
        paddingBottom: 0,
        fontFamily: `${JSON.stringify(object.font_family)}, "DejaVu Sans", sans-serif`,
        fontSize: size * zoom,
        fontWeight: object.font_weight,
        fontStyle: object.font_italic ? 'italic' : 'normal',
        textDecoration: object.font_underline ? 'underline' : 'none',
        lineHeight: `${dy * zoom}px`,
        color: cssColor(object.color),
        textAlign: object.align,
        whiteSpace: object.wrap === 'none' ? 'pre' : 'pre-wrap',
        wordBreak: object.wrap === 'anywhere' ? 'break-all' : 'normal',
      }}
    />
  )
}
