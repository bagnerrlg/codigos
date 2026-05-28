import requests
import time
import json
import re
import pandas as pd
import threading
import tkinter as tk
from tkinter import messagebox
import customtkinter as cctk
from tkcalendar import Calendar
from datetime import datetime, timedelta, timezone, time as dt_time
import pytz
from concurrent.futures import ThreadPoolExecutor, as_completed
from html import unescape
import os

# ---------------------------
# CONFIG: GHL Cuentas
# ---------------------------
ACCOUNTS = [
    {
        "name": "DELCAM",
        "location_id": "xr5u7XYR7rI3m9JNlJm7",
        "stage_id": "8577c7cd-5d39-42b4-8edb-ab9bad534119",
        "custom_field": "zUnROtV5c6XbRM4ijUQ1", # Fecha de Venta
        "dataventa_id": "3poEeFSMyn2tPoCKe0Bl",
        "token": "pit-4f8ddf96-7153-4904-a9a9-8434abf9fd83"
    },
    {
        "name": "DHOGDOR",
        "location_id": "qLHT26aMDEKaZ3jGKF9F",
        "stage_id": "bea54a62-b0e8-48e6-a64d-8626319602c8",
        "custom_field": "2uieal4jZiRz3i32fmdr", # Fecha de Venta
        "dataventa_id": "GlbnwixnmUXj8CnEs9sG",
        "token": "pit-a8703b19-ab78-4354-90b8-ed4ab6bfe56e"
    },
    {
        "name": "DLIQF",
        "location_id": "xnCU3r4IN7gVAuZYx5JO",
        "stage_id": "374add3c-e3c3-4b86-a503-9040c407e4e8",
        "custom_field": "a2BH3MSK8ohUszAbW1OO", # Fecha de Venta
        "dataventa_id": "HUuNkuMdON8KJhm4PtAN",
        "token": "pit-7dade6f9-ef3e-4ffc-b6b6-9cdebd93289e"
    },
    {
        "name": "DFULLS",
        "location_id": "H3rzWYlQxzBlq3gDRhcC",
        "stage_id": "e576e613-1682-4266-8bfe-d6f86b32d97c",
        "custom_field": "Ek5F3WOOOe7X50a60R0O", # Fecha de Venta
        "dataventa_id": "TO0YPfPJWwaocuiCgbZg",
        "token": "pit-2f261215-2278-4f05-9205-fc9f9bb52681"
    },
    {
        "name": "DDOR",
        "location_id": "iT9FHUMSHYmFeGicxlwJ",
        "stage_id": "eeaee2fb-518f-4c78-a696-7cf815414c10",
        "custom_field": "jnAsOVx6j5wxeCHmz0q6", # Fecha de Venta
        "dataventa_id": "kiuo9rQwFoJDf2cEaUJz",
        "token": "pit-404b2e86-443d-46d4-9d89-63da57482598"
    }
]

API_VERSION_OPPS = "2023-02-21"
GUATEMALA_TZ = pytz.timezone("America/Guatemala")

# ---------------------------
# Backend Functions
# ---------------------------
def get_custom_value(field):
    if not field or not isinstance(field, dict): return ""
    v = field.get("fieldValueDate") or field.get("fieldValueString") or field.get("fieldValue") or field.get("value")
    if isinstance(val := v, list): return ", ".join(map(str, val))
    return str(val) if val is not None else ""

def get_custom_fields_map(location_id, token):
    url = f"https://services.leadconnectorhq.com/locations/{location_id}/customFields?model=opportunity"
    headers = {"Authorization": f"Bearer {token}", "Version": API_VERSION_OPPS, "Accept": "application/json"}
    try:
        r = requests.get(url, headers=headers, timeout=30)
        return {f.get("id"): f.get("name") for f in r.json().get("customFields", []) if isinstance(f, dict)}
    except: return {}

def get_users_by_location(location_id, token):
    url = f"https://services.leadconnectorhq.com/users/?locationId={location_id}"
    headers = {"Authorization": f"Bearer {token}", "Version": "2021-07-28", "Accept": "application/json"}
    try:
        r = requests.get(url, headers=headers, timeout=30)
        return {u.get("id"): f"{u.get('firstName','') or ''} {u.get('lastName','') or ''}".strip() or u.get("email", "Desconocido") for u in r.json().get("users", [])}
    except: return {}

def safe_post(url, token, payload, version):
    headers = {"Authorization": f"Bearer {token}", "Version": version, "Content-Type": "application/json"}
    for attempt in range(1, 6):
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=30)
            if r.status_code in (200, 201): return r.json()
            if r.status_code == 429: time.sleep(attempt * 2); continue
            return {"__error_status": r.status_code, "__error_text": r.text}
        except: time.sleep(attempt * 1.5); continue
    return {}

