import { useMemo } from 'react'
import QRCode from 'qrcode'

type QrCodeProps = {
  value: string
  label: string
  /** Color de los módulos; el fondo siempre es blanco para garantizar el contraste al escanear. */
  color?: string
}

/**
 * QR dibujado como un único <path> SVG a partir de la matriz de módulos.
 * Se evita inyectar HTML y el tamaño escala con el contenedor.
 */
export function QrCode({ value, label, color = '#000000' }: QrCodeProps) {
  const { size, path } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' })
    const modules = qr.modules
    const count = modules.size
    let d = ''
    for (let row = 0; row < count; row += 1) {
      let run = 0
      for (let col = 0; col <= count; col += 1) {
        const dark = col < count && modules.get(row, col)
        if (dark) run += 1
        else if (run > 0) {
          d += `M${col - run} ${row}h${run}v1h-${run}z`
          run = 0
        }
      }
    }
    return { size: count, path: d }
  }, [value])

  // Zona de silencio de 2 módulos alrededor (mínimo recomendado para lectores móviles: 4; el marco blanco del contenedor completa el resto).
  const margin = 2
  const box = size + margin * 2
  return (
    <svg className="lg-qr" viewBox={`0 0 ${box} ${box}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={box} height={box} fill="#ffffff" />
      <path transform={`translate(${margin} ${margin})`} d={path} fill={color} />
    </svg>
  )
}
