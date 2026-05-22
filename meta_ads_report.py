import requests
import pandas as pd
import json
import re
import time

# evitar fallos de conexión en requests
requests.adapters.DEFAULT_RETRIES = 5

ACCESS_TOKEN = ""
API_VERSION = "v19.0"

# cuentas publicitarias
AD_ACCOUNTS = [
    "act_622689460111355"
]

BASE_URL = f"https://graph.facebook.com/{API_VERSION}"

FIELDS_INSIGHTS = "ad_id,ad_name,adset_name,campaign_name,impressions,spend,clicks,actions,date_start,date_stop"


# ---------------------------------------------------
# UTILIDAD REQUEST
# ---------------------------------------------------

def fb_get(url, params=None):

    params = params or {}
    params["access_token"] = ACCESS_TOKEN

    r = requests.get(url, params=params)
    return r.json()


# ---------------------------------------------------
# EXTRAER CODIGO ANUNCIO
# ---------------------------------------------------

def extraer_codigo(nombre):

    if not isinstance(nombre, str):
        return None

    m = re.search(r'[A-Z]\d{4}[A-Z]\d{3}', nombre)

    if m:
        return m.group(0)

    return None


# ---------------------------------------------------
# EXTRAER PRECIO
# ---------------------------------------------------

def extraer_precio(nombre):

    if not isinstance(nombre, str):
        return None

    m = re.search(r'\.(\d+)', nombre)

    if m:
        return int(m.group(1))

    return None


# ---------------------------------------------------
# EXTRAER TIPO POST
# ---------------------------------------------------

def extraer_tipo(nombre):

    if not isinstance(nombre, str):
        return None

    m = re.search(r'[ .]([A-Z])$', nombre)

    if m:
        return m.group(1)

    return None


# ---------------------------------------------------
# SECUENCIA
# ---------------------------------------------------

def obtener_secuencia(campaña):

    if not isinstance(campaña, str):
        return None

    campaña = campaña.upper()

    if "VICTORIA" in campaña:
        return "A02-A"

    if "DIEGO" in campaña:
        return "A03-A"

    if "ANGEL" in campaña:
        return "A07-A"

    if "TIENDAS" in campaña:
        return "A04-A"

    if "ALCANCE" in campaña:
        return "TIENDAS"

    return None


# ---------------------------------------------------
# OBTENER INSIGHTS
# ---------------------------------------------------

def obtener_insights(account, fecha_desde, fecha_hasta):

    print(f"Descargando insights para cuenta: {account} desde {fecha_desde} hasta {fecha_hasta}")

    url = f"{BASE_URL}/{account}/insights"

    params = {
        "fields": FIELDS_INSIGHTS,
        "level": "ad",
        "limit": 500,
        "time_range": json.dumps({
            "since": fecha_desde,
            "until": fecha_hasta
        }),
        "time_increment": 1,
        "filtering": '[{"field":"spend","operator":"GREATER_THAN","value":0}]'
    }

    data = []

    while True:

        r = requests.get(url, params={**params, "access_token": ACCESS_TOKEN})
        js = r.json()

        if "data" not in js:
            print(js)
            break

        data.extend(js["data"])

        if "paging" in js and "next" in js["paging"]:
            url = js["paging"]["next"]
            params = {}
        else:
            break

    return data


# ---------------------------------------------------
# OBTENER CREATIVE
# ---------------------------------------------------

def obtener_creatives(ad_ids):

    creative_map = {}

    for i in range(0, len(ad_ids), 50):

        block = ad_ids[i:i+50]

        batch = []

        for aid in block:
            batch.append({
                "method": "GET",
                "relative_url": f"{aid}?fields=creative"
            })

        r = requests.post(
            f"{BASE_URL}/",
            data={
                "access_token": ACCESS_TOKEN,
                "batch": json.dumps(batch)
            }
        )

        responses = r.json()

        if not isinstance(responses, list):
            print("Error en batch creatives:", responses)
            continue

        for resp in responses:

            if resp.get("code") != 200:
                print(f"DEBUG - Error creative para bloque: {resp}")
                continue

            body = resp.get("body")

            if not body:
                continue

            body = json.loads(body)

            ad_id = body.get("id")
            creative_id = body.get("creative", {}).get("id")

            if ad_id and creative_id:
                creative_map[str(ad_id)] = str(creative_id)

        time.sleep(0.3)

    return creative_map