def fetch_sales_for_account(acc, start_date_iso, end_date_iso, log_callback):
    token, loc, stage, cfield, acc_name = acc["token"], acc["location_id"], acc["stage_id"], acc["custom_field"], acc["name"]
    log_callback(f"Extrayendo GHL: {acc_name}...")

    u_map = get_users_by_location(loc, token)
    cf_names = get_custom_fields_map(loc, token)
    all_opps, page = [], 1
    url = "https://services.leadconnectorhq.com/opportunities/search"

    # Preparar fechas para filtro API (ISO 8601)
    ghl_start = start_date_iso + "T00:00:00.000Z"
    ghl_end = end_date_iso + "T23:59:59.999Z"

    while True:
        payload = {
            "locationId": loc, "page": page, "limit": 100,
            "filters": [
                {"group": "AND", "filters": [
                    {"field": "pipeline_stage_id", "operator": "eq", "value": stage},
                    {"field": "status", "operator": "eq", "value": "won"},
                    {"field": f"custom_fields.{cfield}", "operator": "range", "value": {"gte": ghl_start, "lte": ghl_end}}
                ]}
            ]
        }
        res = safe_post(url, token, payload, API_VERSION_OPPS)
        if not res or (isinstance(res, dict) and res.get("__error_status")): break
        opps = res.get("opportunities", [])
        if not opps: break
        all_opps.extend(opps)
        page += 1
        if len(opps) < 100: break

    rows = []
    for op in all_opps:
        opp_cfs = op.get("customFields") or op.get("custom_fields") or []
        sale_date_iso, cf_data = "", {}
        for cf in opp_cfs:
            fid, val = cf.get("id"), get_custom_value(cf)
            if fid == cfield:
                # Intentar parsear fecha de venta
                if val: sale_date_iso = val[:10]
            fname = cf_names.get(fid, fid)
            cf_data[fname] = val

        # Filtrado exacto por fecha de venta
        if not sale_date_iso or not (start_date_iso <= sale_date_iso <= end_date_iso): continue

        row = {
            "secuencia": acc_name,
            "fase": op.get("pipelineStageName", "won"),
            "Valor del cliente potencial": op.get("monetaryValue", 0),
            "asignado": u_map.get(op.get("assignedTo"), ""),
            "Creado": op.get("createdAt"),
            "Ultimo Actualizado": op.get("updatedAt"),
            "Seguidores": "", "Notas": "", "etiquetas": ", ".join(op.get("tags", [])),
            "estado": op.get("status"),
            "Fecha": sale_date_iso,
            "ID de oportunidad": op.get("id", ""),
            "ID de contacto": op.get("contactId", ""),
            "Cliente": op.get("contact", {}).get("name", "")
        }
        row.update(cf_data)
        rows.append(row)
    return rows

