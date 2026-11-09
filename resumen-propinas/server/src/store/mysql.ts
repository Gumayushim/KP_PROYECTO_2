import mysql, { type Pool, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise'
import type { PvReport } from '../core/types.js'
import type { EventInfo, EventTotals, ResultItem, Store } from './types.js'

interface MysqlOptions { host: string; port: number; user: string; password: string; database: string }
interface EventRow extends RowDataPacket {
  id: number; name: string; created_at: Date | string; status: 'processing' | 'ready' | 'error'
  error: string | null; pv_count: number; orders_count: number; sin_propina: string | number; propina: string | number
}
interface ReportRow extends RowDataPacket { report: unknown; xlsx: Buffer }

export class MysqlStore implements Store {
  private pool: Pool

  constructor(options: MysqlOptions) {
    this.pool = mysql.createPool({
      ...options,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      enableKeepAlive: true,
      ssl: { rejectUnauthorized: true },
    })
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        status ENUM('processing','ready','error') NOT NULL DEFAULT 'processing',
        error TEXT NULL,
        pv_count INT NOT NULL DEFAULT 0,
        orders_count BIGINT NOT NULL DEFAULT 0,
        sin_propina DECIMAL(18,2) NOT NULL DEFAULT 0,
        propina DECIMAL(18,2) NOT NULL DEFAULT 0
      ) ENGINE=InnoDB
    `)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS pv_reports (
        event_id BIGINT UNSIGNED NOT NULL,
        pv VARCHAR(180) NOT NULL,
        report JSON NOT NULL,
        xlsx LONGBLOB NOT NULL,
        PRIMARY KEY (event_id, pv),
        CONSTRAINT fk_pv_reports_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `)
  }

  private event(row: EventRow): EventInfo {
    const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString()
    return {
      id: Number(row.id), name: row.name, createdAt, status: row.status,
      ...(row.error ? { error: row.error } : {}),
      pvCount: Number(row.pv_count), ordenes: Number(row.orders_count),
      sinPropina: Number(row.sin_propina), propina: Number(row.propina),
    }
  }

  async createEvent(name: string): Promise<number> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      'INSERT INTO events (name, status) VALUES (?, ?)', [name, 'processing'],
    )
    return Number(result.insertId)
  }

  async saveResults(eventId: number, items: ResultItem[], totals: EventTotals): Promise<void> {
    const conn = await this.pool.getConnection()
    try {
      await conn.beginTransaction()
      for (const item of items) {
        await conn.execute(
          'INSERT INTO pv_reports (event_id, pv, report, xlsx) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE report=VALUES(report), xlsx=VALUES(xlsx)',
          [eventId, item.pv, JSON.stringify(item.report), item.xlsx],
        )
      }
      await conn.execute(
        "UPDATE events SET status='ready', error=NULL, pv_count=?, orders_count=?, sin_propina=?, propina=? WHERE id=?",
        [items.length, totals.ordenes, totals.sinPropina, totals.propina, eventId],
      )
      await conn.commit()
    } catch (error) {
      await conn.rollback()
      throw error
    } finally {
      conn.release()
    }
  }

  async setEventError(eventId: number, message: string): Promise<void> {
    await this.pool.execute("UPDATE events SET status='error', error=? WHERE id=?", [message.slice(0, 4000), eventId])
  }

  async listEvents(): Promise<EventInfo[]> {
    const [rows] = await this.pool.query<EventRow[]>('SELECT * FROM events ORDER BY id DESC')
    return rows.map(row => this.event(row))
  }

  async allPvNames(): Promise<string[]> {
    const [rows] = await this.pool.query<(RowDataPacket & { pv: string })[]>(
      "SELECT DISTINCT r.pv FROM pv_reports r INNER JOIN events e ON e.id=r.event_id WHERE e.status='ready' ORDER BY r.pv",
    )
    return rows.map(row => row.pv)
  }

  async eventsForPv(pv: string): Promise<{ id: number; name: string; createdAt: string }[]> {
    const [rows] = await this.pool.execute<(RowDataPacket & { id: number; name: string; created_at: Date | string })[]>(
      "SELECT e.id, e.name, e.created_at FROM events e INNER JOIN pv_reports r ON r.event_id=e.id WHERE e.status='ready' AND r.pv=? ORDER BY e.id DESC",
      [pv],
    )
    return rows.map(row => ({
      id: Number(row.id), name: row.name,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    }))
  }

  async getReport(eventId: number, pv: string): Promise<PvReport | null> {
    const [rows] = await this.pool.execute<ReportRow[]>('SELECT report FROM pv_reports WHERE event_id=? AND pv=?', [eventId, pv])
    if (!rows[0]) return null
    return typeof rows[0].report === 'string' ? JSON.parse(rows[0].report) as PvReport : rows[0].report as PvReport
  }

  async getFile(eventId: number, pv: string): Promise<Buffer | null> {
    const [rows] = await this.pool.execute<ReportRow[]>('SELECT xlsx FROM pv_reports WHERE event_id=? AND pv=?', [eventId, pv])
    return rows[0]?.xlsx ? Buffer.from(rows[0].xlsx) : null
  }

  async deleteEvent(eventId: number): Promise<boolean> {
    const [result] = await this.pool.execute<mysql.ResultSetHeader>('DELETE FROM events WHERE id=?', [eventId])
    return result.affectedRows > 0
  }

  async close(): Promise<void> { await this.pool.end() }
}
