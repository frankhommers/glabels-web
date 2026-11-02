/** The preview on the phone: the picture from the server with the product's
 *  guides drawn on it, turned upright when the label was designed lying
 *  down. While a new picture is on its way the previous one stays, so the
 *  preview never goes blank or jumps; `updating` says it is out of date,
 *  `failed` that the new one could not be made. */

import { useEffect, useState } from 'react'
import { drawGuides, type PreviewGuides } from '../editor/guidedPreview'

type Shown = { key: string; src: string; owned: boolean }

export function useSteadyPreview(
  url: string,
  guides: PreviewGuides | null,
  rotate: boolean,
): { src: string | null; updating: boolean; failed: boolean } {
  const withGuides = guides && guides.markups.length > 0 && guides.cells.length > 0 ? guides : null
  const key = url ? JSON.stringify([url, withGuides, rotate]) : ''
  const [shown, setShown] = useState<Shown | null>(null)
  const [failed, setFailed] = useState('')

  useEffect(() => {
    if (!key) return
    const [wanted, wantedGuides, turn] = JSON.parse(key) as [string, PreviewGuides | null, boolean]
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      if (!wantedGuides && !turn) {
        setShown({ key, src: wanted, owned: false })
        return
      }
      // Guides on the picture as it comes, then turned as a whole.
      const flat = document.createElement('canvas')
      flat.width = image.naturalWidth
      flat.height = image.naturalHeight
      const context = flat.getContext('2d')
      if (!context) return
      context.drawImage(image, 0, 0)
      if (wantedGuides) drawGuides(context, wantedGuides, flat.width)
      let result = flat
      if (turn) {
        result = document.createElement('canvas')
        result.width = flat.height
        result.height = flat.width
        const turned = result.getContext('2d')
        if (!turned) return
        turned.translate(result.width, 0)
        turned.rotate(Math.PI / 2)
        turned.drawImage(flat, 0, 0)
      }
      result.toBlob((blob) => {
        if (!blob || cancelled) return
        setShown({ key, src: URL.createObjectURL(blob), owned: true })
      })
    }
    image.onerror = () => {
      if (!cancelled) setFailed(key)
    }
    image.src = wanted
    return () => {
      cancelled = true
    }
  }, [key])

  // A picture made here is let go once another takes its place.
  useEffect(
    () => () => {
      if (shown?.owned) URL.revokeObjectURL(shown.src)
    },
    [shown],
  )

  return {
    src: shown?.src ?? null,
    updating: Boolean(key) && shown?.key !== key && failed !== key,
    failed: Boolean(key) && failed === key,
  }
}