# ---------------------------
# DATE PICKER
# ---------------------------
class FloatingRangePicker(cctk.CTkFrame):
    def __init__(self, parent, title):
        super().__init__(parent, corner_radius=12); self.start_date, self.end_date, self.pop = None, None, None
        cctk.CTkLabel(self, text=title, font=("Segoe UI", 16, "bold")).pack(anchor="w", padx=15, pady=(10,2))
        self.entry_frame = cctk.CTkFrame(self, fg_color="transparent"); self.entry_frame.pack(padx=15, pady=(2,10), fill="x")
        self.entry_start = cctk.CTkEntry(self.entry_frame, placeholder_text="Inicio", height=32, corner_radius=8, font=("Segoe UI", 11), justify="center", state="readonly"); self.entry_start.pack(side="left", expand=True, fill="x", padx=(0,2)); self.entry_start.bind("<Button-1>", lambda e: self.open_calendar(self.entry_start, "start"))
        cctk.CTkLabel(self.entry_frame, text="→", font=("Segoe UI", 12, "bold")).pack(side="left")
        self.entry_end = cctk.CTkEntry(self.entry_frame, placeholder_text="Fin", height=32, corner_radius=8, font=("Segoe UI", 11), justify="center", state="readonly"); self.entry_end.pack(side="left", expand=True, fill="x", padx=(2,0)); self.entry_end.bind("<Button-1>", lambda e: self.open_calendar(self.entry_end, "end"))

    def open_calendar(self, target_entry, date_type):
        if self.pop: self.close_calendar()
        self.update_idletasks(); self.pop = tk.Toplevel(self); self.pop.overrideredirect(True); self.pop.attributes("-topmost", True); self.pop.geometry(f"300x320+{target_entry.winfo_rootx()}+{target_entry.winfo_rooty() + 35}"); self.pop.grab_set()
        container = cctk.CTkFrame(self.pop, corner_radius=10, border_width=2, border_color="#76933C", fg_color="#ffffff"); container.pack(fill="both", expand=True)
        header = tk.Frame(container, bg="#ffffff", height=30); header.pack(fill="x", padx=8, pady=2)
        tk.Label(header, text="ELEGIR FECHA", font=("Segoe UI", 9, "bold"), fg="#333333", bg="#ffffff").pack(side="left")
        tk.Button(header, text="✕", font=("Arial", 9), bd=0, bg="#ffffff", command=self.close_calendar).pack(side="right")
        self.cal = Calendar(container, selectmode="day", date_pattern="yyyy-mm-dd", background='white', foreground='black', selectbackground='#1890ff', selectforeground='white', borderwidth=0); self.cal.pack(pady=5, padx=10, fill="both", expand=True)
        self.cal.bind("<<CalendarSelected>>", lambda e: self._on_date_selected(target_entry, date_type)); self.pop.focus_set()

    def close_calendar(self):
        if self.pop: self.pop.grab_release(); self.pop.destroy(); self.pop = None

    def _on_date_selected(self, target_entry, date_type):
        date_obj = datetime.strptime(self.cal.get_date(), "%Y-%m-%d").date()
        if date_type == "start": self.start_date = date_obj
        else: self.end_date = date_obj
        target_entry.configure(state="normal"); target_entry.delete(0, "end"); target_entry.insert(0, str(date_obj)); target_entry.configure(state="readonly"); self.after(200, self.close_calendar)

