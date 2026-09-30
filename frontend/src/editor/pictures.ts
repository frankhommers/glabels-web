/** Pictures that are pasted or dropped onto a label.
 *
 *  gLabels embeds a picture in the label file itself, and reads back only
 *  two forms: PNG and SVG. So an SVG stays as it is, a PNG too, and anything
 *  else the browser can show (JPEG, WebP, GIF, a bitmap from the clipboard)
 *  is turned into PNG here. A photo straight from a camera is scaled down
 *  first: at 300 dpi a label of 20 cm needs no more than 2400 pixels, and a
 *  smaller file keeps the label quick to open and send to the printer.
 */

const MAX_SIDE = 2400

export type Picture = { blob: Blob; filename: string; width: number; height: number }

export class PictureError extends Error {}

export function isSvgText(text: string): boolean {
  const start = text.trimStart().slice(0, 400).toLowerCase()
  return start.startsWith('<svg') || (start.startsWith('<?xml') && start.includes('<svg'))
}

export function isPictureFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(svg|png|jpe?g|gif|webp|bmp)$/i.test(file.name)
}

function isSvg(blob: Blob, filename: string): boolean {
  return blob.type === 'image/svg+xml' || filename.toLowerCase().endsWith('.svg')
}

async function svgSize(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    // Browsers make up 300 × 150 for a drawing without a size; better than nothing.
    return { width: image.naturalWidth || 100, height: image.naturalHeight || 100 }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function preparePicture(blob: Blob, filename = 'picture'): Promise<Picture> {
  if (isSvg(blob, filename)) {
    const svg = new Blob([await blob.text()], { type: 'image/svg+xml' })
    const size = await svgSize(svg).catch(() => {
      throw new PictureError('unreadable')
    })
    return { blob: svg, filename: filename.replace(/\.[^.]*$/, '') + '.svg', ...size }
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    // HEIC in a browser that cannot show it, a broken file, not a picture.
    throw new PictureError('unreadable')
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const pngName = filename.replace(/\.[^.]*$/, '') + '.png'

  if (blob.type === 'image/png' && scale === 1) {
    bitmap.close()
    return { blob, filename: pngName, width, height }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new PictureError('unreadable')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!png) throw new PictureError('unreadable')
  return { blob: png, filename: pngName, width, height }
}
