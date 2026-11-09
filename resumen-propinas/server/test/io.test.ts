import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAllReports, joinOrders } from '../src/core/aggregate.js'
import { readRegistros } from '../src/io/readRegistros.js'
import { reportToXlsx } from '../src/io/writeReport.js'
import { ExcelJS } from '../src/io/excel.js'

// Esta prueba necesita el Excel REAL. Se activa con:  $env:REGISTROS_XLSX="C:\ruta\archivo.xlsx"; npm test
const archivo = process.env.REGISTROS_XLSX
const fx = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'))
const cent = (n: number) => Math.round(n * 100)

test('leer el Excel real da lo mismo que Python y el Excel generado cuadra', { skip: !archivo && 'define REGISTROS_XLSX' }, async () => {
  const reg = await readRegistros(archivo!)
  assert.equal(reg.data.length, fx.data.length, 'filas de DATA')
  assert.equal(reg.lines.length, fx.lines.length, 'filas de POINT-SALE')
  assert.equal(reg.pays.length, fx.pays.length, 'filas de PAYMENT')
  const suma = (a: number[]) => cent(a.reduce((x, y) => x + y, 0))
  assert.equal(suma(reg.data.map((d) => d.propina)), suma(fx.data.map((d: any) => d.propina)), 'propinas')
  assert.equal(suma(reg.lines.map((l) => l.monto)), suma(fx.lines.map((l: any) => l.monto)), 'montos')

  const { orders } = joinOrders(reg.data, reg.lines, reg.pays)
  const reports = buildAllReports(orders, reg.lines)
  assert.equal(reports.size, Object.keys(fx.expected.porPv).length)
  for (const [pv, e] of Object.entries<any>(fx.expected.porPv)) {
    const r = reports.get(pv)!
    assert.equal(cent(r.kpis.sinPropina), cent(e.sinPropina), `${pv} sin propina`)
    assert.equal(cent(r.kpis.propina), cent(e.propina), `${pv} propina`)
  }

  // Excel generado: se vuelve a abrir y se revisan los totales de la última fila
  const rep = reports.get('BARRA 5 STAGE 2 ALCOHOL')!
  const buf = await reportToXlsx(rep, 'Prueba')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as Buffer)
  const ws = wb.getWorksheet('Venta por terminal ($)')!
  const last = ws.getRow(ws.rowCount)
  const n = rep.matriz.productos.length
  assert.equal(last.getCell(1).value, 'TOTAL')
  assert.equal(cent(Number(last.getCell(n + 2).value)), 48612000)
  assert.equal(cent(Number(last.getCell(n + 3).value)), 2586040)
  assert.equal(cent(Number(last.getCell(n + 4).value)), 51198040)
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Venta por terminal ($)', 'Por producto', 'Resumen'])
})