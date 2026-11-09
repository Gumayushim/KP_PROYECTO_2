import { ExcelJS } from './excel.js'
import type { PvReport } from '../core/types.js'

const M0 = '$#,##0;[Red]-$#,##0;"-"'
const M2 = '$#,##0.00;[Red]-$#,##0.00;"-"'
const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1F4E78' } }
const TOTAL_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFDDEBF7' } }

function styleHeader(row: any) {
  row.eachCell((c: any) => {
    c.fill = HEADER_FILL
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  row.height = 45
}

/** Excel de un punto de venta: matriz terminal x producto con los tres totales, productos y resumen. */
export async function reportToXlsx(r: PvReport, eventName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Resumen de propinas'

  // --- Hoja 1: Venta por terminal ($) ---
  const ws = wb.addWorksheet('Venta por terminal ($)', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] })
  const m = r.matriz
  ws.addRow(['Terminal', ...m.productos, 'TOTAL SIN PROPINA', 'PROPINA', 'TOTAL CON PROPINA'])
  styleHeader(ws.getRow(1))
  const nProd = m.productos.length
  for (const f of [...m.filas, m.totales]) {
    const row = ws.addRow([f.terminal, ...f.porProducto, f.sinPropina, f.propina, f.conPropina])
    row.eachCell((c: any, i: number) => {
      if (i === 1) return
      c.numFmt = i <= nProd + 2 ? M0 : M2
    })
    row.getCell(nProd + 2).font = { bold: true }
    row.getCell(nProd + 4).font = { bold: true }
    if (f === m.totales) row.eachCell((c: any) => { c.font = { bold: true }; c.fill = TOTAL_FILL })
  }
  ws.getColumn(1).width = 20
  for (let i = 2; i <= nProd + 4; i++) ws.getColumn(i).width = i > nProd + 1 ? 18 : 15

  // --- Hoja 2: Por producto ---
  const wp = wb.addWorksheet('Por producto', { views: [{ state: 'frozen', ySplit: 1 }] })
  wp.addRow(['Producto', 'Unidades', 'Importe', '% del total'])
  styleHeader(wp.getRow(1)); wp.getRow(1).height = 24
  for (const p of r.productos) {
    const row = wp.addRow([p.nombre, p.unidades, p.importe, p.pct])
    row.getCell(2).numFmt = '#,##0'; row.getCell(3).numFmt = M0; row.getCell(4).numFmt = '0.00%'
  }
  wp.getColumn(1).width = 38; wp.getColumn(2).width = 12; wp.getColumn(3).width = 16; wp.getColumn(4).width = 12

  // --- Hoja 3: Resumen ---
  const wr = wb.addWorksheet('Resumen')
  const k = r.kpis
  const filas: [string, string | number, string?][] = [
    ['Evento', eventName], ['Punto de venta', r.pv], ['Terminales', k.terminales, '#,##0'],
    ['Órdenes', k.ordenes, '#,##0'], ['Unidades', k.unidades, '#,##0'],
    ['Total sin propina', k.sinPropina, M2], ['Propina', k.propina, M2],
    ['Total con propina', k.conPropina, M2], ['Propina % de la venta', k.propinaPct, '0.0%'],
  ]
  for (const [a, b, fmt] of filas) {
    const row = wr.addRow([a, b])
    row.getCell(1).font = { bold: true }
    if (fmt) row.getCell(2).numFmt = fmt
  }
  wr.getColumn(1).width = 26; wr.getColumn(2).width = 34

  return Buffer.from(await wb.xlsx.writeBuffer())
}