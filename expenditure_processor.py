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
from datetime import timedelta, datetime, timezone
import pytz
from concurrent.futures import ThreadPoolExecutor, as_completed
import os

# ---------------------------
# CONFIG: Facebook Ads
# ---------------------------
FB_ACCESS_TOKEN = "EAAN8qATZA7ecBRPNvhZCvZC6hv0POXgZCRHjATrVwldNdoyI4col4moMf1uh01hCSXCTI0Mtafr1RenrfeArFCaysuUhKl6jN5jxhpr0D06oD4xxXKrEUd5W9ZCDqoyPjmspo8DTcceiRVWmLS1rAwITUbbxUbzLovMblc3mnwm7eo7jg0gV5SkeXWAX69o3pgi0nQdZBU"
FB_API_VERSION = "v19.0"
FB_BASE_URL = f"https://graph.facebook.com/{FB_API_VERSION}"
FB_FIELDS_INSIGHTS = "account_id,ad_id,ad_name,adset_id,adset_name,campaign_name,impressions,spend,clicks,actions,date_start,date_stop"
FB_EXCHANGE_RATE = 7.8

# Cuentas con moneda
FB_AD_ACCOUNTS = [
    {"id": "act_277464379553028", "currency": "GTQ"},
    # {"id": "", "currency": "USD"}
]

# ---------------------------
# Backend Functions
# ---------------------------
def fb_api_get(url, params):
    params["access_token"] = FB_ACCESS_TOKEN
    try:
        r = requests.get(url, params=params, timeout=30)
        return r.json()
    except: return {}

def obtener_paginas_autorizadas():
    names, url, params = {}, f"{FB_BASE_URL}/me/accounts", {"limit": 100}
    while True:
        js = fb_api_get(url, params)
        if "data" not in js: break
        for item in js["data"]:
            pid, pname = str(item.get("id")), item.get("name")
            if pid and pname: names[pid] = pname
        if "paging" in js and "next" in js["paging"]: url, params = js["paging"]["next"], {}
        else: break
    return names

def obtener_creatives(ad_ids):
    creative_map = {}
    for i in range(0, len(ad_ids), 50):
        block = ad_ids[i:i+50]
        batch = [{"method": "GET", "relative_url": f"{aid}?fields=creative"} for aid in block]
        r = requests.post(f"{FB_BASE_URL}/", data={"access_token": FB_ACCESS_TOKEN, "batch": json.dumps(batch)})
        responses = r.json()
        if not isinstance(responses, list): continue
        for resp in responses:
            if resp.get("code") != 200: continue
            body = json.loads(resp.get("body", "{}"))
            ad_id, creative_id = body.get("id"), body.get("creative", {}).get("id")
            if ad_id and creative_id: creative_map[str(ad_id)] = str(creative_id)
    return creative_map

def obtener_paginas_de_creatives(creative_ids):
    page_map = {}
    for i in range(0, len(creative_ids), 50):
        block = creative_ids[i:i+50]
        batch = [{"method": "GET", "relative_url": f"{cid}?fields=object_story_spec,actor_id,effective_object_story_id"} for cid in block]
        r = requests.post(f"{FB_BASE_URL}/", data={"access_token": FB_ACCESS_TOKEN, "batch": json.dumps(batch)})
        responses = r.json()
        if not isinstance(responses, list): continue
        for resp in responses:
            if resp.get("code") != 200: continue
            body = json.loads(resp.get("body", "{}"))
            cid, oss, actor_id, post_id = body.get("id"), body.get("object_story_spec", {}), body.get("actor_id"), body.get("effective_object_story_id")
            page_id = oss.get("page_id") or oss.get("page", {}).get("id") or oss.get("link_data", {}).get("page_id") or oss.get("video_data", {}).get("page_id")
            if not page_id and post_id and "_" in post_id: page_id = post_id.split("_")[0]
            final_p_id = str(page_id) if page_id else (str(actor_id) if actor_id else None)
            if final_p_id: page_map[str(cid)] = final_p_id
    return page_map

