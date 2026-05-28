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
from datetime import datetime, timezone, time as dt_time
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
        "token": "pit-4f8ddf96-7153-4904-a9a9-8434abf9fd83",
        "secuencia_cf": "jn9YrPWrdPdP8XmPVk0T",
        "anuncio_cf": "ampRBMHMXgNhxJMRHl6v",
        "primer_mensaje_cf": "Os7V8p7EFy94syDxUMAx"
    },
    {
        "name": "DHOGDOR",
        "location_id": "qLHT26aMDEKaZ3jGKF9F",
        "token": "pit-a8703b19-ab78-4354-90b8-ed4ab6bfe56e",
        "secuencia_cf": "HHf1OJLjyeqh0xxPf16y",
        "anuncio_cf": "y45Yu0N6yovQFgAS6nG3",
        "primer_mensaje_cf": "n7q6BIlpfvTJm0MBe7VD"
    },
    {
        "name": "DLIQF",
        "location_id": "xnCU3r4IN7gVAuZYx5JO",
        "token": "pit-7dade6f9-ef3e-4ffc-b6b6-9cdebd93289e",
        "secuencia_cf": "2Ttu4OQ9Fk4qovroFPRN",
        "anuncio_cf": "QovmsXeWCad6fFcDchsM",
        "primer_mensaje_cf": "iIw3cwaAyqt32YwLdAKq"
    },
    {
        "name": "DFULLS",
        "location_id": "H3rzWYlQxzBlq3gDRhcC",
        "token": "pit-2f261215-2278-4f05-9205-fc9f9bb52681",
        "secuencia_cf": "jsWRYUovvEYgAKddWPly",
        "anuncio_cf": "kRzUfj5Hj43lH6yQdSXh",
        "primer_mensaje_cf": "m2js5X7kAHgjfBjqQhMI"
    },
    {
        "name": "DDOR",
        "location_id": "iT9FHUMSHYmFeGicxlwJ",
        "token": "pit-404b2e86-443d-46d4-9d89-63da57482598",
        "secuencia_cf": "QfBoKX5vsilncCaDejWU",
        "anuncio_cf": "dpzuI8cV2N9c85NRH5p4",
        "primer_mensaje_cf": "LMVWgaR6LDBdqr6K1rPE"
    }
]

API_VERSION_CONTACTS = "2021-07-28"
GUATEMALA_TZ = pytz.timezone("America/Guatemala")
ANUNCIO_REGEX = re.compile(r"([A-Z]\d{3,4}[A-Z]\d{3})", re.IGNORECASE)
SECUENCIA_REGEX = re.compile(r"([A-Z]\d\.\d)", re.IGNORECASE)

# ---------------------------
# Backend Functions
# ---------------------------
def get_custom_value(field):
    if not field or not isinstance(field, dict): return ""
    if "fieldValueDate" in field and field["fieldValueDate"]: return str(field["fieldValueDate"])
    if "fieldValueString" in field and field["fieldValueString"]: return str(field["fieldValueString"])
    if "fieldValue" in field and field["fieldValue"] is not None: return str(field["fieldValue"])
    if "value" in field and field["value"] is not None:
        v = field["value"]
        return ", ".join(map(str, v)) if isinstance(v, list) else str(v)
    return ""

def get_users_by_location(location_id, token):
    url = f"https://services.leadconnectorhq.com/users/?locationId={location_id}"
    headers = {"Authorization": f"Bearer {token}", "Version": "2021-07-28", "Accept": "application/json"}
    try:
        r = requests.get(url, headers=headers, timeout=30)
        if r.status_code != 200: return {}
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

def make_utc_range(start_date, end_date):
    start_local = GUATEMALA_TZ.localize(datetime.combine(start_date, dt_time.min))
    end_local = GUATEMALA_TZ.localize(datetime.combine(end_date, dt_time.max))
    return start_local.astimezone(pytz.UTC).isoformat().replace("+00:00", "Z"), end_local.astimezone(pytz.UTC).isoformat().replace("+00:00", "Z")

