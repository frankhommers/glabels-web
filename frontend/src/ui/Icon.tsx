/** Icons from the gLabels icon theme, so the web app speaks the same visual
 *  language as the desktop app. `glabels-web` holds our own additions in the
 *  same style. */

export type IconSize = 16 | 22 | 24 | 32 | 48

export function Icon({
  name,
  size = 24,
  context = 'actions',
  theme = 'glabels-flat',
  alt = '',
}: {
  name: string
  size?: IconSize
  context?: 'actions' | 'apps'
  theme?: 'glabels-flat' | 'glabels-web'
  alt?: string
}) {
  // The bundled theme has a drawing per size; our own additions exist once
  // under "scalable" and scale cleanly.
  const folder = theme === 'glabels-web' ? 'scalable' : `${size}x${size}`

  return (
    <img
      className="icon"
      src={`/icons/${theme}/${folder}/${context}/${name}.svg`}
      width={size}
      height={size}
      alt={alt}
      draggable={false}
    />
  )
}
