#!/usr/bin/env python3
"""
Resumen de ventas y propinas por punto de venta y terminal
==========================================================

Uso:
  # 1) Todos los puntos de venta (resumen + desglose por terminal + órdenes)
  python resumen_propinas.py REGISTROS.xlsx

  # 2) Un punto de venta: matriz terminal x producto + propinas
  python resumen_propinas.py REGISTROS.xlsx --pv "BARRA 5 STAGE 2 ALCOHOL"

  # 3) Igual que (2) y además valida contra tu archivo de ventas por terminal
  python resumen_propinas.py REGISTROS.xlsx --pv "BARRA 5 STAGE 2 ALCOHOL" \
         --ventas Ventas_por_terminal_barra_5.xlsx

  Opciones: --salida carpeta/archivo.xlsx   --sin-recalculo

REGISTROS.xlsx debe traer las hojas:
  DATA                     (OrderId, Propina, Monto Total Productos, Fecha, ...)
  DATA-PRODUCT-POINT-SALE  (OrderId, PointSaleName, ProductName, Cantidad, Monto Total Productos)
  DATA-PRODUCT-PAYMENT     (OrderId, TerminalId)
La terminal NO viene junto a la propina: se cruza por OrderId.

Requisitos: pandas, openpyxl y (opcional) LibreOffice para guardar los valores
calculados de las fórmulas.
"""
import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter as L

# ---------- formato ----------
HDR = PatternFill("solid", fgColor="1F4E78")
HDR_F = Font(bold=True, color="FFFFFF")
TOT = PatternFill("solid", fgColor="DDEBF7")
M0 = '$#,##0;[Red]-$#,##0;"-"'        # el "-" en ceros es formato, no texto
M2 = '$#,##0.00;[Red]-$#,##0.00;"-"'
N0 = '#,##0;-#,##0;"-"'
PCT = "0.0%"


def norm(s):
    """Clave de comparación: sin espacios dobles ni mayúsculas (no cambia el nombre mostrado)."""
    return re.sub(r"\s+", " ", str(s).strip()).upper()


def estilo(ws, anchos, congelar="B2", filtro=None):
    for c in ws[1]:
        c.fill, c.font = HDR, HDR_F
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 32
    ws.freeze_panes = congelar
    for i, w in enumerate(anchos, 1):
        ws.column_dimensions[L(i)].width = w
    if filtro:
        ws.auto_filter.ref = filtro


def fila_total(ws, fila):
    for c in ws[fila]:
        c.font, c.fill = Font(bold=True), TOT


# ---------- lectura y cruce ----------
def leer(registros):
    x = pd.read_excel(registros, sheet_name=["DATA", "DATA-PRODUCT-POINT-SALE", "DATA-PRODUCT-PAYMENT"])
    return x["DATA"], x["DATA-PRODUCT-POINT-SALE"], x["DATA-PRODUCT-PAYMENT"]


def cruzar(d, ps, pp, avisos):
    """Una fila por orden con punto de venta, terminal, unidades, venta y propina."""
    # terminal por orden
    t_por_orden = pp.dropna(subset=["TerminalId"]).groupby("OrderId").TerminalId.agg(lambda s: sorted(set(s)))
    varias = t_por_orden[t_por_orden.str.len() > 1]
    if len(varias):
        avisos.append(f"{len(varias)} órdenes con más de una terminal (se usó la primera).")
    term = t_por_orden.str[0]
    # punto de venta por orden
    pv_por_orden = ps.groupby("OrderId").PointSaleName.agg(lambda s: sorted(set(s)))
    varios = pv_por_orden[pv_por_orden.str.len() > 1]
    if len(varios):
        avisos.append(f"{len(varios)} órdenes con más de un punto de venta (se usó el primero).")
    pv = pv_por_orden.str[0]
    unidades = ps.groupby("OrderId").Cantidad.sum()

    o = d[["OrderId", "Fecha", "Monto Total Productos", "Propina", "Monto Total Orden"]].copy()
    if o.OrderId.duplicated().any():
        avisos.append(f"{o.OrderId.duplicated().sum()} OrderId repetidos en DATA (se dejó la primera fila).")
        o = o.drop_duplicates("OrderId")
    o["PV"] = o.OrderId.map(pv)
    o["T"] = o.OrderId.map(term)
    o["U"] = o.OrderId.map(unidades)
    sin_pv, sin_t = o.PV.isna().sum(), o["T"].isna().sum()
    if sin_pv:
        avisos.append(f"{sin_pv} órdenes sin punto de venta.")
    if sin_t:
        avisos.append(f"{sin_t} órdenes sin terminal.")
    o = o.fillna({"PV": "(sin punto de venta)", "T": "(sin terminal)", "U": 0})
    canc = (o["T"].str.upper() == "CANCELADO").sum()
    if canc:
        avisos.append(f"{canc} órdenes con terminal 'CANCELADO' (unidades y montos negativos); se incluyen tal cual.")
    return o