def fetch_insights_account(acc, start_date, end_date, log_callback):
    acc_id, currency = acc["id"], acc["currency"]
    if not acc_id: return []
    log_callback(f"Extrayendo FB: {acc_id} ({currency})...")
    url = f"{FB_BASE_URL}/{acc_id}/insights"
    params = {
        "fields": FB_FIELDS_INSIGHTS,
        "level": "ad",
        "limit": 500,
        "time_range": json.dumps({"since": start_date, "until": end_date}),
        "time_increment": 1,
        "filtering": '[{"field":"spend","operator":"GREATER_THAN","value":0}]'
    }
    insights = []
    while True:
        js = fb_api_get(url, params)
        if "data" not in js: break
        for item in js["data"]:
            item["account_currency"] = currency
            insights.append(item)
        if "paging" in js and "next" in js["paging"]: url, params = js["paging"]["next"], {}
        else: break
    return insights

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
        super().__init__(); self.title("DUPAZA EXPENDITURE PRO"); self.geometry("420x650"); cctk.set_appearance_mode("dark"); cctk.set_default_color_theme("blue")
        self.grid_columnconfigure(0, weight=1); self.grid_rowconfigure(1, weight=1)
        header = cctk.CTkFrame(self, height=45, corner_radius=0); header.grid(row=0, column=0, sticky="ew")
        cctk.CTkLabel(header, text="💰 DUPAZA GASTO", font=("Segoe UI", 18, "bold")).pack(pady=8)
        body = cctk.CTkFrame(self, fg_color="transparent"); body.grid(row=1, column=0, sticky="nsew", padx=20, pady=20)
        body.grid_columnconfigure(0, weight=1)
        self.range_picker = FloatingRangePicker(body, "PERIODO DE GASTO"); self.range_picker.grid(row=0, column=0, pady=10, sticky="ew")
        self.process_btn = cctk.CTkButton(self, text="🚀 PROCESAR GASTO FB", height=45, font=("Segoe UI", 14, "bold"), corner_radius=10, command=self.start_process); self.process_btn.grid(row=2, column=0, pady=20, padx=30, sticky="ew")
        logs_frame = cctk.CTkFrame(self, height=120, corner_radius=10); logs_frame.grid(row=3, column=0, sticky="ew", padx=20, pady=(0,20))
        self.console = cctk.CTkTextbox(logs_frame, height=100, font=("Consolas", 10)); self.console.pack(fill="both", expand=True, padx=5, pady=5); self.log("SISTEMA LISTO.")

    def log(self, txt):
        hour = datetime.now().strftime("%H:%M:%S")
        self.console.configure(state="normal"); self.console.insert("end", f"[{hour}] {txt}\n"); self.console.see("end"); self.console.configure(state="disabled")

    def generate_html_dashboard(self, df):
        self.log("Generando Dashboard de Gasto...")
        df_json = df.copy()
        df_json['Fecha'] = df_json['Fecha'].apply(lambda x: x.isoformat() if hasattr(x, 'isoformat') else str(x))
        data_json = df_json.to_dict(orient="records")

        html_template = f"""
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Dashboard de Gasto FB - DUPAZA</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        .card {{ background: white; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); padding: 20px; }}
        .kpi-val {{ font-size: 28px; font-weight: bold; color: #1890ff; }}
    </style>
</head>
<body class="bg-slate-50 p-6">
    <div class="max-w-7xl mx-auto">
        <header class="flex justify-between items-center mb-8">
            <h1 class="text-4xl font-extrabold text-slate-900">💰 DASHBOARD DE GASTO</h1>
            <div class="text-sm text-slate-500 font-medium">Actualizado: {datetime.now().strftime('%d/%m/%Y %H:%M')}</div>
        </header>

        <!-- Filtros -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 card">
            <div>
                <label class="block text-sm font-semibold text-slate-700 mb-2">Página</label>
                <select id="filter-p" class="w-full border-slate-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500">
                    <option value="ALL">Todas las Páginas</option>
                </select>
            </div>
            <div>
                <label class="block text-sm font-semibold text-slate-700 mb-2">Secuencia</label>
                <select id="filter-s" class="w-full border-slate-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500">
                    <option value="ALL">Todas las Secuencias</option>
                </select>
            </div>
            <div>
                <label class="block text-sm font-semibold text-slate-700 mb-2">Campaña</label>
                <select id="filter-c" class="w-full border-slate-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500">
                    <option value="ALL">Todas las Campañas</option>
                </select>
            </div>
        </div>

        <!-- KPIs -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div class="card text-center">
                <div class="text-slate-500 text-sm font-bold uppercase mb-1">Gasto Total (GTQ)</div>
                <div id="kpi-gasto" class="kpi-val">Q 0.00</div>
            </div>
            <div class="card text-center">
                <div class="text-slate-500 text-sm font-bold uppercase mb-1">Total Mensajes</div>
                <div id="kpi-msj" class="kpi-val">0</div>
            </div>
            <div class="card text-center">
                <div class="text-slate-500 text-sm font-bold uppercase mb-1">Costo por Lead (CPL)</div>
                <div id="kpi-cpl" class="kpi-val">Q 0.00</div>
            </div>
            <div class="card text-center">
                <div class="text-slate-500 text-sm font-bold uppercase mb-1">Campañas Activas</div>
                <div id="kpi-camps" class="kpi-val">0</div>
            </div>
        </div>

        <!-- Gráficos -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <div class="card">
                <h3 class="text-xl font-bold mb-6 text-slate-800">Inversión por Secuencia</h3>
                <div id="chart-secuencias" style="height: 400px;"></div>
            </div>
            <div class="card">
                <h3 class="text-xl font-bold mb-6 text-slate-800">Gasto por Día</h3>
                <div id="chart-gasto-dia" style="height: 400px;"></div>
            </div>
        </div>

        <div class="card">
            <h3 class="text-xl font-bold mb-6 text-slate-800">Top 10 Anuncios por Gasto</h3>
            <div id="chart-top-anuncios" style="height: 450px;"></div>
        </div>
    </div>

    <script>
        const rawData = {json.dumps(data_json)};

        function init() {{
            const ps = [...new Set(rawData.map(d => d.Pagina))].sort();
            const ss = [...new Set(rawData.map(d => d.Secuencia))].sort();
            const cs = [...new Set(rawData.map(d => d.Campaña))].sort();

            const pop = (id, l) => {{
                const el = document.getElementById(id);
                l.forEach(i => {{
                    const o = document.createElement('option');
                    o.value = i; o.textContent = i;
                    el.appendChild(o);
                }});
            }};

            pop('filter-p', ps);
            pop('filter-s', ss);
            pop('filter-c', cs);

            document.querySelectorAll('select').forEach(el => el.addEventListener('change', update));
        }}

        function update() {{
            const p = document.getElementById('filter-p').value;
            const s = document.getElementById('filter-s').value;
            const c = document.getElementById('filter-c').value;

            const filtered = rawData.filter(d =>
                (p === 'ALL' || d.Pagina === p) &&
                (s === 'ALL' || d.Secuencia === s) &&
                (c === 'ALL' || d.Campaña === c)
            );

            const totalGasto = filtered.reduce((acc, curr) => acc + (parseFloat(curr.Gasto) || 0), 0);
            const totalMsj = filtered.reduce((acc, curr) => acc + (parseInt(curr.Mensajes1) || 0), 0);
            const uniqueCamps = new Set(filtered.map(d => d.Campaña)).size;

            document.getElementById('kpi-gasto').textContent = 'Q ' + totalGasto.toLocaleString(undefined, {{minimumFractionDigits: 2}});
            document.getElementById('kpi-msj').textContent = totalMsj.toLocaleString();
            document.getElementById('kpi-cpl').textContent = 'Q ' + (totalMsj > 0 ? (totalGasto/totalMsj).toFixed(2) : '0.00');
            document.getElementById('kpi-camps').textContent = uniqueCamps;

            render(filtered);
        }}

        function render(data) {{
            // Secuencias
            const sMap = data.reduce((acc, curr) => {{
                acc[curr.Secuencia] = (acc[curr.Secuencia] || 0) + parseFloat(curr.Gasto);
                return acc;
            }}, {{}});
            const sSorted = Object.entries(sMap).sort((a,b) => a[1] - b[1]);

            Plotly.newPlot('chart-secuencias', [{{
                y: sSorted.map(x => x[0]),
                x: sSorted.map(x => x[1]),
                type: 'bar',
                orientation: 'h',
                marker: {{color: '#1890ff'}}
            }}], {{margin: {{t:0, l:150}}, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)'}});

            // Gasto por día
            const dMap = data.reduce((acc, curr) => {{
                acc[curr.Fecha] = (acc[curr.Fecha] || 0) + parseFloat(curr.Gasto);
                return acc;
            }}, {{}});
            const dKeys = Object.keys(dMap).sort();

            Plotly.newPlot('chart-gasto-dia', [{{
                x: dKeys,
                y: dKeys.map(k => dMap[k]),
                type: 'scatter',
                mode: 'lines+markers',
                line: {{color: '#f5222d'}}
            }}], {{margin: {{t:20}}, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)'}});

            // Top Anuncios
            const aMap = data.reduce((acc, curr) => {{
                acc[curr.Anuncio1] = (acc[curr.Anuncio1] || 0) + parseFloat(curr.Gasto);
                return acc;
            }}, {{}});
            const aSorted = Object.entries(aMap).sort((a,b) => b[1] - a[1]).slice(0, 10);

            Plotly.newPlot('chart-top-anuncios', [{{
                x: aSorted.map(x => x[0]),
                y: aSorted.map(x => x[1]),
                type: 'bar',
                marker: {{color: '#722ed1'}}
            }}], {{margin: {{t:20, b:150}}, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)'}});
        }}

        init();
        update();
    </script>
</body>
</html>
        """
        with open("dashboard_gasto_fb.html", "w", encoding="utf-8") as f:
            f.write(html_template)
        self.log("Dashboard generado: dashboard_gasto_fb.html")

    def start_process(self):
        if not all([self.range_picker.start_date, self.range_picker.end_date]):
            messagebox.showwarning("Atención", "Elija el rango de fechas."); return
        self.process_btn.configure(state="disabled", text="⌛ EXTRAYENDO..."); threading.Thread(target=self.execute_logic, daemon=True).start()

    def execute_logic(self):
        try:
            start_date = self.range_picker.start_date.strftime("%Y-%m-%d")
            end_date = self.range_picker.end_date.strftime("%Y-%m-%d")
            self.log(f"Extrayendo desde {start_date} hasta {end_date}...")

            all_insights = []
            with ThreadPoolExecutor(max_workers=5) as ex:
                futures = [ex.submit(fetch_insights_account, acc, start_date, end_date, self.log) for acc in FB_AD_ACCOUNTS]
                for f in as_completed(futures): all_insights.extend(f.result())

            if not all_insights:
                self.log("Sin datos."); return

            self.log("Obteniendo metadatos...")
            ad_ids = list({item["ad_id"] for item in all_insights})
            creative_map = obtener_creatives(ad_ids)
            page_map_ids = obtener_paginas_de_creatives(list(set(creative_map.values())))
            all_page_names = obtener_paginas_autorizadas()

            missing_pids = list(set(page_map_ids.values()) - set(all_page_names.keys()))
            if missing_pids:
                for i in range(0, len(missing_pids), 50):
                    block = missing_pids[i:i+50]
                    batch = [{"method": "GET", "relative_url": f"{pid}?fields=name"} for pid in block]
                    r = requests.post(f"{FB_BASE_URL}/", data={"access_token": FB_ACCESS_TOKEN, "batch": json.dumps(batch)})
                    for resp in r.json():
                        if resp.get("code") == 200:
                            body = json.loads(resp.get("body", "{}"))
                            all_page_names[str(body.get("id"))] = body.get("name", "Sin Nombre")

            self.log("Transformando (Lógica PQ)...")
            data = []
            for item in all_insights:
                aid = item["ad_id"]
                cid = creative_map.get(aid)
                pid = page_map_ids.get(cid)
                pname = all_page_names.get(pid, "Desconocida")

                spend = float(item["spend"])
                if item["account_currency"] == "USD": spend *= FB_EXCHANGE_RATE

                msgs = 0
                for action in item.get("actions", []):
                    if action["action_type"] == "onsite_conversion.messaging_conversation_started_7d":
                        msgs = int(action["value"])

                data.append({
                    "Pagina1": pname,
                    "Campaña": item["campaign_name"],
                    "Anuncio1": item["ad_name"],
                    "Fecha": item["date_start"],
                    "Mensajes1": msgs,
                    "Gasto": spend
                })

            df = pd.DataFrame(data)
            df['Pagina'] = df['Pagina1'].apply(lambda x: "La Muebleria." if "La Mueblería" in str(x) else x)
            df['Pagina'] = df['Pagina'].astype(str).str.strip().str.upper()
            df['Anuncio1'] = df['Anuncio1'].astype(str).str.strip().str.upper()
            df['Fecha'] = pd.to_datetime(df['Fecha']).dt.date

            df = df[df['Fecha'] > datetime(2025, 11, 30).date()]
            df['Anuncio'] = df['Anuncio1'].apply(lambda x: x.split(".")[0] if "." in x else x)

            def map_secuencia(camp):
                c = str(camp).upper()
                if c.startswith("NEW INTERSOFT BLACK"): return "DHOGDOR"
                if c.startswith("CAMAPAÑA KING VERANO"): return "DHOGDOR"
                if c.startswith("DOFLIQ"): return "DOFLIQ"
                if c.startswith("N"): return "DHOGDOR"
                if c.startswith("INMTERSOFT QUEEN OLD PRICE"): return "DHOGDOR"
                if c.startswith("DHOGDOR"): return "DHOGDOR"
                if c.startswith("DELCAM"): return "DELCAM"
                if c.startswith("Q2999"): return "DHOGDOR"
                if c.startswith("ALBUM DE POST"): return "DHOGDOR"
                if c.startswith("Q"): return "DHOGDOR"
                if c.startswith("I"): return "DHOGDOR"
                if c.startswith("K"): return "DHOGDOR"
                if c.startswith("C"): return "DHOGDOR"
                if c.startswith("R1 DHOGDOR.R1"): return "DHOGDOR"
                if c.startswith("R1 DOFLIQWA"): return "DOFLIQ"
                if c.startswith("R1 DELCAM.R1"): return "DELCAM"
                if c.startswith("R1TEMP.MAMA.D.H.R1"): return "DHOGDOR"
                if c.startswith("R1 CAMALIQ.L00I00Q19"): return "DOFLIQ"
                if c.startswith("R3.DFULLS.R32"): return "DFULLS"
                if c.startswith("R2.DDOR.R2"): return "DDOR"
                if c.startswith("R3.1"): return "R3.1"
                if c.startswith("R1.3"): return "R1.3"
                if c.startswith("R1.1"): return "R1.1"
                if c.startswith("R2.1"): return "R2.1"
                if c.startswith("R1.2"): return "R1.2"
                if c.startswith("R1.4"): return "R1.4"
                if c.startswith("QUEEN VERANO"): return "DHOGDOR"
                return "OTRO"

            df['Secuencia'] = df['Campaña'].apply(map_secuencia)
            df['Anuncio'] = df['Anuncio'].apply(lambda x: x.split(" ")[0])
            df['ANUNCIOSECUENCIA'] = df['Anuncio'].astype(str) + df['Secuencia'].astype(str)

            for col in df.select_dtypes(include=['datetime64[ns, UTC]', 'datetime64[ns, America/Guatemala]']).columns:
                df[col] = df[col].dt.tz_localize(None)

            fn = f"reporte_gasto_fb_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
            df.to_excel(fn, index=False); self.log(f"Excel: {fn}")
            self.generate_html_dashboard(df)
            self.log("ÉXITO."); self.after(0, lambda: messagebox.showinfo("ÉXITO", "Gasto procesado."))
        except Exception as e:
            self.log(f"Error: {e}")
        finally:
            self.after(0, lambda: self.process_btn.configure(state="normal", text="🚀 PROCESAR GASTO FB"))

if __name__ == "__main__":
    app = App()
    app.mainloop()
