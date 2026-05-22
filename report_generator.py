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
from datetime import timedelta, datetime, timezone, time as dt_time
import pytz
from openpyxl.styles import PatternFill, Font, Alignment
from concurrent.futures import ThreadPoolExecutor, as_completed
from html import unescape
import os

# ---------------------------
# CONFIG: Cuentas Unificadas
# ---------------------------
ACCOUNTS = [
    {
        "name": "DELCAM",
        "location_id": "xr5u7XYR7rI3m9JNlJm7",
        "stage_id": "8577c7cd-5d39-42b4-8edb-ab9bad534119",
        "custom_field": "zUnROtV5c6XbRM4ijUQ1", # Fecha de Venta
        "dataventa_id": "3poEeFSMyn2tPoCKe0Bl",
        "token": "pit-4f8ddf96-7153-4904-a9a9-8434abf9fd83", # <--- Coloca tu token aquí
        "secuencia_cf": "jn9YrPWrdPdP8XmPVk0T",
        "anuncio_cf": "ampRBMHMXgNhxJMRHl6v",
        "primer_mensaje_cf": "Os7V8p7EFy94syDxUMAx"
    },
    {
        "name": "DHOGDOR",
        "location_id": "qLHT26aMDEKaZ3jGKF9F",
        "stage_id": "bea54a62-b0e8-48e6-a64d-8626319602c8",
        "custom_field": "2uieal4jZiRz3i32fmdr", # Fecha de Venta
        "dataventa_id": "GlbnwixnmUXj8CnEs9sG",
        "token": "pit-a8703b19-ab78-4354-90b8-ed4ab6bfe56e", # <--- Coloca tu token aquí
        "secuencia_cf": "HHf1OJLjyeqh0xxPf16y",
        "anuncio_cf": "y45Yu0N6yovQFgAS6nG3",
        "primer_mensaje_cf": "n7q6BIlpfvTJm0MBe7VD"

    },
    {
        "name": "DLIQF",
        "location_id": "xnCU3r4IN7gVAuZYx5JO",
        "stage_id": "374add3c-e3c3-4b86-a503-9040c407e4e8",
        "custom_field": "a2BH3MSK8ohUszAbW1OO", # Fecha de Venta
        "dataventa_id": "HUuNkuMdON8KJhm4PtAN",
        "token": "pit-7dade6f9-ef3e-4ffc-b6b6-9cdebd93289e", # <--- Coloca tu token aquí
        "secuencia_cf": "2Ttu4OQ9Fk4qovroFPRN",
        "anuncio_cf": "QovmsXeWCad6fFcDchsM",
        "primer_mensaje_cf": "iIw3cwaAyqt32YwLdAKq"

    },
    {
        "name": "DFULLS",
        "location_id": "H3rzWYlQxzBlq3gDRhcC",
        "stage_id": "e576e613-1682-4266-8bfe-d6f86b32d97c",
        "custom_field": "Ek5F3WOOOe7X50a60R0O", # Fecha de Venta
        "dataventa_id": "TO0YPfPJWwaocuiCgbZg",
        "token": "pit-2f261215-2278-4f05-9205-fc9f9bb52681", # <--- Coloca tu token aquí
        "secuencia_cf": "jsWRYUovvEYgAKddWPly",
        "anuncio_cf": "kRzUfj5Hj43lH6yQdSXh",
        "primer_mensaje_cf": "m2js5X7kAHgjfBjqQhMI"

    },
    {
        "name": "DDOR",
        "location_id": "iT9FHUMSHYmFeGicxlwJ",
        "stage_id": "eeaee2fb-518f-4c78-a696-7cf815414c10",
        "custom_field": "jnAsOVx6j5wxeCHmz0q6", # Fecha de Venta
        "dataventa_id": "kiuo9rQwFoJDf2cEaUJz",
        "token": "pit-404b2e86-443d-46d4-9d89-63da57482598", # <--- Coloca tu token aquí
        "secuencia_cf": "QfBoKX5vsilncCaDejWU",
        "anuncio_cf": "dpzuI8cV2N9c85NRH5p4",
        "primer_mensaje_cf": "LMVWgaR6LDBdqr6K1rPE"

    }
]