# ---------------------------------------------------
# OBTENER PAGE ID DESDE CREATIVE
# ---------------------------------------------------

def obtener_paginas(creatives):

    page_map = {}

    if not creatives:
        print("DEBUG - No hay Creative IDs para procesar en obtener_paginas")
        return page_map

    for i in range(0, len(creatives), 50):

        block = creatives[i:i+50]

        batch = []

        for cid in block:

            batch.append({
                "method": "GET",
                "relative_url": f"{cid}?fields=object_story_spec,actor_id,effective_object_story_id"
            })

        r = requests.post(
            f"{BASE_URL}/",
            data={
                "access_token": ACCESS_TOKEN,
                "batch": json.dumps(batch)
            }
        )

        responses = r.json()

        if not isinstance(responses, list):
            print("Error en batch creatives:", responses)
            continue

        for resp in responses:

            if resp.get("code") != 200:
                print(f"DEBUG - Error al obtener Page ID para creative: {resp}")
                continue

            body = resp.get("body")

            if not body:
                continue

            body = json.loads(body)

            cid = body.get("id")

            # Intentar obtener el ID de la página de varias fuentes dentro del creative
            oss = body.get("object_story_spec", {})
            page_id = oss.get("page_id") or oss.get("page", {}).get("id")

            if not page_id:
                # Buscar en link_data o video_data si existen
                link_data = oss.get("link_data", {})
                page_id = link_data.get("page_id")

                if not page_id:
                    video_data = oss.get("video_data", {})
                    page_id = video_data.get("page_id")

            actor_id = body.get("actor_id")

            post_id = body.get("effective_object_story_id")

            if not page_id and post_id and "_" in post_id:
                page_id = post_id.split("_")[0]

            # Normalizar Page ID a string
            final_page_id = None
            if page_id: final_page_id = str(page_id)
            elif actor_id: final_page_id = str(actor_id)

            if final_page_id:
                page_map[str(cid)] = final_page_id

        time.sleep(0.3)

    return page_map


# ---------------------------------------------------
# NOMBRE PAGINAS (CORREGIDO)
# ---------------------------------------------------

def obtener_nombres_paginas(page_ids):

    names = {}

    # Filtrar IDs nulos o vacíos
    page_ids = [pid for pid in page_ids if pid]

    if not page_ids:
        return names

    # Procesar en bloques de 50 para evitar errores de límite en batch
    for i in range(0, len(page_ids), 50):
        block = page_ids[i:i+50]
        batch = []

        for pid in block:
            batch.append({
                "method": "GET",
                "relative_url": f"{pid}?fields=name"
            })

        r = requests.post(
            f"{BASE_URL}/",
            data={
                "access_token": ACCESS_TOKEN,
                "batch": json.dumps(batch)
            }
        )

        responses = r.json()

        if not isinstance(responses, list):
            print("Error obteniendo nombres de páginas:", responses)
            continue

        for resp in responses:

            if resp.get("code") != 200:
                # Si falla, imprimimos el error para diagnóstico
                print(f"Error al obtener nombre de página (esto es normal si faltan permisos): {resp}")
                continue

            body = json.loads(resp.get("body", "{}"))

            pid = str(body.get("id")) if body.get("id") else None
            name = body.get("name")

            if pid and name:
                names[pid] = name
            elif pid:
                # Si tenemos ID pero no nombre, intentamos buscarlo en campos alternativos
                names[pid] = body.get("username") or body.get("about") or "Sin Nombre"

        time.sleep(0.3)

    return names


