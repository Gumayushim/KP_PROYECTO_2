import { productKey } from './normalize.js'
import type {
  DataRow, HourRow, LineRow, MatrixRow, Order, PayRow, ProductRow, PvReport, PvSummary, TerminalRow,
} from './types.js'

const toCents = (n: number) => Math.round(n * 100)
const pesos = (c: number) => c / 100
const first = (set: Set<string> | undefined) => (set && set.size ? [...set].sort()[0] : undefined)

/** Cruza DATA (propinas), POINT-SALE (punto de venta, unidades) y PAYMENT (terminal) por OrderId. */
export function joinOrders(data: DataRow[], lines: LineRow[], pays: PayRow[]) {
  const warnings: string[] = []
  const terms = new Map<string, Set<string>>()
  for (const p of pays) {
    if (!p.terminal) continue
    let s = terms.get(p.orderId)
    if (!s) terms.set(p.orderId, (s = new Set()))
    s.add(p.terminal)
  }
  const pvs = new Map<string, Set<string>>()
  const units = new Map<string, number>()
  for (const l of lines) {
    let s = pvs.get(l.orderId)
    if (!s) pvs.set(l.orderId, (s = new Set()))
    s.add(l.pv)
    units.set(l.orderId, (units.get(l.orderId) ?? 0) + l.cantidad)
  }
  const multiT = [...terms.values()].filter((s) => s.size > 1).length
  if (multiT) warnings.push(`${multiT} órdenes con más de una terminal (se usó la primera).`)
  const multiP = [...pvs.values()].filter((s) => s.size > 1).length
  if (multiP) warnings.push(`${multiP} órdenes con más de un punto de venta (se usó el primero).`)

  const seen = new Set<string>()
  let dup = 0, sinPv = 0, sinT = 0, canc = 0
  const orders: Order[] = []
  for (const d of data) {
    if (seen.has(d.orderId)) { dup++; continue }
    seen.add(d.orderId)
    const pv = first(pvs.get(d.orderId))
    const terminal = first(terms.get(d.orderId))
    if (!pv) sinPv++
    if (!terminal) sinT++
    if (terminal?.toUpperCase() === 'CANCELADO') canc++
    orders.push({
      orderId: d.orderId,
      fecha: d.fecha,
      pv: pv ?? '(sin punto de venta)',
      terminal: terminal ?? '(sin terminal)',
      unidades: units.get(d.orderId) ?? 0,
      sinCents: toCents(d.sinPropina),
      propinaCents: toCents(d.propina),
    })
  }
  if (dup) warnings.push(`${dup} OrderId repetidos en DATA (se dejó la primera fila).`)
  if (sinPv) warnings.push(`${sinPv} órdenes sin punto de venta.`)
  if (sinT) warnings.push(`${sinT} órdenes sin terminal.`)
  if (canc) warnings.push(`${canc} órdenes con terminal 'CANCELADO' (unidades y montos negativos); se incluyen tal cual.`)
  return { orders, warnings }
}

/** Una fila por punto de venta, de mayor a menor venta. */
export function summarizeByPv(orders: Order[]): PvSummary[] {
  const m = new Map<string, { o: number; u: number; s: number; p: number; t: Set<string> }>()
  for (const o of orders) {
    let a = m.get(o.pv)
    if (!a) m.set(o.pv, (a = { o: 0, u: 0, s: 0, p: 0, t: new Set() }))
    a.o++; a.u += o.unidades; a.s += o.sinCents; a.p += o.propinaCents; a.t.add(o.terminal)
  }
  return [...m.entries()]
    .map(([pv, a]) => ({
      pv, ordenes: a.o, unidades: a.u, terminales: a.t.size,
      sinPropina: pesos(a.s), propina: pesos(a.p), conPropina: pesos(a.s + a.p),
    }))
    .sort((x, y) => y.sinPropina - x.sinPropina)
}

const hourFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
})
function localHour(iso: string): string {
  const p = Object.fromEntries(hourFmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:00`
}

/** Reportes completos (para el dashboard y el Excel) de TODOS los puntos de venta, en una sola pasada. */
export function buildAllReports(orders: Order[], lines: LineRow[]): Map<string, PvReport> {
  const byOrder = new Map(orders.map((o) => [o.orderId, o]))
  const ordersByPv = new Map<string, Order[]>()
  for (const o of orders) {
    let a = ordersByPv.get(o.pv)
    if (!a) ordersByPv.set(o.pv, (a = []))
    a.push(o)
  }
  const linesByPv = new Map<string, LineRow[]>()
  for (const l of lines) {
    let a = linesByPv.get(l.pv)
    if (!a) linesByPv.set(l.pv, (a = []))
    a.push(l)
  }
  const out = new Map<string, PvReport>()
  for (const [pv, os] of ordersByPv) out.set(pv, buildReport(pv, os, linesByPv.get(pv) ?? [], byOrder))
  return out
}

function buildReport(pv: string, os: Order[], ls: LineRow[], byOrder: Map<string, Order>): PvReport {
  // --- terminales (desde las órdenes) ---
  const tm = new Map<string, { o: number; u: number; s: number; p: number }>()
  const hm = new Map<string, { o: number; s: number; p: number }>()
  let sumS = 0, sumP = 0, sumU = 0
  for (const o of os) {
    let a = tm.get(o.terminal)
    if (!a) tm.set(o.terminal, (a = { o: 0, u: 0, s: 0, p: 0 }))
    a.o++; a.u += o.unidades; a.s += o.sinCents; a.p += o.propinaCents
    sumS += o.sinCents; sumP += o.propinaCents; sumU += o.unidades
    const h = localHour(o.fecha)
    let b = hm.get(h)
    if (!b) hm.set(h, (b = { o: 0, s: 0, p: 0 }))
    b.o++; b.s += o.sinCents; b.p += o.propinaCents
  }
  const terminales: TerminalRow[] = [...tm.entries()]
    .map(([terminal, a]) => ({
      terminal, ordenes: a.o, unidades: a.u,
      sinPropina: pesos(a.s), propina: pesos(a.p), conPropina: pesos(a.s + a.p),
    }))
    .sort((a, b) => b.sinPropina - a.sinPropina)
  const porHora: HourRow[] = [...hm.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([hora, b]) => ({ hora, ordenes: b.o, sinPropina: pesos(b.s), propina: pesos(b.p) }))

  // --- productos y matriz terminal x producto (desde las líneas) ---
  const display = new Map<string, string>() // clave -> primer nombre visto
  const prod = new Map<string, { u: number; c: number }>()
  const cell = new Map<string, Map<string, number>>() // terminal -> clave -> centavos
  for (const l of ls) {
    const k = productKey(l.producto)
    if (!display.has(k)) display.set(k, l.producto)
    const pr = prod.get(k) ?? { u: 0, c: 0 }
    pr.u += l.cantidad; pr.c += toCents(l.monto); prod.set(k, pr)
    const t = byOrder.get(l.orderId)?.terminal ?? '(sin terminal)'
    let row = cell.get(t)
    if (!row) cell.set(t, (row = new Map()))
    row.set(k, (row.get(k) ?? 0) + toCents(l.monto))
  }
  const keys = [...prod.entries()].sort((a, b) => b[1].c - a[1].c).map(([k]) => k)
  const totalProd = [...prod.values()].reduce((s, x) => s + x.c, 0)
  const productos: ProductRow[] = keys.map((k) => ({
    nombre: display.get(k)!, unidades: prod.get(k)!.u, importe: pesos(prod.get(k)!.c),
    pct: totalProd ? prod.get(k)!.c / totalProd : 0,
  }))

  const propinaPorT = new Map([...tm.entries()].map(([t, a]) => [t, a.p]))
  const rows = [...cell.entries()].map(([terminal, m]) => {
    const por = keys.map((k) => m.get(k) ?? 0)
    const s = por.reduce((a, b) => a + b, 0)
    const p = propinaPorT.get(terminal) ?? 0
    return { terminal, por, s, p }
  }).sort((a, b) => b.s - a.s)
  const filas: MatrixRow[] = rows.map((r) => ({
    terminal: r.terminal, porProducto: r.por.map(pesos),
    sinPropina: pesos(r.s), propina: pesos(r.p), conPropina: pesos(r.s + r.p),
  }))
  const totC = keys.map((_, i) => rows.reduce((s, r) => s + (r.por[i] ?? 0), 0))
  const totS = totC.reduce((a, b) => a + b, 0)
  const totP = rows.reduce((s, r) => s + r.p, 0)
  const totales: MatrixRow = {
    terminal: 'TOTAL', porProducto: totC.map(pesos), sinPropina: pesos(totS), propina: pesos(totP), conPropina: pesos(totS + totP),
  }

  return {
    pv,
    kpis: {
      ordenes: os.length, unidades: sumU, terminales: tm.size,
      sinPropina: pesos(sumS), propina: pesos(sumP), conPropina: pesos(sumS + sumP),
      propinaPct: sumS ? sumP / sumS : 0,
    },
    terminales, productos, porHora,
    matriz: { productos: keys.map((k) => display.get(k)!), filas, totales },
  }
}
