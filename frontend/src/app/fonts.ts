/** Load the server's fonts into the browser.
 *
 *  The renderer makes the PDF with the fonts from the container. By loading
 *  exactly those files as @font-face, the canvas shows what will be printed —
 *  instead of a substitute font from the system.
 */

export type FontFace = {
  id: string
  family: string
  subfamily: string
  full_name: string
  source: 'builtin' | 'uploaded'
  bold: boolean
  italic: boolean
  size_bytes: number
  url: string
  media_type: string
  /** Vertical metrics in font units, for laying out text like the renderer. */
  units_per_em?: number | null
  ascender?: number | null
  descender?: number | null
  line_gap?: number | null
}

export type FontFamily = {
  family: string
  source: 'builtin' | 'uploaded'
  faces: FontFace[]
}

import { registerFontMetrics } from '../editor/textLayout'

const STYLE_ELEMENT_ID = 'glabels-server-fonts'

export async function fetchFonts(): Promise<FontFamily[]> {
  const response = await fetch('/api/fonts')
  if (!response.ok) throw new Error(`could not fetch fonts (${response.status})`)
  return (await response.json()) as FontFamily[]
}

/** Set up @font-face rules for all fonts from the server. */
export function applyFonts(families: FontFamily[]): void {
  registerFontMetrics(families.flatMap((family) => family.faces))
  const rules = families
    .flatMap((family) => family.faces)
    .map((face) => {
      const format = face.media_type === 'font/otf' ? 'opentype' : 'truetype'
      return [
        '@font-face {',
        `  font-family: ${JSON.stringify(face.family)};`,
        `  src: url(${JSON.stringify(face.url)}) format(${JSON.stringify(format)});`,
        `  font-weight: ${face.bold ? 'bold' : 'normal'};`,
        `  font-style: ${face.italic ? 'italic' : 'normal'};`,
        '  font-display: block;',
        '}',
      ].join('\n')
    })
    .join('\n')

  let style = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ELEMENT_ID
    document.head.append(style)
  }
  style.textContent = rules
}

export async function uploadFont(file: File): Promise<FontFace> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch('/api/fonts', { method: 'POST', body: form })
  if (!response.ok) {
    let detail = `${response.status}`
    try {
      detail = (await response.json()).detail ?? detail
    } catch {
      // no JSON body
    }
    throw new Error(detail)
  }
  return (await response.json()) as FontFace
}

export async function deleteFont(id: string): Promise<void> {
  const response = await fetch(`/api/fonts/${id}`, { method: 'DELETE' })
  if (!response.ok) throw new Error(`delete failed (${response.status})`)
}
