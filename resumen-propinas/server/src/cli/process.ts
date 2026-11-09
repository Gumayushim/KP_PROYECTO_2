/**
 * Prueba del procesamiento completo SIN servidor ni base de datos:
 *   npm run process -- "C:\ruta\Registros_generales.xlsx" salida
 * Lee el archivo, cruza órdenes/terminales/puntos de venta y escribe un Excel por punto de venta.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildAllReports, joinOrders, summarizeByPv } from '../core/aggregate.js'
import { readRegistros } from '../io/readRegistros.js'
import { reportToXlsx } from '../io/writeReport.js'

const [archivoArg, salida = 'salida'] = process.argv.slice(2)
const archivo = archivoArg ?? process.env.REGISTROS_XLSX
if (!archivo) { console.error('Falta el archivo. Define $env:REGISTROS_XLSX o pasa la ruta como argumento.'); process.exit(1) }

const t0 = Date.now()
const mb = () => `${Math.round(process.memoryUsage().rss / 1048576)} MB`
const reg = await readRegistros(archivo, (m) => console.log(' ', m))
console.log(`Lectura: ${((Date.now() - t0) / 1000).toFixed(1)} s | memoria: ${mb()}`)

const { orders, warnings } = joinOrders(reg.data, reg.lines, reg.pays)
const resumen = summarizeByPv(orders)
const reports = buildAllReports(orders, reg.lines)
mkdirSync(salida, { recursive: true })
for (const [pv, rep] of reports) {
  const buf = await reportToXlsx(rep, 'Prueba')
  writeFileSync(join(salida, pv.replace(/[^A-Za-z0-9]+/g, '_') + '.xlsx'), buf)
}
const tot = resumen.reduce((a, r) => ({ o: a.o + r.ordenes, u: a.u + r.unidades, s: a.s + r.sinPropina, p: a.p + r.propina }),
  { o: 0, u: 0, s: 0, p: 0 })
console.log(`\nPuntos de venta: ${resumen.length} | Órdenes: ${tot.o.toLocaleString('es-MX')} | Unidades: ${tot.u.toLocaleString('es-MX')}`)
console.log(`Sin propina: $${tot.s.toFixed(2)} | Propina: $${tot.p.toFixed(2)} | Con propina: $${(tot.s + tot.p).toFixed(2)}`)
for (const w of warnings) console.log('AVISO:', w)
console.log(`Listo en ${((Date.now() - t0) / 1000).toFixed(1)} s | memoria: ${mb()} | archivos en "${salida}"`)