# ---------- modo 1: todos los puntos de venta ----------
def libro_todos(o, ruta):
    o = o.sort_values(["PV", "T", "Fecha"]).reset_index(drop=True)
    n = len(o) + 1
    vt = o.groupby("PV")["Monto Total Productos"].sum().sort_values(ascending=False)
    orden_pv = {p: i for i, p in enumerate(vt.index)}
    c = o.groupby(["PV", "T"])["Monto Total Productos"].sum().reset_index()
    c["o"] = c.PV.map(orden_pv)
    c = c.sort_values(["o", "Monto Total Productos"], ascending=[True, False])

    wb = Workbook()
    w1 = wb.active
    w1.title = "Resumen por punto de venta"
    w2 = wb.create_sheet("Por punto de venta y terminal")
    w3 = wb.create_sheet("Órdenes")

    w3.append(["OrderId", "Punto de Venta", "Terminal", "Fecha", "Unidades",
               "Total sin propina", "Propina", "Total con propina"])
    for r in o.itertuples(index=False):
        w3.append([r.OrderId, r.PV, r.T, r.Fecha, float(r.U),
                   float(r[2]), float(r.Propina), float(r[4])])
    for i in range(2, n + 1):
        w3.cell(i, 5).number_format = N0
        for j in (6, 7, 8):
            w3.cell(i, j).number_format = M2
    estilo(w3, [40, 34, 20, 22, 10, 16, 12, 16], filtro=f"A1:H{n}")

    def rg(col):
        return f"Órdenes!${col}$2:${col}${n}"

    enc = ["Punto de Venta", "Terminales", "Órdenes", "Unidades", "Total sin propina",
           "Propina", "Total con propina", "Propina % de venta"]
    w1.append(enc)
    k = len(vt)
    for i, p in enumerate(vt.index, 2):
        w1.cell(i, 1, p)
        w1.cell(i, 2, f"=COUNTIFS('Por punto de venta y terminal'!$A:$A,$A{i})")
        w1.cell(i, 3, f"=COUNTIFS({rg('B')},$A{i})")
        for j, col in ((4, "E"), (5, "F"), (6, "G"), (7, "H")):
            w1.cell(i, j, f"=SUMIFS({rg(col)},{rg('B')},$A{i})")
        w1.cell(i, 8, f"=IF(E{i}=0,0,F{i}/E{i})")
    t = k + 2
    w1.cell(t, 1, "TOTAL")
    for j in range(2, 8):
        w1.cell(t, j, f"=SUM({L(j)}2:{L(j)}{k + 1})")
    w1.cell(t, 8, f"=IF(E{t}=0,0,F{t}/E{t})")
    fmts = {2: N0, 3: N0, 4: N0, 5: M0, 6: M2, 7: M2, 8: PCT}
    for i in range(2, t + 1):
        for j, f in fmts.items():
            w1.cell(i, j).number_format = f
    fila_total(w1, t)
    estilo(w1, [36, 11, 10, 11, 16, 14, 16, 12])

    w2.append(["Punto de Venta", "Terminal", "Órdenes", "Unidades", "Total sin propina",
               "Propina", "Total con propina", "Propina % de venta"])
    m = len(c)
    for i, r in enumerate(c.itertuples(index=False), 2):
        w2.cell(i, 1, r.PV)
        w2.cell(i, 2, r.T)
        cr = f"{rg('B')},$A{i},{rg('C')},$B{i}"
        w2.cell(i, 3, f"=COUNTIFS({cr})")
        for j, col in ((4, "E"), (5, "F"), (6, "G"), (7, "H")):
            w2.cell(i, j, f"=SUMIFS({rg(col)},{cr})")
        w2.cell(i, 8, f"=IF(E{i}=0,0,F{i}/E{i})")
    t2 = m + 2
    w2.cell(t2, 1, "TOTAL")
    for j in range(3, 8):
        w2.cell(t2, j, f"=SUM({L(j)}2:{L(j)}{m + 1})")
    w2.cell(t2, 8, f"=IF(E{t2}=0,0,F{t2}/E{t2})")
    for i in range(2, t2 + 1):
        for j, f in {3: N0, 4: N0, 5: M0, 6: M2, 7: M2, 8: PCT}.items():
            w2.cell(i, j).number_format = f
    fila_total(w2, t2)
    estilo(w2, [36, 20, 10, 11, 16, 14, 16, 12], congelar="C2", filtro=f"A1:H{m + 1}")
    wb.save(ruta)

    return {"orden_pv": list(vt.index), "n_pv": k, "n_filas": m,
            "tot": (len(o), float(o.U.sum()), float(o["Monto Total Productos"].sum()), float(o.Propina.sum()))}