def extraer_datos_anuncio(text):
    if not text: return "", ""
    match_anu = ANUNCIO_REGEX.search(text)
    if not match_anu: return "", ""
    anuncio = match_anu.group(1)
    tipo_post = ""
    pattern_tipo = re.escape(anuncio) + r"\.([^.]+)"
    match_tipo = re.search(pattern_tipo, text, re.IGNORECASE)
    if match_tipo: tipo_post = match_tipo.group(1)
    return anuncio, tipo_post

def extraer_secuencia(text):
    if not text: return ""
    match_sec = SECUENCIA_REGEX.search(text.upper())
    return match_sec.group(1) if match_sec else ""

def fetch_contacts_for_account(acc, start_utc, end_utc, log_callback):
    token, loc, acc_name = acc["token"], acc["location_id"], acc["name"]
    sec_cf, anu_cf, pm_cf = acc["secuencia_cf"], acc["anuncio_cf"], acc["primer_mensaje_cf"]
    log_callback(f"Extraer GHL: {acc_name}...")
    u_map = get_users_by_location(loc, token)
    all_contacts, page, limit = [], 1, 100
    url = "https://services.leadconnectorhq.com/contacts/search"
    while True:
        payload = {"locationId": loc, "page": page, "pageLimit": limit, "filters": [{"field": "dateAdded", "operator": "range", "value": {"gt": start_utc, "lt": end_utc}}]}
        res = safe_post(url, token, payload, API_VERSION_CONTACTS)
        if not res or (isinstance(res, dict) and res.get("__error_status")): break
        contacts = res.get("contacts", [])
        if not isinstance(contacts, list) or not contacts: break
        all_contacts.extend(contacts); page += 1
        if len(contacts) < limit: break

    formatted = []
    for c in all_contacts:
        uid = c.get("assignedTo")
        assigned_name = u_map.get(uid, "") if uid else ""
        date_iso, date_dt = c.get("dateAdded"), None
        if date_iso:
            date_dt = datetime.fromisoformat(date_iso.replace("Z", "+00:00")).astimezone(GUATEMALA_TZ)
        secuencia_raw, anuncio_raw, primer_mensaje_texto = "", "", ""
        for cf in c.get("customFields", []):
            cid, val = cf.get("id"), get_custom_value(cf)
            if cid == sec_cf: secuencia_raw = val.strip()
            elif cid == anu_cf: anuncio_raw = val.strip()
            elif cid == pm_cf: primer_mensaje_texto = val.strip()

        anuncio, _ = extraer_datos_anuncio(anuncio_raw)
        if not anuncio and primer_mensaje_texto: anuncio, _ = extraer_datos_anuncio(primer_mensaje_texto)
        secuencia = extraer_secuencia(secuencia_raw) or acc_name

        formatted.append({
            "Contact Id": c.get("id", ""),
            "Fecha": date_dt,
            "Assigned": assigned_name,
            "Secuencia": secuencia,
            "Anuncio": anuncio
        })
    return formatted

