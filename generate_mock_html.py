import pandas as pd
import json
import os
from datetime import datetime

# Logic extracted from expenditure_processor.py
def generate_exp_html(df):
    df_json = df.copy()
    df_json['Fecha'] = df_json['Fecha'].apply(lambda x: x.isoformat() if hasattr(x, 'isoformat') else str(x))
    data_json = df_json.to_dict(orient="records")

    html_template = f"""
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Mock Gasto FB</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-50 p-6">
    <div id="kpi-gasto" class="text-2xl font-bold">Q 0.00</div>
    <div id="chart-secuencias" style="height: 400px;"></div>
    <script>
        const rawData = {json.dumps(data_json)};
        document.getElementById('kpi-gasto').textContent = 'Q ' + rawData.reduce((acc, curr) => acc + (parseFloat(curr.Gasto) || 0), 0).toLocaleString();
    </script>
</body>
</html>
"""
    with open("mock_expenditure.html", "w", encoding="utf-8") as f:
        f.write(html_template)

# Logic extracted from sales_processor.py
def generate_sales_html(df):
    df_json = df.copy()
    for col in ['Fecha']:
        if col in df_json.columns:
            df_json[col] = df_json[col].apply(lambda x: x.isoformat() if hasattr(x, 'isoformat') else str(x))
    data_json = df_json.to_dict(orient="records")

    html_template = f"""
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Mock Ventas GHL</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-stone-50 p-6">
    <div id="kpi-venta" class="text-2xl font-bold">Q 0.00</div>
    <script>
        const rawData = {json.dumps(data_json)};
        document.getElementById('kpi-venta').textContent = 'Q ' + rawData.reduce((acc, curr) => acc + (parseFloat(curr['Valor del cliente potencial']) || 0), 0).toLocaleString();
    </script>
</body>
</html>
"""
    with open("mock_sales.html", "w", encoding="utf-8") as f:
        f.write(html_template)

if __name__ == "__main__":
    df_exp = pd.DataFrame([{"Pagina": "P1", "Secuencia": "S1", "Campaña": "C1", "Gasto": 500, "Mensajes1": 10, "Fecha": datetime.now(), "Anuncio1": "A1"}])
    df_sales = pd.DataFrame([{"secuencia": "S1", "asignado": "V1", "Valor del cliente potencial": 1000, "Fecha": datetime.now()}])
    generate_exp_html(df_exp)
    generate_sales_html(df_sales)
    print("HTML files generated.")