# ---------- modo 2: un punto de venta (matriz terminal x producto + propinas) ----------
def libro_pv(o, ps, pp, pv, ruta, ventas, avisos):
    exactos = sorted(ps.PointSaleName.dropna().unique())
    if pv not in exactos:
        parecidos = [p for p in exactos if norm(pv).split()[0] in norm(p)]
        sys.exit(f"Punto de venta '{pv}' no existe. Opciones parecidas: {parecidos or exactos}")

    ordenes_pv = o[o.PV == pv]
    lineas = ps[ps.PointSaleName == pv].copy()
    lineas["T"] = lineas.OrderId.map(ordenes_pv.set_index("OrderId")["T"])
    lineas["clave"] = lineas.ProductName.map(norm)
    nombre = lineas.drop_duplicates("clave").set_index("clave").ProductName  # primer nombre visto
    if lineas.groupby("clave").ProductName.nunique().gt(1).any():
        avisos.append("Hay productos con nombres que difieren solo por espacios/mayúsculas; se unificaron.")

    venta = lineas.pivot_table(index="T", columns="clave", values="Monto Total Productos", aggfunc="sum", fill_value=0)
    venta["TOTAL"] = venta.sum(axis=1)
    venta = venta.sort_values("TOTAL", ascending=False)
    prods = venta.drop(columns="TOTAL").sum().sort_values(ascending=False).index.tolist()
    propinas = ordenes_pv.groupby("T").Propina.sum().reindex(venta.index).fillna(0)

    wb = Workbook()
    ws = wb.active
    ws.title = "Venta por terminal ($)"
    # columnas finales: TOTAL SIN PROPINA | PROPINA | TOTAL CON PROPINA
    ws.append(["Terminal"] + [nombre[p] for p in prods] + ["TOTAL SIN PROPINA", "PROPINA", "TOTAL CON PROPINA"])
    for t, r in venta.iterrows():
        sin, prop = float(r["TOTAL"]), float(propinas[t])
        ws.append([t] + [float(r[p]) for p in prods] + [sin, prop, round(sin + prop, 2)])
    nf = len(venta) + 1
    ncol = len(prods) + 4          # última columna (TOTAL CON PROPINA)
    ws.append(["TOTAL"] + [round(sum(ws.cell(i, j).value for i in range(2, nf + 1)), 2) for j in range(2, ncol + 1)])
    for i in range(2, nf + 2):
        for j in range(2, len(prods) + 3):
            ws.cell(i, j).number_format = M0          # productos y TOTAL SIN PROPINA
        ws.cell(i, ncol - 1).number_format = M2       # PROPINA
        ws.cell(i, ncol).number_format = M2           # TOTAL CON PROPINA
        ws.cell(i, len(prods) + 2).font = Font(bold=True)
        ws.cell(i, ncol).font = Font(bold=True)
    fila_total(ws, nf + 1)
    estilo(ws, [20] + [15] * (len(prods) + 1) + [17, 14, 17])
    ws.row_dimensions[1].height = 45
    wb.save(ruta)

    res = {"terminales": len(venta), "productos": len(prods),
           "unidades": float(lineas.Cantidad.sum()), "venta": float(lineas["Monto Total Productos"].sum()),
           "propinas": float(ordenes_pv.Propina.sum())}

    # precios unitarios inconsistentes
    pu = lineas[lineas.Cantidad > 0].assign(pu=lambda x: (x["Monto Total Productos"] / x.Cantidad).round(4))
    incons = pu.groupby("clave").pu.nunique()
    incons = incons[incons > 1]
    if len(incons):
        avisos.append(f"Productos con precio unitario distinto: {', '.join(nombre[k] for k in incons.index)}")

    if ventas:
        validar(ventas, venta, res, avisos)
    return res