# ---------------------------
# Components
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
        super().__init__(); self.title("DUPAZA CONTACTS PRO"); self.geometry("420x650"); cctk.set_appearance_mode("dark"); cctk.set_default_color_theme("green")
        self.grid_columnconfigure(0, weight=1); self.grid_rowconfigure(1, weight=1)
        header = cctk.CTkFrame(self, height=45, corner_radius=0); header.grid(row=0, column=0, sticky="ew")
        cctk.CTkLabel(header, text="📇 DUPAZA CONTACTS", font=("Segoe UI", 18, "bold")).pack(pady=8)
        body = cctk.CTkFrame(self, fg_color="transparent"); body.grid(row=1, column=0, sticky="nsew", padx=20, pady=20)
        body.grid_columnconfigure(0, weight=1)
        self.range_picker = FloatingRangePicker(body, "PERIODO DE EXTRACCIÓN"); self.range_picker.grid(row=0, column=0, pady=10, sticky="ew")
        self.process_btn = cctk.CTkButton(self, text="🚀 PROCESAR CONTACTOS", height=45, font=("Segoe UI", 14, "bold"), corner_radius=10, command=self.start_process); self.process_btn.grid(row=2, column=0, pady=20, padx=30, sticky="ew")
        logs_frame = cctk.CTkFrame(self, height=120, corner_radius=10); logs_frame.grid(row=3, column=0, sticky="ew", padx=20, pady=(0,20))
        self.console = cctk.CTkTextbox(logs_frame, height=100, font=("Consolas", 10)); self.console.pack(fill="both", expand=True, padx=5, pady=5); self.log("LISTO.")

    def log(self, txt):
        hour = datetime.now().strftime("%H:%M:%S")
        self.console.configure(state="normal"); self.console.insert("end", f"[{hour}] {txt}\n"); self.console.see("end"); self.console.configure(state="disabled")

    def start_process(self):
        if not all([self.range_picker.start_date, self.range_picker.end_date]):
            messagebox.showwarning("Atención", "Elija el rango de fechas."); return
        self.process_btn.configure(state="disabled", text="⌛ PROCESANDO..."); threading.Thread(target=self.execute_logic, daemon=True).start()

    def execute_logic(self):
        try:
            start_utc, end_utc = make_utc_range(self.range_picker.start_date, self.range_picker.end_date)
            all_raw = []
            with ThreadPoolExecutor(max_workers=5) as ex:
                futures = [ex.submit(fetch_contacts_for_account, acc, start_utc, end_utc, self.log) for acc in ACCOUNTS]
                for f in as_completed(futures): all_raw.extend(f.result())

            if not all_raw:
                self.log("Sin datos."); self.after(0, lambda: self.process_btn.configure(state="normal", text="🚀 PROCESAR CONTACTOS")); return

            self.log("Procesando logic de Power Query...")
            df = pd.DataFrame(all_raw)
            df['Contact Id'] = df['Contact Id'].astype(str).str.strip()
            df['Assigned'] = df['Assigned'].astype(str).str.strip().str.upper()
            df['Secuencia'] = df['Secuencia'].astype(str).str.strip().str.upper()
            df['Anuncio1'] = df['Anuncio'].astype(str).str.strip().str.upper()
            df['FECHA'] = pd.to_datetime(df['Fecha']).dt.date
            df['AÑO'] = pd.to_datetime(df['FECHA']).dt.year
            df['MES'] = pd.to_datetime(df['FECHA']).dt.month

            # Ranking
            df_val = df[df['Anuncio1'].notna() & (df['Anuncio1'] != "")]
            rnk_base = df_val.groupby(['FECHA', 'Secuencia', 'Anuncio1']).size().reset_index(name='CntAnun')
            rnk_base = rnk_base.sort_values(['FECHA', 'Secuencia', 'CntAnun'], ascending=[True, True, False])
            rnk_base['Index'] = rnk_base.groupby(['FECHA', 'Secuencia']).cumcount() + 1
            rankings = rnk_base[rnk_base['Index'] <= 3].pivot(index=['FECHA', 'Secuencia'], columns='Index', values='Anuncio1').reset_index()
            rankings.columns = ['FECHA', 'Secuencia'] + [f'Ranking{i}' for i in rankings.columns if isinstance(i, int)]
            for r in ['Ranking1', 'Ranking2', 'Ranking3']:
                if r not in rankings.columns: rankings[r] = None

            df = df.merge(rankings, on=['FECHA', 'Secuencia'], how='left')
            df['IsVacío'] = df['Anuncio1'].apply(lambda x: 1 if pd.isna(x) or x == "" else 0)
            df['VacíoFila'] = df.groupby(['FECHA', 'Secuencia', 'IsVacío']).cumcount() + 1
            df.loc[df['IsVacío'] == 0, 'VacíoFila'] = None

            nombres_base = ["YESSICA ALEJANDRA CARRERA PINEDA", "YARELIN BARRAZA ARIAS", "YOSELIN EUFEMIA BARRAZA ARIAS", "WALTER NEHEMIAS GUERRA", "YENDY MIREYA CUMAR CASTRO"]
            def assign_final(row):
                if pd.notna(row['Anuncio1']) and row['Anuncio1'] != "": return row['Anuncio1']
                excluidos = nombres_base if row['AÑO'] < 2025 or (row['AÑO'] == 2025 and row['MES'] < 11) else [n for n in nombres_base if n not in ["YARELIN BARRAZA ARIAS", "YOSELIN EUFEMIA BARRAZA ARIAS"]]
                if row['Assigned'] in excluidos: return None
                r_list = [row[f'Ranking{i}'] for i in range(1, 4) if pd.notna(row.get(f'Ranking{i}')) and row.get(f'Ranking{i}') != ""]
                if pd.notna(row['VacíoFila']) and r_list: return r_list[int((row['VacíoFila'] - 1) % len(r_list))]
                return None

            df['AnuncioF'] = df.apply(assign_final, axis=1)
            df['AnuncioF'] = df['AnuncioF'].replace("B1221A981C", "B1221A981").fillna("FREELANCE")
            df.loc[df['AnuncioF'] == "", 'AnuncioF'] = "FREELANCE"
            df['Mensajes'] = 1
            df['ANUNCIOSECUENCIA'] = df['AnuncioF'].astype(str) + df['Secuencia'].astype(str)
            df['ClaveDinamica'] = df['Assigned'].astype(str) + "-" + pd.to_datetime(df['FECHA']).dt.strftime('%m-%Y')

            def assign_pagina(row):
                if row['AnuncioF'] == "FREELANCE": return "FREELANCE"
                if row['Secuencia'] in ["A02-A", "A07-A"]: return "LA MUEBLERÍA GUATEMALA"
                return "LA MUEBLERIA."
            df['Pagina'] = df.apply(assign_pagina, axis=1)

            # Export
            fn = f"contactos_final_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
            df.to_excel(fn, index=False); self.log(f"Excel: {fn}")
            self.generate_html(df)
            self.log("EXITO."); self.after(0, lambda: messagebox.showinfo("EXITO", "Proceso completado."))
        except Exception as e:
            self.log(f"Error: {str(e)}")
        finally:
            self.after(0, lambda: self.process_btn.configure(state="normal", text="🚀 PROCESAR CONTACTOS"))

    def generate_html(self, df):
        self.log("Generando Dashboard...")
        data_json = df.to_dict(orient="records")
        html = f"""
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8"><title>Dashboard Contactos DUPAZA</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>.card {{ background: white; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); padding: 20px; }} .kpi-val {{ font-size: 28px; font-weight: bold; color: #76933C; }}</style>
</head>
<body class="bg-gray-50 p-6">
    <div class="max-w-7xl mx-auto">
        <header class="flex justify-between items-center mb-8">
            <h1 class="text-4xl font-extrabold text-gray-900">📇 DASHBOARD DE CONTACTOS</h1>
            <div class="text-sm text-gray-500 font-medium">Actualizado: {datetime.now().strftime('%d/%m/%Y %H:%M')}</div>
        </header>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 card">
            <div><label class="block text-sm font-semibold text-gray-700 mb-2">Página</label><select id="filter-p" class="w-full border-gray-300 rounded-lg"><option value="ALL">Todas</option></select></div>
            <div><label class="block text-sm font-semibold text-gray-700 mb-2">Secuencia</label><select id="filter-s" class="w-full border-gray-300 rounded-lg"><option value="ALL">Todas</option></select></div>
            <div><label class="block text-sm font-semibold text-gray-700 mb-2">Vendedor</label><select id="filter-v" class="w-full border-gray-300 rounded-lg"><option value="ALL">Todos</option></select></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div class="card text-center"><div class="text-gray-500 text-sm font-bold uppercase mb-1">Total Mensajes</div><div id="kpi-m" class="kpi-val">0</div></div>
            <div class="card text-center"><div class="text-gray-500 text-sm font-bold uppercase mb-1">Vendedores Activos</div><div id="kpi-v" class="kpi-val">0</div></div>
            <div class="card text-center"><div class="text-gray-500 text-sm font-bold uppercase mb-1">Anuncios Únicos</div><div id="kpi-a" class="kpi-val">0</div></div>
            <div class="card text-center"><div class="text-gray-500 text-sm font-bold uppercase mb-1">% Freelance</div><div id="kpi-f" class="kpi-val">0%</div></div>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <div class="card"><h3 class="text-xl font-bold mb-6">Mensajes por Vendedor</h3><div id="chart-v" style="height: 400px;"></div></div>
            <div class="card"><h3 class="text-xl font-bold mb-6">Distribución por Página</h3><div id="chart-p" style="height: 400px;"></div></div>
        </div>
    </div>
    <script>
        const rawData = {json.dumps(data_json)};
        function init() {{
            const ps = [...new Set(rawData.map(d => d.Pagina))].sort();
            const ss = [...new Set(rawData.map(d => d.Secuencia))].sort();
            const vs = [...new Set(rawData.map(d => d.Assigned))].sort();
            const pop = (id, l) => {{ const el = document.getElementById(id); l.forEach(i => {{ const o = document.createElement('option'); o.value = i; o.textContent = i; el.appendChild(o); }}); }};
            pop('filter-p', ps); pop('filter-s', ss); pop('filter-v', vs);
            document.querySelectorAll('select').forEach(el => el.addEventListener('change', update));
            update();
        }}
        function update() {{
            const p = document.getElementById('filter-p').value, s = document.getElementById('filter-s').value, v = document.getElementById('filter-v').value;
            const f = rawData.filter(d => (p === 'ALL' || d.Pagina === p) && (s === 'ALL' || d.Secuencia === s) && (v === 'ALL' || d.Assigned === v));
            document.getElementById('kpi-m').textContent = f.length.toLocaleString();
            document.getElementById('kpi-v').textContent = new Set(f.map(d => d.Assigned)).size;
            document.getElementById('kpi-a').textContent = new Set(f.map(d => d.AnuncioF)).size;
            document.getElementById('kpi-f').textContent = f.length > 0 ? ((f.filter(d => d.AnuncioF === 'FREELANCE').length / f.length) * 100).toFixed(1) + '%' : '0%';
            render(f);
        }}
        function render(data) {{
            const vM = data.reduce((a, c) => {{ const v = c.Assigned || 'SIN ASIGNAR'; a[v] = (a[v] || 0) + 1; return a; }}, {{}});
            const vS = Object.entries(vM).sort((a, b) => a[1] - b[1]);
            Plotly.newPlot('chart-v', [{{ y: vS.map(x => x[0]), x: vS.map(x => x[1]), type: 'bar', orientation: 'h', marker: {{color: '#76933C'}} }}], {{margin: {{t:0, l:150}}}});

            const pM = data.reduce((a, c) => {{ const p = c.Pagina || 'OTRO'; a[p] = (a[p] || 0) + 1; return a; }}, {{}});
            Plotly.newPlot('chart-p', [{{ labels: Object.keys(pM), values: Object.values(pM), type: 'pie', hole: .4 }}], {{margin: {{t:0}}}});
        }}
        init();
    </script>
</body>
</html>
"""
        with open("dashboard_contactos.html", "w", encoding="utf-8") as f: f.write(html)
