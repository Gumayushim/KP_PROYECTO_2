import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAllReports, joinOrders, summarizeByPv } from '../src/core/aggregate.js'

// fixture.json lo genera tools/export_fixture.py con el programa de Python: ahí están los números "correctos".
const fx = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'))
const { orders, warnings } = joinOrders(fx.data, fx.lines, fx.pays)
const reports = buildAllReports(orders, fx.lines)
const exp = fx.expected.porPv as Record<string, any>
const cent = (n: number) => Math.round(n * 100)

test('mismo número de órdenes y avisos que Python', () => {
  assert.equal(orders.length, fx.data.length)
  console.log('  avisos:', warnings)
})

test('resumen por punto de venta = Python (órdenes, unidades, terminales, venta y propina)', () => {
  const res = summarizeByPv(orders)
  assert.equal(res.length, Object.keys(exp).length)
  for (const r of res) {
    const e = exp[r.pv]
    assert.ok(e, r.pv)
    assert.equal(r.ordenes, e.ordenes, `${r.pv} órdenes`)
    assert.equal(r.unidades, e.unidades, `${r.pv} unidades`)
    assert.equal(r.terminales, e.terminales, `${r.pv} terminales`)
    assert.equal(cent(r.sinPropina), cent(e.sinPropina), `${r.pv} sin propina`)
    assert.equal(cent(r.propina), cent(e.propina), `${r.pv} propina`)
    assert.equal(cent(r.conPropina), cent(e.sinPropina + e.propina), `${r.pv} con propina`)
  }
})

test('por terminal = Python, en los 57 puntos de venta', () => {
  let n = 0
  for (const [pv, e] of Object.entries(exp)) {
    const rep = reports.get(pv)!
    assert.equal(rep.terminales.length, Object.keys(e.porTerminal).length, `${pv} terminales`)
    for (const t of rep.terminales) {
      const x = e.porTerminal[t.terminal]
      assert.ok(x, `${pv} / ${t.terminal}`)
      assert.equal(cent(t.sinPropina), cent(x.sin), `${pv} / ${t.terminal} sin propina`)
      assert.equal(cent(t.propina), cent(x.prop), `${pv} / ${t.terminal} propina`)
      n++
    }
  }
  console.log(`  ${n} combinaciones punto de venta x terminal comparadas`)
})

test('matriz terminal x producto: cuadra con el resumen y está ordenada de mayor a menor', () => {
  for (const [pv, rep] of reports) {
    const m = rep.matriz
    // la suma de productos = total; el total de la matriz = venta del punto de venta
    for (const f of m.filas) {
      assert.equal(cent(f.porProducto.reduce((a, b) => a + b, 0)), cent(f.sinPropina), `${pv} fila ${f.terminal}`)
      assert.equal(cent(f.sinPropina + f.propina), cent(f.conPropina))
    }
    assert.equal(cent(m.totales.sinPropina), cent(rep.kpis.sinPropina), `${pv} total matriz vs resumen`)
    assert.equal(cent(m.totales.propina), cent(rep.kpis.propina), `${pv} propina matriz vs resumen`)
    for (let i = 1; i < m.filas.length; i++) assert.ok(m.filas[i - 1]!.sinPropina >= m.filas[i]!.sinPropina, `${pv} orden terminales`)
    const tot = m.totales.porProducto
    for (let i = 1; i < tot.length; i++) assert.ok(tot[i - 1]! >= tot[i]!, `${pv} orden productos`)
    assert.equal(rep.productos.length, m.productos.length)
    const pct = rep.productos.reduce((a, p) => a + p.pct, 0)
    assert.ok(rep.productos.length === 0 || Math.abs(pct - 1) < 1e-9, `${pv} % suma 1`)
  }
})

test('ejemplo conocido: BARRA 5 STAGE 2 ALCOHOL', () => {
  const r = reports.get('BARRA 5 STAGE 2 ALCOHOL')!
  assert.equal(r.kpis.terminales, 23)
  assert.equal(r.kpis.unidades, 3094)
  assert.equal(r.kpis.sinPropina, 486120)
  assert.equal(r.kpis.propina, 25860.4)
  assert.equal(r.kpis.conPropina, 511980.4)
  assert.equal(r.matriz.productos.length, 42)
  const t = r.terminales.find((x) => x.terminal === 'C246LT52910683')!
  assert.deepEqual([t.sinPropina, t.propina, t.conPropina, t.ordenes], [39900, 2158, 42058, 157])
  console.log('  horas con venta:', r.porHora.length, '| primera:', r.porHora[0]?.hora)
})