def validar(ruta, venta, res, avisos):
    """Compara la venta por terminal de los registros contra el archivo de ventas."""
    hojas = pd.read_excel(ruta, sheet_name=None)
    cols = ["Terminal", "Punto de Venta", "Numero de Unidades Vendidas", "Nombre de Producto Vendido", "Importe Vendido"]
    df = next((h for h in hojas.values() if all(c in h.columns for c in cols)), None)
    if df is None:
        avisos.append("No encontré en --ventas una hoja con las columnas esperadas; no se validó.")
        return
    df = df.dropna(subset=["Terminal"])
    df["Importe Vendido"] = pd.to_numeric(df["Importe Vendido"].astype(str).str.replace(r"[$,\s]", "", regex=True), errors="coerce")
    df = df[df["Importe Vendido"].notna()]
    por_t = df.groupby("Terminal")["Importe Vendido"].sum()
    u, v = df["Numero de Unidades Vendidas"].sum(), df["Importe Vendido"].sum()
    ok_tot = abs(u - res["unidades"]) < 0.5 and abs(v - res["venta"]) < 0.5
    dif = (por_t.reindex(venta.index.union(por_t.index)).fillna(0) - venta["TOTAL"].reindex(venta.index.union(por_t.index)).fillna(0)).abs()
    n_dif = int((dif > 0.5).sum())
    res["validacion"] = (f"archivo de ventas: {u:,.0f} unidades y ${v:,.2f} | registros: {res['unidades']:,.0f} y ${res['venta']:,.2f} | "
                         f"terminales con diferencia: {n_dif}")
    if not ok_tot or n_dif:
        avisos.append("NO coincide el archivo de ventas con los registros: " + res["validacion"])


# ---------- recálculo con LibreOffice ----------
def recalcular(ruta):
    so = shutil.which("soffice") or shutil.which("libreoffice")
    if not so:
        print("AVISO: no se encontró LibreOffice; el archivo no trae valores guardados en las fórmulas "
              "(se verá en blanco en Vista protegida/celular).")
        return False
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run([so, "--headless", "--convert-to", "xlsx", "--outdir", tmp, str(ruta)],
                       check=True, capture_output=True)
        shutil.copy(Path(tmp) / Path(ruta).name, ruta)
    return True


