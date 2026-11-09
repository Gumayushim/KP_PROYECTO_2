import { ExcelJS } from './excel.js'
import type { DataRow, LineRow, PayRow } from '../core/types.js'

type Kind = 'data' | 'lines' | 'pays'

export interface Registros { data: DataRow[]; lines: LineRow[]; pays: PayRow[] }

/** Texto de una celda, venga como texto, número, fecha, texto enriquecido o fórmula. */
function str(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().replace('.000Z', 'Z')
  if (typeof v === 'object') {
    const o = v as any
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r.text).join('')
    if ('result' in o) return str(o.result)
    if ('text' in o) return String(o.text)
    return ''
  }
  return String(v).trim()
}

/** Número de una celda; acepta "$1,234.50" como texto. */
function num(v: unknown): number {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && 'result' in (v as any)) return num((v as any).result)
  const n = parseFloat(str(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Reconoce cada hoja por sus ENCABEZADOS (no por su nombre), así no depende de cómo se llame la pestaña. */
function detect(h: Map<string, number>): Kind | null {
  if (h.has('OrderId') && h.has('TerminalId')) return 'pays'
  if (h.has('OrderId') && h.has('PointSaleName') && h.has('ProductName') && h.has('Cantidad')) return 'lines'
  if (h.has('OrderId') && h.has('Propina') && h.has('Monto Total Productos') && h.has('Fecha')) return 'data'
  return null
}

/** Lee el archivo "Registros generales" por partes (sin cargarlo completo en memoria). */
export async function readRegistros(path: string, log: (m: string) => void = () => {}): Promise<Registros> {
  const out: Registros = { data: [], lines: [], pays: [] }
  const found = new Set<Kind>()
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit',
  })

  for await (const ws of reader as any) {
    let header: Map<string, number> | null = null
    let kind: Kind | null = null
    let n = 0
    // IMPORTANTE: se recorren TODAS las filas de cada hoja (aunque no sirva) para no detener el lector.
    for await (const row of ws as any) {
      const vals = row.values as unknown[] // índice 1 = columna A
      if (!header) {
        header = new Map()
        vals.forEach((v, i) => { const s = str(v); if (s) header!.set(s, i) })
        kind = detect(header)
        continue
      }
      if (!kind) continue
      const h = header
      const col = (name: string) => vals[h.get(name) ?? 0]
      const orderId = str(col('OrderId'))
      if (!orderId) continue
      n++
      if (kind === 'data') {
        out.data.push({
          orderId, fecha: str(col('Fecha')),
          sinPropina: num(col('Monto Total Productos')), propina: num(col('Propina')),
        })
      } else if (kind === 'lines') {
        out.lines.push({
          orderId, pv: str(col('PointSaleName')), producto: str(col('ProductName')),
          cantidad: num(col('Cantidad')), monto: num(col('Monto Total Productos')),
        })
      } else {
        out.pays.push({ orderId, terminal: str(col('TerminalId')) || null })
      }
    }
    if (kind) { found.add(kind); log(`Hoja leída (${kind}): ${n.toLocaleString('es-MX')} filas`) }
  }

  const faltan = (['data', 'lines', 'pays'] as Kind[]).filter((k) => !found.has(k))
  if (faltan.length) {
    const nombres = { data: 'DATA', lines: 'DATA-PRODUCT-POINT-SALE', pays: 'DATA-PRODUCT-PAYMENT' }
    throw new Error(`El archivo no trae las hojas esperadas: falta ${faltan.map((k) => nombres[k]).join(', ')}.`)
  }
  return out
}