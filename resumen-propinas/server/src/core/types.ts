// Filas tal como salen del archivo de registros (ya leídas del Excel)
export interface DataRow { orderId: string; fecha: string; sinPropina: number; propina: number }
export interface LineRow { orderId: string; pv: string; producto: string; cantidad: number; monto: number }
export interface PayRow { orderId: string; terminal: string | null }

// Una fila por orden, con su punto de venta y terminal ya cruzados.
// Los montos van en CENTAVOS (enteros) para evitar errores de redondeo al sumar.
export interface Order {
  orderId: string
  fecha: string
  pv: string
  terminal: string
  unidades: number
  sinCents: number
  propinaCents: number
}

export interface PvSummary {
  pv: string
  ordenes: number
  unidades: number
  terminales: number
  sinPropina: number
  propina: number
  conPropina: number
}

export interface TerminalRow {
  terminal: string
  ordenes: number
  unidades: number
  sinPropina: number
  propina: number
  conPropina: number
}

export interface ProductRow { nombre: string; unidades: number; importe: number; pct: number }
export interface HourRow { hora: string; ordenes: number; sinPropina: number; propina: number }

export interface MatrixRow {
  terminal: string
  porProducto: number[]
  sinPropina: number
  propina: number
  conPropina: number
}

export interface PvReport {
  pv: string
  kpis: {
    ordenes: number
    unidades: number
    terminales: number
    sinPropina: number
    propina: number
    conPropina: number
    propinaPct: number
  }
  terminales: TerminalRow[]
  productos: ProductRow[]
  porHora: HourRow[]
  matriz: { productos: string[]; filas: MatrixRow[]; totales: MatrixRow }
}
