/** Lay out a text object the way gLabels does.
 *
 *  Follows `ModelTextObject::drawText` upstream, so text sits in the editor
 *  where it will be printed:
 *
 *  - a margin of 3 pt on every side; lines wrap at the width minus both
 *    margins, and align within that width;
 *  - the font size is rounded to whole points (upstream `pixelSize`);
 *  - the first baseline lies one ascent below the top, and lines are one
 *    line spacing apart (times the object's line spacing factor);
 *  - vertical alignment uses the height of the laid out lines.
 *
 *  Ascent and line spacing come from the font file (served with the font
 *  list), rounded like FreeType does for the renderer. Widths are measured
 *  in the browser with the same font files.
 */

import { useEffect, useState } from 'react'
import type { TextObject } from '../api/types'

export const TEXT_MARGIN_PT = 3

type Metrics = { unitsPerEm: number; ascender: number; descender: number; lineGap: number }

type FaceMetrics = Metrics & { bold: boolean; italic: boolean }

/** What the font list from the server says about a face. */
export type FaceWithMetrics = {
  family: string
  bold: boolean
  italic: boolean
  units_per_em?: number | null
  ascender?: number | null
  descender?: number | null
  line_gap?: number | null
}

const registry = new Map<string, FaceMetrics[]>()

/** Remember the metrics of the fonts the server has. */
export function registerFontMetrics(faces: FaceWithMetrics[]): void {
  registry.clear()
  for (const face of faces) {
    if (!face.units_per_em || !face.ascender || face.descender == null) continue
    const key = face.family.toLowerCase()
    const list = registry.get(key) ?? []
    list.push({
      unitsPerEm: face.units_per_em,
      ascender: face.ascender,
      descender: face.descender,
      lineGap: face.line_gap ?? 0,
      bold: face.bold,
      italic: face.italic,
    })
    registry.set(key, list)
  }
}

// A font the server does not have is replaced by the renderer's default,
// DejaVu Sans; these are its metrics.
const FALLBACK: Metrics = { unitsPerEm: 2048, ascender: 1901, descender: -483, lineGap: 0 }

function metricsFor(family: string, bold: boolean, italic: boolean): Metrics {
  const faces = registry.get(family.toLowerCase()) ?? registry.get('dejavu sans')
  if (!faces || faces.length === 0) return FALLBACK
  return (
    faces.find((face) => face.bold === bold && face.italic === italic) ??
    faces.find((face) => face.bold === bold) ??
    faces.find((face) => !face.bold && !face.italic) ??
    faces[0]
  )
}

/** Upstream rounds the size in points to whole pixels at 72 dpi. */
export function pixelSize(fontSize: number): number {
  return Math.max(1, Math.round(fontSize))
}

export type LineMetrics = { ascent: number; descent: number; lineSpacing: number }

export function lineMetrics(family: string, bold: boolean, italic: boolean, size: number): LineMetrics {
  const m = metricsFor(family, bold, italic)
  const scale = size / m.unitsPerEm
  // FreeType rounds the ascent up, the descent down, the line height to the nearest pixel.
  const ascent = Math.ceil(m.ascender * scale)
  const descent = Math.ceil(-m.descender * scale)
  const lineSpacing = Math.round((m.ascender - m.descender + m.lineGap) * scale)
  return { ascent, descent, lineSpacing: Math.max(lineSpacing, 1) }
}

let measureContext: CanvasRenderingContext2D | null = null

function cssFont(family: string, bold: boolean, italic: boolean, size: number): string {
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${JSON.stringify(family)}, "DejaVu Sans", sans-serif`
}

function measurer(font: string): (text: string) => number {
  if (!measureContext) measureContext = document.createElement('canvas').getContext('2d')
  const context = measureContext
  if (!context) return (text) => text.length * 0.5
  context.font = font
  return (text) => context.measureText(text).width
}

/** Break one paragraph into lines that fit the width, like QTextLayout. */
function wrapParagraph(
  text: string,
  width: number,
  mode: TextObject['wrap'],
  measure: (text: string) => number,
): string[] {
  if (mode === 'none' || measure(text) <= width) return [text]

  if (mode === 'anywhere') {
    const lines: string[] = []
    let line = ''
    for (const char of text) {
      if (line && measure(line + char) > width) {
        lines.push(line)
        line = char === ' ' ? '' : char
      } else {
        line += char
      }
    }
    lines.push(line)
    return lines
  }

  // Word wrap: break at spaces only; a word longer than the line overflows.
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/(?<= )/)) {
    const candidate = line + word
    if (line && measure(candidate.trimEnd()) > width) {
      lines.push(line.trimEnd())
      line = word
    } else {
      line = candidate
    }
  }
  lines.push(line.trimEnd())
  return lines
}

export type LaidOutLine = { text: string; x: number; y: number }

export type TextLayout = { lines: LaidOutLine[]; fontSize: number }

export function layoutText(object: TextObject): TextLayout {
  const bold = object.font_weight === 'bold'
  const size = pixelSize(object.font_size)
  const { ascent, descent, lineSpacing } = lineMetrics(object.font_family, bold, object.font_italic, size)
  const measure = measurer(cssFont(object.font_family, bold, object.font_italic, size))
  const width = object.w_pt - 2 * TEXT_MARGIN_PT
  const dy = lineSpacing * object.line_spacing

  const texts = (object.lines.length > 0 ? object.lines : ['']).flatMap((paragraph) =>
    wrapParagraph(paragraph, width, object.wrap, measure),
  )

  const height = (texts.length - 1) * dy + ascent + descent
  const top =
    object.valign === 'center'
      ? object.h_pt / 2 - height / 2
      : object.valign === 'bottom'
        ? object.h_pt - height - TEXT_MARGIN_PT
        : TEXT_MARGIN_PT

  const lines = texts.map((text, index) => {
    const used = measure(text)
    const x =
      object.align === 'center'
        ? TEXT_MARGIN_PT + (width - used) / 2
        : object.align === 'right'
          ? TEXT_MARGIN_PT + width - used
          : TEXT_MARGIN_PT
    return { text, x, y: top + index * dy + ascent }
  })
  return { lines, fontSize: size }
}

/** Changes whenever the browser finished loading fonts, so layouts measured
 *  with a stand-in font are done again with the real one. */
export function useFontsVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const fonts = document.fonts
    const bump = () => setVersion((value) => value + 1)
    fonts.addEventListener('loadingdone', bump)
    void fonts.ready.then(bump)
    return () => fonts.removeEventListener('loadingdone', bump)
  }, [])
  return version
}
