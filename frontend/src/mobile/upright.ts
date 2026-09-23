/** Show the preview of a turned design the way it was designed.
 *
 *  The preview is the page that goes to the printer. A design made a quarter
 *  turn from its product (a roll label written along its length, say) lies
 *  on its side on that page. On a phone you want to read it, so it is turned
 *  back here: a quarter turn clockwise undoes the renderer's turn.
 */

import { useEffect, useState } from 'react'

export function useUprightSrc(src: string, rotate: boolean): string | null {
  const [turned, setTurned] = useState<string | null>(null)

  useEffect(() => {
    if (!rotate) return
    let url: string | null = null
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalHeight
      canvas.height = image.naturalWidth
      const context = canvas.getContext('2d')
      if (!context) return
      context.translate(canvas.width, 0)
      context.rotate(Math.PI / 2)
      context.drawImage(image, 0, 0)
      canvas.toBlob((blob) => {
        if (!blob || cancelled) return
        url = URL.createObjectURL(blob)
        setTurned(url)
      })
    }
    image.src = src
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
      setTurned(null)
    }
  }, [src, rotate])

  return rotate ? turned : src
}
