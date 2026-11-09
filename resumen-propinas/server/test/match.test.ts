import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { matchPointOfSale } from '../src/core/match.js'

const fx = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'))
const names: string[] = Object.keys(fx.expected.porPv)

test('cada nombre real se reconoce igual en mayúsculas, minúsculas y con espacios de más', () => {
  for (const n of names) {
    for (const v of [n, n.toLowerCase(), `  ${n.toLowerCase().replace(/ /g, '   ')}  `, n.replace(/ /g, '_')]) {
      const r = matchPointOfSale(v, names)
      assert.deepEqual(r.status === 'match' ? r.name : r.status, n, `"${v}"`)
    }
  }
})

test('acentos y signos no importan', () => {
  const r = matchPointOfSale('VIP Barra Bañós Mixtas', names)
  assert.equal(r.status === 'match' ? r.name : null, names.find((n) => n.includes('BAÑOS')) ?? null)
})

test('NUNCA devuelve un punto de venta distinto al escrito (aunque haya faltas de ortografía)', () => {
  let probes = 0, aceptados = 0
  for (const n of names) {
    const base = n.toLowerCase()
    for (let i = 0; i < base.length; i++) {
      if (/\d/.test(base[i]!)) continue
      const variantes = [
        base.slice(0, i) + base.slice(i + 1), // letra de menos
        base.slice(0, i) + 'x' + base.slice(i + 1), // letra equivocada
        base.slice(0, i) + base[i] + base.slice(i), // letra repetida
      ]
      for (const v of variantes) {
        probes++
        const r = matchPointOfSale(v, names)
        if (r.status === 'match') {
          aceptados++
          assert.equal(r.name, n, `"${v}" debía ser "${n}" y dio "${r.name}"`)
        }
      }
    }
  }
  console.log(`  pruebas con errores de ortografía: ${probes}, aceptadas: ${aceptados} (${((aceptados / probes) * 100).toFixed(0)}%)`)
  assert.ok(aceptados / probes > 0.6, 'debería tolerar la mayoría de los errores de una letra')
})

test('los números no se confunden: BARRA 2 no es BARRA 3', () => {
  const con = names.filter((n) => /\d/.test(n))
  for (const n of con) {
    const cambiado = n.replace(/\d/, (d) => String((Number(d) + 1) % 10)).toLowerCase()
    if (names.includes(cambiado.toUpperCase())) continue
    const r = matchPointOfSale(cambiado, names)
    assert.notEqual(r.status, 'match', `"${cambiado}" no debería coincidir con nada (era "${n}")`)
  }
})

test('texto incompleto o ambiguo no adivina', () => {
  for (const q of ['barra', 'barra 5 stage 2', 'vip barra', 'x', '', 'zzzzzz']) {
    assert.notEqual(matchPointOfSale(q, names).status, 'match', q)
  }
})
