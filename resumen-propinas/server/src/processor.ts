import { buildAllReports, joinOrders } from './core/aggregate.js'
import type { ResultItem, EventTotals } from './store/types.js'
import { readRegistros } from './io/readRegistros.js'
import { reportToXlsx } from './io/writeReport.js'

export interface ProcessResult { items: ResultItem[]; totals: EventTotals; warnings: string[] }
/** Recibe la ruta del Excel subido y devuelve un reporte + un Excel por punto de venta. */
export type Processor = (filePath: string, eventName: string, log: (m: string) => void) => Promise<ProcessResult>

export const realProcessor: Processor = async (filePath, eventName, log) => {
  const reg = await readRegistros(filePath, log)
  const { orders, warnings } = joinOrders(reg.data, reg.lines, reg.pays)
  const reports = buildAllReports(orders, reg.lines)
  log(`Generando ${reports.size} archivos Excel...`)
  const items: ResultItem[] = []
  for (const [pv, report] of reports) items.push({ pv, report, xlsx: await reportToXlsx(report, eventName) })
  const totals = items.reduce(
    (a, i) => ({ ordenes: a.ordenes + i.report.kpis.ordenes, sinPropina: a.sinPropina + i.report.kpis.sinPropina, propina: a.propina + i.report.kpis.propina }),
    { ordenes: 0, sinPropina: 0, propina: 0 },
  )
  totals.sinPropina = Math.round(totals.sinPropina * 100) / 100
  totals.propina = Math.round(totals.propina * 100) / 100
  return { items, totals, warnings }
}
