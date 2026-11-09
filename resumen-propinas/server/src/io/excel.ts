// Punto único de importación de ExcelJS (funciona igual con tsx, Node ESM y Hostinger).
import * as ExcelNS from 'exceljs'
export const ExcelJS: typeof ExcelNS = (ExcelNS as any).default ?? ExcelNS
export type { CellValue } from 'exceljs'