# ---------------------------------------------------
# OBTENER PAGINAS AUTORIZADAS (ME/ACCOUNTS)
# ---------------------------------------------------

def obtener_paginas_autorizadas():

    print("DEBUG - Consultando lista de páginas autorizadas (/me/accounts)...")
    names = {}
    url = f"{BASE_URL}/me/accounts"
    params = {"limit": 100}

    while True:
        r = requests.get(url, params={**params, "access_token": ACCESS_TOKEN})
        js = r.json()

        if "data" not in js:
            print("DEBUG - Error al consultar /me/accounts:", js)
            break

        for item in js["data"]:
            pid = str(item.get("id"))
            pname = item.get("name")
            if pid and pname:
                names[pid] = pname

        if "paging" in js and "next" in js["paging"]:
            url = js["paging"]["next"]
            params = {}
        else:
            break

    return names


# ---------------------------------------------------
# MAIN
# ---------------------------------------------------

print("Ingrese rango de fechas YYYY-MM-DD")
fecha_desde = input("Desde (Inicio): ")
fecha_hasta = input("Hasta (Fin): ")

rows = []

# Obtener nombres de páginas desde /me/accounts (Pre-emptive fallback)
me_page_names = obtener_paginas_autorizadas()
print(f"DEBUG - Páginas autorizadas encontradas: {len(me_page_names)}")

for account in AD_ACCOUNTS:

    insights = obtener_insights(account, fecha_desde, fecha_hasta)

    ad_ids = list({i["ad_id"] for i in insights if "ad_id" in i})
    print(f"DEBUG - Ad IDs encontrados: {len(ad_ids)}")

    creative_map = obtener_creatives(ad_ids)
    print(f"DEBUG - Mapping Ads -> Creative: {len(creative_map)}")

    creative_ids = list(set(creative_map.values()))
    print(f"DEBUG - Creative IDs únicos: {len(creative_ids)}")

    page_map = obtener_paginas(creative_ids)
    print(f"DEBUG - Mapping Creative -> Page: {len(page_map)}")

    page_ids = list(set(page_map.values()))
    print(f"DEBUG - Page IDs únicos encontrados: {len(page_ids)}")

    # Intentar obtener nombres vía API directa (para las que falten o todas)
    page_names_api = obtener_nombres_paginas(page_ids)

    # Combinar todas las fuentes: /me/accounts + Direct API
    final_page_names = {**me_page_names, **page_names_api}
    print(f"DEBUG - Nombres de página totales unificados: {len(final_page_names)}")

    for ins in insights:

        ad_id = str(ins.get("ad_id"))

        creative_id = creative_map.get(ad_id)

        page_id = page_map.get(creative_id)

        page_name = final_page_names.get(page_id)

        contacts = next(
            (a["value"] for a in ins.get("actions", [])
             if a["action_type"] == "onsite_conversion.messaging_conversation_started_7d"),
            0
        )

        ad_name = ins.get("ad_name", "")

        rows.append({

            "ID del anuncio": ad_id,
            "ID de la página": page_id,
            "Nombre de la página": page_name,

            "Nombre de la campaña": ins.get("campaign_name"),
            "Nombre del conjunto": ins.get("adset_name"),
            "Nombre del anuncio": ad_name,

            "codigo": extraer_codigo(ad_name),
            "precio": extraer_precio(ad_name),
            "tipo_post": extraer_tipo(ad_name),

            "SECUENCIA": obtener_secuencia(ins.get("campaign_name")),

            "Día": ins.get("date_start"),
            "Contactos mensajes nuevos": contacts,
            "Importe gastado": ins.get("spend"),

            "Inicio informe": ins.get("date_start"),
            "Fin informe": ins.get("date_stop")

        })

df = pd.DataFrame(rows)

# Exportar a Excel en lugar de CSV
output_file = "REPORTE_FACEBOOK_ADS.xlsx"
df.to_excel(output_file, index=False)

print(f"Archivo generado: {output_file}")
