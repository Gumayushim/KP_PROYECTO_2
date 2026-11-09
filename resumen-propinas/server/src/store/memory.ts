import type { PvReport } from '../core/types.js'
import type { EventInfo, EventTotals, ResultItem, Store } from './types.js'

interface Row { info: EventInfo; items: Map<string, { report: PvReport; xlsx: Buffer }> }

export class MemoryStore implements Store {
  private rows = new Map<number, Row>()
  private nextId = 1

  async createEvent(name: string) {
    const id = this.nextId++
    this.rows.set(id, {
      info: { id, name, createdAt: new Date().toISOString(), status: 'processing', pvCount: 0, ordenes: 0, sinPropina: 0, propina: 0 },
      items: new Map(),
    })
    return id
  }

  async saveResults(eventId: number, items: ResultItem[], t: EventTotals) {
    const r = this.rows.get(eventId)
    if (!r) return // el evento se borró mientras se procesaba
    for (const it of items) r.items.set(it.pv, { report: it.report, xlsx: it.xlsx })
    Object.assign(r.info, { status: 'ready', pvCount: items.length, ...t })
  }

  async setEventError(eventId: number, message: string) {
    const r = this.rows.get(eventId)
    if (r) Object.assign(r.info, { status: 'error', error: message })
  }

  async listEvents() {
    return [...this.rows.values()].map((r) => ({ ...r.info })).sort((a, b) => b.id - a.id)
  }

  async allPvNames() {
    const s = new Set<string>()
    for (const r of this.rows.values()) if (r.info.status === 'ready') for (const k of r.items.keys()) s.add(k)
    return [...s]
  }

  async eventsForPv(pv: string) {
    return [...this.rows.values()]
      .filter((r) => r.info.status === 'ready' && r.items.has(pv))
      .map((r) => ({ id: r.info.id, name: r.info.name, createdAt: r.info.createdAt }))
      .sort((a, b) => b.id - a.id)
  }

  async getReport(eventId: number, pv: string) {
    const r = this.rows.get(eventId)
    return r?.info.status === 'ready' ? (r.items.get(pv)?.report ?? null) : null
  }

  async getFile(eventId: number, pv: string) {
    const r = this.rows.get(eventId)
    return r?.info.status === 'ready' ? (r.items.get(pv)?.xlsx ?? null) : null
  }

  async deleteEvent(eventId: number) {
    return this.rows.delete(eventId)
  }
}