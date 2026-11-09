import { compactName, levenshtein, normalizeName } from './normalize.js'

export type MatchResult =
  | { status: 'match'; name: string; exact: boolean }
  | { status: 'none' }
  | { status: 'ambiguous' } // se trata igual que "none" hacia afuera: nunca se revela qué otros nombres existen

const MIN_LENGTH = 3
const MIN_SCORE = 0.84 // parecido mínimo (1 = idéntico)
const MIN_GAP = 2 // el segundo mejor candidato debe estar al menos 2 ediciones más lejos

const digits = (s: string) => s.replace(/\D+/g, '')

/**
 * Busca el punto de venta que el usuario quiso escribir.
 * - Ignora mayúsculas, acentos, espacios de más, guiones bajos y signos.
 * - Tolera pequeñas faltas de ortografía.
 * - Los NÚMEROS del nombre deben coincidir exactamente (BARRA 2 nunca se confunde con BARRA 3).
 * - Si hay duda entre dos nombres, NO adivina.
 */
export function matchPointOfSale(input: string, names: readonly string[]): MatchResult {
  const q = normalizeName(input)
  const qc = q.replace(/ /g, '')
  if (qc.length < MIN_LENGTH) return { status: 'none' }

  // 1) Coincidencia exacta una vez normalizado
  const exact = names.filter((n) => compactName(n) === qc)
  if (exact.length === 1) return { status: 'match', name: exact[0]!, exact: true }
  if (exact.length > 1) return { status: 'ambiguous' }

  // 2) Coincidencia aproximada
  const qd = digits(qc)
  const scored = names
    .map((name) => {
      const nc = compactName(name)
      const dist = levenshtein(qc, nc)
      return { name, dist, score: 1 - dist / Math.max(qc.length, nc.length), sameDigits: digits(nc) === qd }
    })
    .filter((c) => c.sameDigits)
    .sort((a, b) => a.dist - b.dist)

  const best = scored[0]
  if (!best) return { status: 'none' }
  const goodEnough = best.score >= MIN_SCORE || (best.dist <= 1 && qc.length >= 5)
  if (!goodEnough) return { status: 'none' }
  const second = scored[1]
  if (second && second.dist - best.dist < MIN_GAP) return { status: 'ambiguous' }
  return { status: 'match', name: best.name, exact: false }
}
