import type { PvReport } from '../core/types.js'

export interface EventInfo {
  id: number
  name: string
  createdAt: string
  status: 'processing' | 'ready' | 'error'
  error?: string
  pvCount: number
  ordenes: number
  sinPropina: number
  propina: number
}

export interface ResultItem { pv: string; report: PvReport; xlsx: Buffer }
export interface EventTotals { ordenes: number; sinPropina: number; propina: number }

/** Todo lo que el servidor necesita guardar. Hay una versión en memoria (pruebas) y otra en MySQL (producción). */
export interface Store {
  createEvent(name: string): Promise<number>
  saveResults(eventId: number, items: ResultItem[], totals: EventTotals): Promise<void>
  setEventError(eventId: number, message: string): Promise<void>
  listEvents(): Promise<EventInfo[]>
  allPvNames(): Promise<string[]>
  eventsForPv(pv: string): Promise<{ id: number; name: string; createdAt: string }[]>
  getReport(eventId: number, pv: string): Promise<PvReport | null>
  getFile(eventId: number, pv: string): Promise<Buffer | null>
  deleteEvent(eventId: number): Promise<boolean>
}