VENDEDOR_MAP = {
    "MARIA RENE SANTA CRUZ COSAJAY": "MARIA SANTACRUZ",
    "HENRY ESTUARDO PACHECO ARIANO": "HENRY PACHECO",
    "ROSA LIDIA PEREZ": "ROSA PEREZ",
    "CLEMENCIA ROCIO MIZA": "CLEMENCIA MIZA",
    "GRECIA SARAI FLORES FLORES": "GRECIA FLORES",
    "EVELYN PAOLA DARDON MORATAYA": "EVELYN DARDON",
    "MARVIN FRANCISCO CARRERA PINEDA": "MARVIN CARRERA",
    "YEIMI NOHEMI HERNANDEZ GOMEZ": "YEIMI HERNANDEZ",
    "ANA KARINA VELASQUEZ CALDERON DE CANAS": "ANA VELASQUEZ",
    "JHONATAN ISRAEL BARRIOS MUÑOZ": "JHONATAN BARRIOS",
    "CRISTIAN OMAR SANTOS ROSALES": "Cristian Santos",
    "LOURDES CAROLINA CAMPOS REYES": "Lourdes Campos",
    "CARLOS ARMANDO GIL TAJIN": "Carlos Gil",
    "OSCAR DANIEL IXCAYAU AGUILAR": "Oscar Ixcayau",
    "SIN ASIGNAR": "SinAsignar",
    "BYRON SILVERIO ORTIZ MENDOZA": "BYRON ORTIZ",
    "ESTHER DEL CARMEN LOPEZ CRUZ": "ESTHER LOPEZ",
    "SONIA MARIBEL CHIROY": "SONIA CHIROY",
    "MARVIN DAVID CANEL HERNANDEZ": "MARVIN CANEL",
    "BLANCA  RUTILIA YACAB AC": "BLANCA YACAB",
    "PEDRO JOSUE YAX VILLATORO": "PEDRO VILLATORO",
    "VICTOR MIGUEL ANGEL ASTURIAS TZAMOL": "VICTOR ANGEL",
    "ERICKA VICTORIA GONZALEZ LÓPEZ": "ERICKA GONZALEZ",
    "KAREN YULISA MENCOS RODAS": "KAREN MENCOS",
    "FABIANA MENDOZA LOPEZ": "FABIANA LOPEZ",
    "STEPHANIE DENNES AJUCHAN HERNANDEZ": "Stephanie Ajuchan",
    "ALISON MELISA AJANEL JOLON": "Alyson Ajanel",
    "IRMA LOURDES DE PAZ": "Lourdes Paz",
    "DENIS SEBASTIAN AJUCHAN SANTOS": "Denis Ajuchan",
    "SANDRA PATRICIA GUTIERREZ BLANCO": "Sandra Gutierrez",
    "FELIX  ANTONIO ACEITUNO BARRIENTOS": "FELIX ACEITUNO",
    "JUAN LUIS COTZAJAY TIJE": "JUAN COTZAJAY",
    "BRIAN SALVADOR CANO RAMIREZ": "BRIAN CANO",
    "JAMNIA GALILEA MORALES ORELLANA": "GALILEA MORALES",
    "WILMER ALEXANDER CAJAS JUAREZ": "WILMER CAJAS",
    "ADA LUZ MARIA MENDEZ SOSA": "Ada luz Mendez",
    "CHRISTIAN OLIVER GONZALEZ ORDOÑEZ": "Christian Gonzalez",
    "JESSICA ILEANA GARCIA PALACIOS": "JESSICA GARCIA",
    "GERBER ROMUALDO YAX VILLATORO": "GERBER YAX",
    "HAZEL BARINIA AGUILAR GONZALEZ": "HAZEL AGUILAR",
    "OSCAR JOSUE HERNANDEZ PEREZ": "Oscar Hernandez",
    "WALTER NEHEMIAS GUERRA": "WALTER GUERRA",
    "YESSICA ALEJANDRA CARRERA PINEDA": "YESSICA CARRERA",
    "HIDELKY AJIN": "HidelkyAjin",
    "BYRON ALEXIS MAYOR": "BYRON MAYOR",
    "YARELIN BARRAZA ARIAS": "YARELIN ARIAS",
    "YOSELIN EUFEMIA BARRAZA ARIAS": "YOSELIN BARRAZA",
    "YENDY MIREYA CUMAR CASTRO": "YENDY CUMAR",
    "ANGEL DANIEL LOPEZ PATZAN": "Angel Lopez",
    "BRYAN ARMANDO LOPEZ PATZAN": "Bryan Lopez",
    "HILLARY GISSELL RUCAL GALLINA": "Hillary Rucal",
    "KIMBERLY JESSENIA REGUAN RABAY": "Kimberly Reguán",
    "LUIS DAVID QUEXEL GIL": "Luis Quexel",
    "WENDY ARELIS ALQUIJAY GIL": "Wendy Alquijay",
    "CARLOS GIL TAJIN": "Carlos Gil",
    "ROSALINDA EUSEBIA RAMIREZ TEZEN": "Rosalinda Ramirez",
    "JULIO ALEJANDRO AJXUP GIL": "Julio Ajxup",
    "JOCARI ANASOL LOPEZ SICAL": "Jocari Lopez",
    "ODILIA NINETTE CALEL CARAU": "ODILIA NINETH CALEL",
}