def verificar(ruta, avisos):
    """Que no haya fórmulas vacías ni errores tras el recálculo."""
    from openpyxl import load_workbook
    v = load_workbook(ruta, data_only=True)
    f = load_workbook(ruta)
    malos = 0
    for ws in f:
        if ws.title == "Órdenes":
            continue
        for fila in ws.iter_rows():
            for c in fila:
                if isinstance(c.value, str) and c.value.startswith("="):
                    val = v[ws.title][c.coordinate].value
                    if val is None or (isinstance(val, str) and val.startswith("#")):
                        malos += 1
    if malos:
        avisos.append(f"{malos} celdas con fórmula quedaron vacías o con error tras el recálculo.")
    return malos == 0


# ---------- principal ----------
def salida_libre(ruta, log=print):
    """Si el archivo está abierto en Excel (o no se puede escribir), guarda con la hora en el nombre."""
    from datetime import datetime
    ruta = Path(ruta)
    try:
        with open(ruta, "ab"):
            pass
        return ruta
    except PermissionError:
        nueva = ruta.with_name(f"{ruta.stem}_{datetime.now():%H%M%S}{ruta.suffix}")
        try:
            with open(nueva, "ab"):
                pass
        except PermissionError:
            sys.exit(f"No tengo permiso para guardar en la carpeta '{ruta.parent}'. Elige otra carpeta (por ejemplo Documentos o el Escritorio).")
        log(f"AVISO: '{ruta.name}' está abierto o bloqueado; se guardará como '{nueva.name}'.")
        return nueva


def ejecutar(registros, pv=None, ventas=None, salida=None, recalculo=True, log=print):
    """Hace todo el trabajo. La usan tanto la línea de comandos como la ventana (gui_resumen.py).
    Devuelve (ruta_del_archivo, lista_de_avisos)."""
    avisos = []
    log("Leyendo registros (puede tardar un poco)...")
    d, ps, pp = leer(registros)
    log("Cruzando órdenes, terminales y puntos de venta...")
    o = cruzar(d, ps, pp, avisos)

    if pv:
        salida = Path(salida or f"Venta_por_terminal_con_propinas_{re.sub(r'[^A-Za-z0-9]+', '_', pv)}.xlsx")
        salida = salida_libre(salida, log)
        res = libro_pv(o, ps, pp, pv, salida, ventas, avisos)
        log(f"Terminales: {res['terminales']} | Productos: {res['productos']} | "
            f"Unidades: {res['unidades']:,.0f} | Venta: ${res['venta']:,.2f} | Propinas: ${res['propinas']:,.2f}")
        if "validacion" in res:
            log("Validación: " + res["validacion"])
    else:
        salida = Path(salida or "Propinas_ventas_por_punto_de_venta.xlsx")
        salida = salida_libre(salida, log)
        res = libro_todos(o, salida)
        if recalculo:
            log("Recalculando con LibreOffice...")
            if recalcular(salida):
                verificar(salida, avisos)
        ordenes, u, v, p = res["tot"]
        log(f"Puntos de venta: {res['n_pv']} | Filas PV x terminal: {res['n_filas']} | Órdenes: {ordenes:,} | "
            f"Unidades: {u:,.0f} | Venta: ${v:,.2f} | Propinas: ${p:,.2f}")
    for x in avisos:
        log("AVISO: " + x)
    log(f"Archivo listo: {Path(salida).resolve()}")
    return Path(salida).resolve(), avisos


def puntos_de_venta(registros):
    """Lista de puntos de venta del archivo (para el menú de la ventana)."""
    ps = pd.read_excel(registros, sheet_name="DATA-PRODUCT-POINT-SALE", usecols=["PointSaleName"])
    return sorted(ps.PointSaleName.dropna().unique())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("registros")
    ap.add_argument("--pv", help="nombre EXACTO del punto de venta (modo matriz terminal x producto)")
    ap.add_argument("--ventas", help="archivo de ventas por terminal para validar (solo con --pv)")
    ap.add_argument("--salida")
    ap.add_argument("--sin-recalculo", action="store_true")
    a = ap.parse_args()
    ejecutar(a.registros, a.pv, a.ventas, a.salida, not a.sin_recalculo)


if __name__ == "__main__":
    main()
