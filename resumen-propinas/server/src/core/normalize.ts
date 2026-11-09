/** Deja un nombre en una forma comparable: sin acentos, minúsculas, sin signos y con un solo espacio. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Igual que normalizeName pero sin ningún espacio ("barra 2 main" -> "barra2main"). */
export function compactName(s: string): string {
  return normalizeName(s).replace(/ /g, '')
}

/** Clave para unificar productos: espacios dobles y mayúsculas no los distinguen (el nombre mostrado no se cambia). */
export function productKey(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toUpperCase()
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
    }
    prev = cur
  }
  return prev[b.length] ?? 0
}