API_VERSION_OPPS = "2023-02-21"
API_VERSION_CONTACTS = "2021-07-28"
ANUNCIO_REGEX = re.compile(r"([A-Z]\d{3}[A-Z]\d{3})", re.IGNORECASE)
SECUENCIA_REGEX = re.compile(r"([A-Z]\d\.\d)", re.IGNORECASE)
GUATEMALA_TZ = pytz.timezone("America/Guatemala")

# ---------------------------
# Backend Functions
# ---------------------------
def clean_html(raw_html):
    if not raw_html: return ""
    return unescape(re.sub(r'<[^>]+>', '', raw_html)).strip()

def format_date_ghl(val):
    if not val: return ""
    if isinstance(val, (int, float)):
        try: return datetime.fromtimestamp(val / 1000, tz=timezone.utc).strftime("%d/%m/%Y")
        except: return str(val)
    s = str(val).strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return f"{s[8:10]}/{s[5:7]}/{s[0:4]}"
    return s

def get_yyyy_mm_dd(val):
    if not val: return ""
    if isinstance(val, (int, float)):
        try: return datetime.fromtimestamp(val / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        except: return ""
    s = str(val).strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    return ""

def calculate_nit(nit, tel1, ghl_phone):
    n, t1, gp = str(nit).strip().upper(), str(tel1).strip(), str(ghl_phone).strip()
    res = n
    if n in ("CF", "C/F", ""): res = t1
    if not res:
        if len(gp) >= 12: res = gp[4:12]
        elif len(gp) > 4: res = gp[4:]
    return res

def get_custom_value(field):
    if not field or not isinstance(field, dict): return ""
    if "fieldValueDate" in field and field["fieldValueDate"]: return format_date_ghl(field["fieldValueDate"])
    if "fieldValueString" in field and field["fieldValueString"]: return str(field["fieldValueString"])
    if "fieldValue" in field and field["fieldValue"] is not None:
        v = field["fieldValue"]
        if isinstance(v, (int, float)) and v > 1000000000000: return format_date_ghl(v)
        return str(v)
    if "value" in field and field["value"] is not None:
        v = field["value"]
        if isinstance(v, list): return ", ".join(map(str, v))
        return str(v)
    return ""

def get_custom_fields_map(location_id, token):
    url = f"https://services.leadconnectorhq.com/locations/{location_id}/customFields?model=opportunity"
    headers = {"Authorization": f"Bearer {token}", "Version": API_VERSION_OPPS, "Accept": "application/json"}
    try:
        r = requests.get(url, headers=headers, timeout=30)
        if r.status_code != 200: return {}
        return {f.get("id"): f.get("name") for f in r.json().get("customFields", []) if isinstance(f, dict)}
    except: return {}

def get_users_by_location(location_id, token, version=API_VERSION_OPPS):
    url = f"https://services.leadconnectorhq.com/users/?locationId={location_id}"
    headers = {"Authorization": f"Bearer {token}", "Version": version, "Accept": "application/json"}
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
            if r.status_code == 429:
                time.sleep(attempt * 2)
                continue
            return {"__error_status": r.status_code, "__error_text": r.text}
        except:
            time.sleep(attempt * 1.5)
            continue
    return {}

def parse_dataventa(dv_str):
    try:
        data = json.loads(dv_str)
        nit, dep, mun = data.get("nit", ""), data.get("departamento", ""), data.get("municipio", "")
        t1, t2, fv, nom = data.get("tel1", ""), data.get("tel2", ""), data.get("fechaVenta", ""), data.get("nombre", "")
        p_cols = {}
        all_slots = [
            "Camas y Combos SKU", "Cantidad Camas y Combo SKU",
            "Camas y Combos SKU1", "Cantidad Camas y Combo SKU1",
            "Cocinas SKU", "Cantidad Cocinas SKU",
            "Cocinas SKU1", "Cantidad Cocinas SKU1",
            "Salas SKU", "Cantidad Salas SKU",
            "Salas SKU1", "Cantidad Salas SKU1"
        ]
        for i, p in enumerate(data.get("productos", [])):
            if i * 2 < len(all_slots):
                p_cols[all_slots[i*2]] = p.get("sku", "")
                p_cols[all_slots[i*2 + 1]] = p.get("cantidad", "")
            else:
                p_cols[f"Producto_{i+1} SKU"] = p.get("sku", "")
                p_cols[f"Cantidad Producto_{i+1}"] = p.get("cantidad", "")
        return nit, dep, mun, t1, t2, fv, nom, p_cols
    except: return "", "", "", "", "", "", "", {}

def get_mapped_vendedor(raw_vendedor):
    if not raw_vendedor: return "SinAsignar"
    key = str(raw_vendedor).strip().upper()
    return VENDEDOR_MAP.get(key, raw_vendedor)

def parse_ventas_unnested(dv_str, contact_id, opp_id, ghl_phone, vendedor, ghl_name="", sale_date_str=""):
    data = {}
    if dv_str:
        try: data = json.loads(dv_str)
        except: pass
    nit_j, t1 = data.get("nit", ""), data.get("tel1", "")
    try: total_docto = float(str(data.get("Total_General", 0)).replace(',', ''))
    except: total_docto = 0.0
    vendedor_final = get_mapped_vendedor(vendedor)
    base_metadata = {
        "ID CONTACTO": contact_id, "NIT": calculate_nit(nit_j, t1, ghl_phone), "NOMBRE": data.get("nombre", ghl_name),
        "TEL1": t1, "TEL2": data.get("tel2", ""), "VENDEDOR": vendedor_final,
        "MUNICIPIO": data.get("municipio", ""), "DIRECCION": data.get("direccion", ""), "RCF": "000000000000",
        "canal": data.get("canal", ""), "DEPARTAMENTO": data.get("departamento", ""),
        "FECHA": format_date_ghl(data.get("fechaVenta", sale_date_str)), "MARCA": data.get("marca", ""),
        "UBICACION": data.get("ubicacion", ""), "ANILLO": data.get("anillo", ""),
        "COMENTARIOS": data.get("COMENTARIO", ""), "ID Oportunidad": opp_id,
        "BODEGAF": str(data.get("bodega", ""))[:4] if data.get("bodega") else "", "TOTAL DOCTO": total_docto
    }
    empty_metadata = {k: "" for k in base_metadata.keys()}
    prods = data.get("productos", [])
    if not prods: return [base_metadata]
    rows = []
    for i, p in enumerate(prods):
        row = dict(base_metadata) if i == 0 else dict(empty_metadata)
        sku_f = str(p.get("sku", ""))
        parts = sku_f.split("_")
        try: precio_combo = float(str(p.get("precio", 0)).replace(',', ''))
        except: precio_combo = 0.0
        row.update({"SKU": parts[0] if parts else sku_f, "DESCRIPCION": parts[1] if len(parts) > 1 else "",
                    "Cantidad de combo": p.get("cantidad", ""), "PRECIO COMBO": precio_combo})
        rows.append(row)
    return rows

def make_utc_range(start_date, end_date):
    start_local = GUATEMALA_TZ.localize(datetime.combine(start_date, dt_time.min))
    end_local = GUATEMALA_TZ.localize(datetime.combine(end_date, dt_time.max))
    start_utc = start_local.astimezone(pytz.UTC).isoformat().replace("+00:00", "Z")
    end_utc = end_local.astimezone(pytz.UTC).isoformat().replace("+00:00", "Z")
    return start_utc, end_utc

def fetch_contacts_for_account(acc, start_utc, end_utc, log_callback):
    token = acc["token"]
    loc = acc["location_id"]
    acc_name = acc["name"]
    sec_cf = acc["secuencia_cf"]
    anu_cf = acc["anuncio_cf"]
    pm_cf = acc["primer_mensaje_cf"]

    log_callback(f"Descargando contactos de {acc_name}...")
    u_map = get_users_by_location(loc, token, version=API_VERSION_CONTACTS)

    all_contacts = []
    page, limit = 1, 100
    url = "https://services.leadconnectorhq.com/contacts/search"

    while True:
        payload = {
            "locationId": loc, "page": page, "pageLimit": limit,
            "filters": [{"field": "dateAdded", "operator": "range", "value": {"gt": start_utc, "lt": end_utc}}]
        }
        res = safe_post(url, token, payload, API_VERSION_CONTACTS)
        if not res or (isinstance(res, dict) and res.get("__error_status")): break
        contacts = res.get("contacts", [])
        if not isinstance(contacts, list) or not contacts: break
        all_contacts.extend(contacts)
        if len(contacts) < limit: break
        page += 1

    formatted_contacts = []
    for c in all_contacts:
        uid = c.get("assignedTo")
        assigned_name = u_map.get(uid, "") if uid else ""

        date_iso = c.get("dateAdded")
        date_fmt = ""
        if date_iso:
            dt_utc = datetime.fromisoformat(date_iso.replace("Z", "+00:00"))
            dt_local = dt_utc.astimezone(GUATEMALA_TZ)
            date_fmt = f"{dt_local.day}/{dt_local.month:02d}/{dt_local.year}"

        secuencia_raw = ""
        anuncio_raw = ""
        primer_mensaje_texto = ""
        for cf in c.get("customFields", []):
            cid = cf.get("id")
            val = get_custom_value(cf)
            if cid == sec_cf:
                secuencia_raw = val.strip()
            elif cid == anu_cf:
                anuncio_raw = val.strip()
            elif cid == pm_cf:
                primer_mensaje_texto = val.strip()

        # Logic to extract Anuncio and tipo_post
        anuncio = ""
        tipo_post = ""

        # Try finding in anuncio_raw first
        match_anu = ANUNCIO_REGEX.search(anuncio_raw) if anuncio_raw else None
        source_used = anuncio_raw

        # If not found or invalid format in anuncio_raw, try primer_mensaje_texto
        if not match_anu and primer_mensaje_texto:
            match_anu = ANUNCIO_REGEX.search(primer_mensaje_texto)
            source_used = primer_mensaje_texto

        if match_anu:
            anuncio = match_anu.group(1)
            # Look for tipo_post: character after a dot following the ad code
            # Example: A001A013.C.4999 -> C
            pattern_tipo = re.escape(anuncio) + r"\.([^.]+)"
            match_tipo = re.search(pattern_tipo, source_used, re.IGNORECASE)
            if match_tipo:
                tipo_post = match_tipo.group(1)

        # Logic to extract secuencia (campaign format: Letra Numero Punto Numero)
        secuencia = ""
        if secuencia_raw:
            match_sec = SECUENCIA_REGEX.search(secuencia_raw)
            if match_sec:
                secuencia = match_sec.group(1)

        formatted_contacts.append({
            "id": c.get("id", ""),
            "dateAdded": date_fmt,
            "assignedToName": assigned_name,
            "secuencia": secuencia,
            "Anuncio": anuncio,
            "tipo_post": tipo_post
        })

    log_callback(f"  - {acc_name}: {len(formatted_contacts)} contactos encontrados.")
    return formatted_contacts

def fetch_for_account(acc, ghl_start, ghl_end, client_start, client_end, log_callback):
    token = acc["token"]
    if not token: return [], []
    loc, stage, cfield, dv_id, acc_name = acc["location_id"], acc["stage_id"], acc["custom_field"], acc["dataventa_id"], acc["name"]
    log_callback(f"Conectando con {acc_name} para Oportunidades...")
    u_map = get_users_by_location(loc, token)
    cf_names = get_custom_fields_map(loc, token)

    all_opps = []
    page, limit = 1, 100
    url = "https://services.leadconnectorhq.com/opportunities/search"
    while True:
        payload = {
            "locationId": loc, "page": page, "limit": limit,
            "filters": [{"group": "AND", "filters": [
                {"field": "pipeline_stage_id", "operator": "eq", "value": stage},
                {"field": "status", "operator": "eq", "value": "won"},
                {"field": f"custom_fields.{cfield}", "operator": "range", "value": {"gte": ghl_start, "lte": ghl_end}}
            ]}],
            "sort": [{"field": "date_added", "direction": "desc"}],
            "additionalDetails": {"notes": True}
        }
        res = safe_post(url, token, payload, API_VERSION_OPPS)
        if not res or (isinstance(res, dict) and res.get("__error_status")): break
        opps = res.get("opportunities", [])
        if not isinstance(opps, list): break
        all_opps.extend(opps)
        if len(opps) < limit: break
        page += 1

    r_opps, r_ventas = [], []
    for op in all_opps:
        if not isinstance(op, dict): continue
        try:
            opp_cfs = op.get("customFields") or op.get("custom_fields") or []
            sale_date_iso, sale_date_str, dv_str, cf_data = "", "", "", {}
            for cf in opp_cfs:
                fid, val = cf.get("id"), get_custom_value(cf)
                if fid == cfield:
                    sale_date_str = val
                    raw_v = cf.get("fieldValueDate") or cf.get("fieldValue") or cf.get("fieldValueString")
                    sale_date_iso = get_yyyy_mm_dd(raw_v)
                if fid == dv_id:
                    dv_raw = cf.get("fieldValue") or cf.get("fieldValueString")
                    dv_str = str(dv_raw) if dv_raw else ""
                fname = cf_names.get(fid, fid)
                if fname and fname.strip().lower() != "id de oportunidad":
                    cf_data[fname] = val

            if not sale_date_iso or not (client_start <= sale_date_iso <= client_end): continue

            vendedor_raw = u_map.get(op.get("assignedTo"), "")
            gnam = op.get("contact", {}).get("name", "") if isinstance(op.get("contact"), dict) else ""
            opp_id_val = op.get("id", "")

            dv_data = {}
            if dv_str:
                try: dv_data = json.loads(dv_str)
                except: pass

            row = {"secuencia": acc_name, "fase": op.get("pipelineStageName", "Cierre de Venta"), "Valor del cliente potencial": op.get("monetaryValue", 0),
                   "asignado": vendedor_raw, "Creado": format_date_ghl(op.get("createdAt")), "Ultimo Actualizado": format_date_ghl(op.get("updatedAt")),
                   "Seguidores": "", "Notas": " | ".join([clean_html(n.get("body", "")) for n in op.get("notes", []) if isinstance(n, dict)]),
                   "etiquetas": ", ".join(op.get("tags", [])) if isinstance(op.get("tags"), list) else "", "estado": op.get("status", ""),
                   "ID de contacto": op.get("contactId", ""), "Cliente": gnam, "Cod": str(opp_id_val)[:10],
                   "MARCA": dv_data.get("marca", ""), "ANILLO": dv_data.get("anillo", ""), "UBICACION": dv_data.get("ubicacion", ""),
                   "Mes": int(sale_date_iso[5:7]) if sale_date_iso else "", "DataVenta": dv_str, "ID de oportunidad": opp_id_val}

            row.update(cf_data)
            nit_j, dep, mun, t1, t2, fv_j, nom_j, p_cols = parse_dataventa(dv_str)
            gp = op.get("contact", {}).get("phone", "") if isinstance(op.get("contact"), dict) else ""
            f_final = format_date_ghl(sale_date_str or fv_j)
            row.update({"NIT": calculate_nit(nit_j, t1, gp), "Departamento": dep, "Municipio": mun, "Telefono 1": t1, "Telefono 2": t2,
                        "Fecha": f_final, "Fecha de Venta": f_final})
            if nom_j: row["Cliente"] = nom_j
            row.update(p_cols)
            r_opps.append(row)
            r_ventas.extend(parse_ventas_unnested(dv_str, op.get("contactId", ""), op.get("id", ""), gp, vendedor_raw, gnam, sale_date_str))
        except: continue
    log_callback(f"  - {acc_name}: {len(r_opps)} oportunidades encontradas.")
    return r_opps, r_ventas

# ---------------------------
# DEFINITIVE INDEPENDENT DATE PICKER
# ---------------------------
class FloatingRangePicker(cctk.CTkFrame):
    def __init__(self, parent, title):
        super().__init__(parent, corner_radius=20)
        self.start_date = None
        self.end_date = None
        self.pop = None

        self.lbl = cctk.CTkLabel(self, text=title, font=("Segoe UI", 22, "bold"))
        self.lbl.pack(anchor="w", padx=20, pady=(20,10))

        # Two separate entry fields
        self.entry_frame = cctk.CTkFrame(self, fg_color="transparent")
        self.entry_frame.pack(padx=20, pady=(10,20), fill="x")

        self.entry_start = cctk.CTkEntry(self.entry_frame, placeholder_text="Inicio", height=42, corner_radius=12, font=("Segoe UI", 12), justify="center", width=120, state="readonly")
        self.entry_start.pack(side="left", expand=True, fill="x", padx=(0,5))
        self.entry_start.bind("<Button-1>", lambda e: self.open_calendar(self.entry_start, "start"))

        self.arrow_lbl = cctk.CTkLabel(self.entry_frame, text="→", font=("Segoe UI", 16, "bold"))
        self.arrow_lbl.pack(side="left")

        self.entry_end = cctk.CTkEntry(self.entry_frame, placeholder_text="Fin", height=42, corner_radius=12, font=("Segoe UI", 12), justify="center", width=120, state="readonly")
        self.entry_end.pack(side="left", expand=True, fill="x", padx=(5,0))
        self.entry_end.bind("<Button-1>", lambda e: self.open_calendar(self.entry_end, "end"))

    def open_calendar(self, target_entry, date_type):
        if self.pop:
            self.close_calendar()

        self.update_idletasks()
        x = target_entry.winfo_rootx()
        y = target_entry.winfo_rooty() + target_entry.winfo_height() + 5

        self.pop = tk.Toplevel(self)
        self.pop.overrideredirect(True)
        self.pop.attributes("-topmost", True)
        self.pop.geometry(f"320x350+{x}+{y}")
        self.pop.grab_set()

        container = cctk.CTkFrame(self.pop, corner_radius=15, border_width=2, border_color="#76933C", fg_color="#ffffff")
        container.pack(fill="both", expand=True)

        header = tk.Frame(container, bg="#ffffff", height=40)
        header.pack(fill="x", padx=10, pady=5)

        txt = "ELIGE FECHA INICIO" if date_type == "start" else "ELIGE FECHA FIN"
        self.info_lbl = tk.Label(header, text=txt, font=("Segoe UI", 10, "bold"), fg="#333333", bg="#ffffff")
        self.info_lbl.pack(side="left")

        close_btn = tk.Button(header, text="✕", font=("Arial", 12), bd=0, bg="#ffffff", activebackground="#eeeeee", command=self.close_calendar)
        close_btn.pack(side="right")

        self.cal = Calendar(container, selectmode="day", date_pattern="yyyy-mm-dd",
                            background='white', foreground='black',
                            headersbackground='white', headersforeground='black',
                            selectbackground='#1890ff', selectforeground='white',
                            normalbackground='white', normalforeground='black',
                            weekendbackground='white', weekendforeground='#ff4d4f',
                            othermonthbackground='#f5f5f5', othermonthforeground='#bfbfbf',
                            borderwidth=0)
        self.cal.pack(pady=10, padx=15, fill="both", expand=True)

        # KEY: Simple direct binding. No clicks outside, no range logic.
        self.cal.bind("<<CalendarSelected>>", lambda e: self._on_date_selected(target_entry, date_type))
        self.pop.focus_set()

    def close_calendar(self):
        if self.pop:
            self.pop.grab_release()
            self.pop.destroy()
            self.pop = None

    def _on_date_selected(self, target_entry, date_type):
        date_str = self.cal.get_date()
        date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()

        if date_type == "start":
            self.start_date = date_obj
        else:
            self.end_date = date_obj

        target_entry.configure(state="normal")
        target_entry.delete(0, "end")
        target_entry.insert(0, str(date_obj))
        target_entry.configure(state="readonly")

        # Close immediately after ONE selection
        self.after(200, self.close_calendar)

# ---------------------------
# APP
# ---------------------------
class App(cctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("DUPAZA REPORT PRO")
        self.geometry("950x650")
        cctk.set_appearance_mode("dark")
        cctk.set_default_color_theme("green")

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        # HEADER
        header = cctk.CTkFrame(self, height=80, corner_radius=0)
        header.grid(row=0, column=0, sticky="ew")
        title_lbl = cctk.CTkLabel(header, text="📊 DUPAZA REPORT PRO", font=("Segoe UI", 28, "bold"))
        title_lbl.pack(side="left", padx=25, pady=20)

        # BODY
        body = cctk.CTkFrame(self, fg_color="transparent")
        body.grid(row=1, column=0, sticky="nsew", padx=20, pady=20)
        body.grid_columnconfigure((0,1), weight=1)

        # CONTACTOS
        self.contacts_picker = FloatingRangePicker(body, "📇 CONTACTOS")
        self.contacts_picker.grid(row=0, column=0, padx=10, sticky="ew")

        # VENTAS
        self.sales_picker = FloatingRangePicker(body, "💰 VENTAS")
        self.sales_picker.grid(row=0, column=1, padx=10, sticky="ew")

        # GENERATE BUTTON
        self.generate_btn = cctk.CTkButton(self, text="🚀 GENERAR EXCEL", height=45, width=220, font=("Segoe UI", 15, "bold"), corner_radius=14, command=self.start_process)
        self.generate_btn.grid(row=2, column=0, pady=10)

        # LOGS
        logs_frame = cctk.CTkFrame(self, height=120, corner_radius=18)
        logs_frame.grid(row=3, column=0, sticky="ew", padx=20, pady=(0,20))
        cctk.CTkLabel(logs_frame, text="🖥️ ACTIVIDAD", font=("Segoe UI", 16, "bold")).pack(anchor="w", padx=15, pady=(10,5))
        self.console = cctk.CTkTextbox(logs_frame, height=80, font=("Consolas", 12))
        self.console.pack(fill="both", expand=True, padx=15, pady=(0,15))

        self.log("SISTEMA INICIADO. Haga clic en Inicio o Fin para elegir fechas.")

    def log(self, txt):
        hour = datetime.now().strftime("%H:%M:%S")
        self.console.configure(state="normal")
        self.console.insert("end", f"[{hour}] {txt}\n")
        self.console.see("end")
        self.console.configure(state="disabled")

    def start_process(self):
        if not self.sales_picker.start_date or not self.sales_picker.end_date:
            messagebox.showwarning("Atención", "Elija fechas de VENTAS.")
            return
        if not self.contacts_picker.start_date or not self.contacts_picker.end_date:
            messagebox.showwarning("Atención", "Elija fechas de CONTACTOS.")
            return

        self.generate_btn.configure(state="disabled", text="🚀 PROCESANDO...")
        threading.Thread(target=self.execute_logic, daemon=True).start()

    def execute_logic(self):
        sd_opp = datetime.combine(self.sales_picker.start_date, dt_time.min)
        ed_opp = datetime.combine(self.sales_picker.end_date, dt_time.max)
        sd_con = datetime.combine(self.contacts_picker.start_date, dt_time.min)
        ed_con = datetime.combine(self.contacts_picker.end_date, dt_time.max)

        s_iso_opp = sd_opp.strftime("%Y-%m-%d")
        e_iso_opp = ed_opp.strftime("%Y-%m-%d")
        ghl_start_opp = sd_opp.strftime("%Y-%m-%dT00:00:00.000Z")
        ghl_end_opp = ed_opp.strftime("%Y-%m-%dT23:59:59.999Z")

        start_utc_con, end_utc_con = make_utc_range(sd_con, ed_con)

        self.log("Iniciando extracción unificada...")
        res_o, res_v, res_c = [], [], []

        with ThreadPoolExecutor(max_workers=5) as ex:
            f_opp = {ex.submit(fetch_for_account, acc, ghl_start_opp, ghl_end_opp, s_iso_opp, e_iso_opp, self.log): acc for acc in ACCOUNTS}
            f_con = {ex.submit(fetch_contacts_for_account, acc, start_utc_con, end_utc_con, self.log): acc for acc in ACCOUNTS}

            for f in as_completed(list(f_opp.keys()) + list(f_con.keys())):
                try:
                    if f in f_opp:
                        o, v = f.result()
                        res_o.extend(o); res_v.extend(v)
                    else:
                        c = f.result()
                        res_c.extend(c)
                except Exception as e:
                    self.log(f"Error: {str(e)[:50]}")

        if res_o or res_c:
            self.generate_excel(res_o, res_v, res_c)
        else:
            self.log("No se encontraron datos.")
            messagebox.showwarning("Atención", "No se encontraron datos.")

        self.generate_btn.configure(state="normal", text="🚀 GENERAR EXCEL")

    def generate_excel(self, res_o, res_v, res_c):
        self.log("Compilando Excel...")

        df_o = pd.DataFrame(res_o)
        head = ["secuencia", "fase", "Valor del cliente potencial", "asignado", "Creado", "Ultimo Actualizado", "Seguidores", "Notas", "etiquetas", "estado",
                "Fecha de Venta", "NIT", "Camas y Combos SKU", "Cantidad Camas y Combo SKU", "Camas y Combos SKU1", "Cantidad Camas y Combo SKU1",
                "Cocinas SKU", "Cantidad Cocinas SKU", "Cocinas SKU1", "Cantidad Cocinas SKU1",
                "Salas SKU", "Cantidad Salas SKU", "Salas SKU1", "Cantidad Salas SKU1"]
        tail = ["", "Departamento", "Municipio", "Telefono 1", "Telefono 2", "MARCA", "ANILLO", "UBICACION", "ID de oportunidad", "ID de contacto", "Cliente", "Mes", "Cod", "DataVenta", "Fecha"]

        if not df_o.empty:
            if "" not in df_o.columns: df_o[""] = ""
            for c in head + tail:
                if c not in df_o.columns: df_o[c] = ""
            extra_products = [c for c in df_o.columns if c not in set(head + tail)]
            df_o = df_o[head + extra_products + tail]

        df_v = pd.DataFrame(res_v)
        v_cols = ["ID CONTACTO", "NIT", "NOMBRE", "TEL1", "TEL2", "VENDEDOR", "MUNICIPIO", "DIRECCION", "RCF", "canal", "DEPARTAMENTO", "FECHA",
                  "SKU", "DESCRIPCION", "Cantidad de combo", "MARCA", "UBICACION", "ANILLO", "COMENTARIOS", "ID Oportunidad", "BODEGAF", "TOTAL DOCTO", "PRECIO COMBO"]
        if not df_v.empty:
            for c in v_cols:
                if c not in df_v.columns: df_v[c] = ""
            df_v = df_v[v_cols]

        df_c = pd.DataFrame(res_c)
        c_cols = ["id", "dateAdded", "assignedToName", "secuencia", "Anuncio", "tipo_post"]
        if not df_c.empty:
            for c in c_cols:
                if c not in df_c.columns: df_c[c] = ""
            df_c = df_c[c_cols]

        fn = f"reporte_Dupaza_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        with pd.ExcelWriter(fn, engine='openpyxl') as writer:
            df_o.to_excel(writer, sheet_name='REPORTE', index=False)
            df_v.to_excel(writer, sheet_name='VENTAS', index=False)
            df_c.to_excel(writer, sheet_name='CONTACTOS', index=False)
            pd.DataFrame().to_excel(writer, sheet_name='Hoja1', index=False)

            if not df_v.empty:
                ws_v = writer.book['VENTAS']
                idx_bus = len(v_cols) + 1
                ws_v.cell(row=1, column=idx_bus).value = "BUSQUEDA"
                h_fill = PatternFill(start_color="76933C", end_color="76933C", fill_type="solid")
                h_font = Font(bold=True, color="FFFFFF")
                for cell in ws_v[1]:
                    cell.fill, cell.font, cell.alignment = h_fill, h_font, Alignment(horizontal="center")

                bg_fill, current_fill = PatternFill(start_color="DCE6F1", end_color="DCE6F1", fill_type="solid"), None
                for r in range(2, ws_v.max_row + 1):
                    id_contacto = ws_v.cell(row=r, column=1).value
                    if id_contacto:
                        ws_v.cell(row=r, column=idx_bus).value = f"=VLOOKUP(T{r},Hoja1!A:A,1,FALSE)"
                        current_fill = bg_fill if current_fill is None else None
                    if current_fill:
                        for c in range(1, idx_bus + 1): ws_v.cell(row=r, column=c).fill = current_fill

        self.log(f"¡EXITO! Archivo: {fn}")
        messagebox.showinfo("ÉXITO", f"Excel generado:\n{fn}")

if __name__ == "__main__":
    app = App()
    app.mainloop()
