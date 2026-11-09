#!/usr/bin/env python3
"""
Exporta los datos de un archivo de registros a JSON, junto con los resultados
"esperados" calculados por el programa de Python (resumen_propinas.py).
Sirve para comprobar que el servidor en TypeScript da EXACTAMENTE los mismos números.

Uso:  python tools/export_fixture.py REGISTROS.xlsx server/test/fixture.json
(resumen_propinas.py debe estar en la misma carpeta desde la que ejecutas, o en PYTHONPATH)
"""
import json
import sys
import warnings

warnings.filterwarnings("ignore")
import resumen_propinas as rp  # noqa: E402


def main(registros, salida):
    d, ps, pp = rp.leer(registros)
    avisos = []
    o = rp.cruzar(d, ps, pp, avisos)

    data = d[["OrderId", "Fecha", "Monto Total Productos", "Propina"]].rename(
        columns={"OrderId": "orderId", "Fecha": "fecha", "Monto Total Productos": "sinPropina", "Propina": "propina"}
    ).to_dict("records")
    lines = ps[["OrderId", "PointSaleName", "ProductName", "Cantidad", "Monto Total Productos"]].rename(
        columns={"OrderId": "orderId", "PointSaleName": "pv", "ProductName": "producto",
                 "Cantidad": "cantidad", "Monto Total Productos": "monto"}).to_dict("records")
    pays = pp[["OrderId", "TerminalId"]].rename(columns={"OrderId": "orderId", "TerminalId": "terminal"})
    pays = pays.astype(object).where(pays.notna(), None).to_dict("records")

    por_pv = {}
    for pv, g in o.groupby("PV"):
        por_pv[pv] = {"ordenes": int(len(g)), "unidades": float(g.U.sum()),
                      "sinPropina": round(float(g["Monto Total Productos"].sum()), 2),
                      "propina": round(float(g.Propina.sum()), 2),
                      "terminales": int(g["T"].nunique()),
                      "porTerminal": {t: {"sin": round(float(x["Monto Total Productos"].sum()), 2),
                                          "prop": round(float(x.Propina.sum()), 2)}
                                      for t, x in g.groupby("T")}}
    json.dump({"data": data, "lines": lines, "pays": pays,
               "expected": {"porPv": por_pv, "avisos": avisos}}, open(salida, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"Listo: {salida} ({len(por_pv)} puntos de venta)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])