# ---------------------------
# APP
# ---------------------------
class App(cctk.CTk):
    def __init__(self):
        super().__init__(); self.title("DUPAZA SALES PRO"); self.geometry("420x650"); cctk.set_appearance_mode("dark"); cctk.set_default_color_theme("green")
        self.grid_columnconfigure(0, weight=1); self.grid_rowconfigure(1, weight=1)
        header = cctk.CTkFrame(self, height=45, corner_radius=0); header.grid(row=0, column=0, sticky="ew")
        cctk.CTkLabel(header, text="💰 DUPAZA VENTAS", font=("Segoe UI", 18, "bold")).pack(pady=8)
        body = cctk.CTkFrame(self, fg_color="transparent"); body.grid(row=1, column=0, sticky="nsew", padx=20, pady=20)
        body.grid_columnconfigure(0, weight=1)
        self.range_picker = FloatingRangePicker(body, "PERIODO DE VENTAS"); self.range_picker.grid(row=0, column=0, pady=10, sticky="ew")
        self.process_btn = cctk.CTkButton(self, text="🚀 PROCESAR VENTAS GHL", height=45, font=("Segoe UI", 14, "bold"), corner_radius=10, command=self.start_process); self.process_btn.grid(row=2, column=0, pady=20, padx=30, sticky="ew")
        logs_frame = cctk.CTkFrame(self, height=120, corner_radius=10); logs_frame.grid(row=3, column=0, sticky="ew", padx=20, pady=(0,20))
        self.console = cctk.CTkTextbox(logs_frame, height=100, font=("Consolas", 10)); self.console.pack(fill="both", expand=True, padx=5, pady=5); self.log("SISTEMA LISTO.")

    def log(self, txt):
        hour = datetime.now().strftime("%H:%M:%S")
        self.console.configure(state="normal"); self.console.insert("end", f"[{hour}] {txt}\n"); self.console.see("end"); self.console.configure(state="disabled")

    def generate_html_dashboard(self, df):
        self.log("Generando Dashboard de Ventas...")
        df_json = df.copy()
        # Convertir fechas a string para JSON
        for col in ['Fecha', 'Creado', 'Ultimo Actualizado']:
            if col in df_json.columns:
                df_json[col] = df_json[col].apply(lambda x: x.isoformat() if hasattr(x, 'isoformat') else str(x))

        data_json = df_json.to_dict(orient="records")

        html_template = f"""
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Dashboard de Ventas GHL - DUPAZA</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        .card {{ background: white; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); padding: 20px; }}
        .kpi-val {{ font-size: 28px; font-weight: bold; color: #76933C; }}
    </style>
</head>
<body class="bg-stone-50 p-6">
    <div class="max-w-7xl mx-auto">
        <header class="flex justify-between items-center mb-8">
            <h1 class="text-4xl font-extrabold text-stone-900">💰 DASHBOARD DE VENTAS</h1>
            <div class="text-sm text-stone-500 font-medium">Actualizado: {datetime.now().strftime('%d/%m/%Y %H:%M')}</div>
        </header>

        <!-- Filtros -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 card">
            <div>
                <label class="block text-sm font-semibold text-stone-700 mb-2">Secuencia</label>
                <select id="filter-s" class="w-full border-stone-300 rounded-lg shadow-sm focus:ring-green-500 focus:border-green-500">
                    <option value="ALL">Todas las Secuencias</option>
                </select>
            </div>
            <div>
                <label class="block text-sm font-semibold text-stone-700 mb-2">Vendedor</label>
                <select id="filter-v" class="w-full border-stone-300 rounded-lg shadow-sm focus:ring-green-500 focus:border-green-500">
                    <option value="ALL">Todos los Vendedores</option>
                </select>
            </div>
        </div>

        <!-- KPIs -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div class="card text-center">
                <div class="text-stone-500 text-sm font-bold uppercase mb-1">Venta Total (won)</div>
                <div id="kpi-venta" class="kpi-val">Q 0.00</div>
            </div>
            <div class="card text-center">
                <div class="text-stone-500 text-sm font-bold uppercase mb-1">Cantidad Órdenes</div>
                <div id="kpi-qty" class="kpi-val">0</div>
            </div>
            <div class="card text-center">
                <div class="text-stone-500 text-sm font-bold uppercase mb-1">Ticket Promedio</div>
                <div id="kpi-avg" class="kpi-val">Q 0.00</div>
            </div>
        </div>

        <!-- Gráficos -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <div class="card">
                <h3 class="text-xl font-bold mb-6 text-stone-800">Ventas por Vendedor (Top)</h3>
                <div id="chart-vendedores" style="height: 400px;"></div>
            </div>
            <div class="card">
                <h3 class="text-xl font-bold mb-6 text-stone-800">Ventas por Secuencia</h3>
                <div id="chart-secuencias" style="height: 400px;"></div>
            </div>
        </div>

        <div class="card">
            <h3 class="text-xl font-bold mb-6 text-stone-800">Tendencia de Venta por Día</h3>
            <div id="chart-tendencia" style="height: 400px;"></div>
        </div>
    </div>

    <script>
        const rawData = {json.dumps(data_json)};

        function init() {{
            const ss = [...new Set(rawData.map(d => d.secuencia))].sort();
            const vs = [...new Set(rawData.map(d => d.asignado))].sort();

            const pop = (id, l) => {{
                const el = document.getElementById(id);
                l.forEach(i => {{
                    const o = document.createElement('option');
                    o.value = i; o.textContent = i;
                    el.appendChild(o);
                }});
            }};

            pop('filter-s', ss);
            pop('filter-v', vs);

            document.querySelectorAll('select').forEach(el => el.addEventListener('change', update));
        }}

        function update() {{
            const s = document.getElementById('filter-s').value;
            const v = document.getElementById('filter-v').value;

            const filtered = rawData.filter(d =>
                (s === 'ALL' || d.secuencia === s) &&
                (v === 'ALL' || d.asignado === v)
            );

            const totalVenta = filtered.reduce((acc, curr) => acc + (parseFloat(curr['Valor del cliente potencial']) || 0), 0);
            const totalQty = filtered.length;

            document.getElementById('kpi-venta').textContent = 'Q ' + totalVenta.toLocaleString(undefined, {{minimumFractionDigits: 2}});
            document.getElementById('kpi-qty').textContent = totalQty.toLocaleString();
            document.getElementById('kpi-avg').textContent = 'Q ' + (totalQty > 0 ? (totalVenta/totalQty).toFixed(2) : '0.00');

            render(filtered);
        }}

        function render(data) {{
            // Vendedores
            const vMap = data.reduce((acc, curr) => {{
                acc[curr.asignado] = (acc[curr.asignado] || 0) + parseFloat(curr['Valor del cliente potencial']);
                return acc;
            }}, {{}});
            const vSorted = Object.entries(vMap).sort((a,b) => a[1] - b[1]);

            Plotly.newPlot('chart-vendedores', [{{
                y: vSorted.map(x => x[0]),
                x: vSorted.map(x => x[1]),
                type: 'bar',
                orientation: 'h',
                marker: {{color: '#76933C'}}
            }}], {{margin: {{t:0, l:150}}, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)'}});

            // Secuencias
            const sMap = data.reduce((acc, curr) => {{
                acc[curr.secuencia] = (acc[curr.secuencia] || 0) + parseFloat(curr['Valor del cliente potencial']);
                return acc;
            }}, {{}});

            Plotly.newPlot('chart-secuencias', [{{
                labels: Object.keys(sMap),
                values: Object.values(sMap),
                type: 'pie',
                hole: .4
            }}], {{margin: {{t:0}}, paper_bgcolor: 'rgba(0,0,0,0)'}});

            // Tendencia
            const dMap = data.reduce((acc, curr) => {{
                acc[curr.Fecha] = (acc[curr.Fecha] || 0) + parseFloat(curr['Valor del cliente potencial']);
                return acc;
            }}, {{}});
            const dKeys = Object.keys(dMap).sort();

            Plotly.newPlot('chart-tendencia', [{{
                x: dKeys,
                y: dKeys.map(k => dMap[k]),
                type: 'scatter',
                mode: 'lines+markers',
                line: {{color: '#76933C', width: 3}}
            }}], {{margin: {{t:20}}, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)'}});
        }}

        init();
        update();
    </script>
</body>
</html>
        """
        with open("dashboard_ventas_ghl.html", "w", encoding="utf-8") as f:
            f.write(html_template)
        self.log("Dashboard generado: dashboard_ventas_ghl.html")

    def start_process(self):
        if not all([self.range_picker.start_date, self.range_picker.end_date]):
            messagebox.showwarning("Atención", "Elija el rango de fechas."); return
        self.process_btn.configure(state="disabled", text="⌛ EXTRAYENDO..."); threading.Thread(target=self.execute_logic, daemon=True).start()

    def execute_logic(self):
        try:
            sd_iso = self.range_picker.start_date.strftime("%Y-%m-%d")
            ed_iso = self.range_picker.end_date.strftime("%Y-%m-%d")
            self.log(f"Extrayendo desde {sd_iso} hasta {ed_iso}...")

            all_raw = []
            with ThreadPoolExecutor(max_workers=5) as ex:
                futures = [ex.submit(fetch_sales_for_account, acc, sd_iso, ed_iso, self.log) for acc in ACCOUNTS]
                for f in as_completed(futures): all_raw.extend(f.result())

            if not all_raw:
                self.log("No se encontraron ventas en el periodo.")
                return

            self.log("Procesando transformaciones (Lógica PQ)...")
            df = pd.DataFrame(all_raw)

            # 1. Traducción Power Query (Primer Let): Tipo cambiado y Limpieza
            # #"Valor reemplazado" = Table.ReplaceValue(#"Tipo cambiado","-","",Replacer.ReplaceText,{"Telefono 1"})
            df['Telefono 1'] = df['Telefono 1'].astype(str).str.replace("-", "", regex=False)

            # #"Primeros caracteres extraídos" = Table.TransformColumns(#"Valor reemplazado", {{"ID de oportunidad", each Text.Start(_, 10), type text}})
            df['ID de oportunidad'] = df['ID de oportunidad'].astype(str).str[:10]

            # #"Texto limpio" = Table.TransformColumns(#"Primeros caracteres extraídos",{{"Cliente", Text.Clean, type text}})
            # #"Texto en mayúsculas" = Table.TransformColumns(#"Texto limpio",{{"Cliente", Text.Upper, type text}})
            df['Cliente'] = df['Cliente'].astype(str).str.strip().str.upper()

            # 2. Traducción Power Query (Segundo Let): Tipado de datos
            df['Valor del cliente potencial'] = pd.to_numeric(df['Valor del cliente potencial'], errors='coerce').fillna(0).astype(int)
            df['Creado'] = pd.to_datetime(df['Creado']).dt.date
            df['Ultimo Actualizado'] = pd.to_datetime(df['Ultimo Actualizado']).dt.date
            df['Fecha'] = pd.to_datetime(df['Fecha']).dt.date

            # Columnas numéricas (SKUs cantidades)
            for col in df.columns:
                if "Cantidad" in col:
                    df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0).astype(int)

            # 3. Quitar zonas horarias para Excel (Asegurar compatibilidad)
            for col in df.select_dtypes(include=['datetime64[ns, UTC]', 'datetime64[ns, America/Guatemala]']).columns:
                df[col] = df[col].dt.tz_localize(None)

            # Export
            fn = f"reporte_ventas_ghl_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
            df.to_excel(fn, index=False)
            self.log(f"ÉXITO: {fn}")

            # Generar Dashboard HTML Fase 3
            self.generate_html_dashboard(df)

        except Exception as e:
            self.log(f"Error: {e}")
        finally:
            self.after(0, lambda: self.process_btn.configure(state="normal", text="🚀 PROCESAR VENTAS GHL"))

if __name__ == "__main__":
    app = App(); app.mainloop()
