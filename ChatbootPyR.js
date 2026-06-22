/* =========================================================
   SISTEMA DE MUEBLERÍA IA - Versión ChatbootPyR (V8.0)
   - Integración de Preguntas y Respuestas (P&R) mediante KV (pyr:listado)
   - Fuzzy Matching con AI para asegurar precisión en contexto
   - Dual-Persistence: Cache de estado en KV para mitigar latencia de API GHL
   - Improved Coverage: Detección proactiva de Departamentos para saltar pasos
   - Envío de imágenes individual para WhatsApp
========================================================= */

const ordenEstados = {
  nuevo: 0,
  catalogo: 1,
  producto: 2,
  precio: 3,
  objecion: 4,
  cierre: 5,
  confirmacion_categoria: 6,
  esperando_departamento: 7,
  esperando_municipio: 8
};

function getFieldId(env, key) {
  const variations = [
    "GHL_" + key.toUpperCase() + "_FIELD_ID",
    "GHL_" + key.toLowerCase() + "_FIELD_ID",
    "GHL_" + key + "_FIELD_ID",
    "GHL" + key.toUpperCase() + "FIELD_ID",
    "GHL" + key.toLowerCase() + "FIELD_ID",
    "GHL" + key + "FIELD_ID",
    key.toUpperCase(),
    key.toLowerCase(),
    key
  ];
  for (let v of variations) {
    if (env[v]) return env[v];
  }
  return null;
}

class TraceLog {
  constructor() {
    this.logs = ["[FLOW] === INICIO DE PROCESO === " + new Date().toISOString()];
  }
  add(msg) {
    this.logs.push("[" + new Date().toLocaleTimeString('es-GT') + "] [TRACE] " + msg);
  }
  obj(label, o) {
    try {
      this.logs.push("[" + new Date().toLocaleTimeString('es-GT') + "] [DATA] " + label + ": " + JSON.stringify(o));
    } catch (e) {
      this.logs.push("[" + new Date().toLocaleTimeString('es-GT') + "] [DATA] " + label + ": [Circular or Non-Serializable]");
    }
  }
  error(msg, err) {
    this.logs.push("[" + new Date().toLocaleTimeString('es-GT') + "] [ERROR] " + msg + (err ? (err.message || err) : ""));
  }
  flush() {
    console.log(this.logs.join("\n") + "\n[FLOW] === FIN DE PROCESO ===");
  }
}

function limpiarMensaje(rawMessage) {
  if (!rawMessage || typeof rawMessage !== "string") return "";
  const headlineMatch = rawMessage.match(new RegExp("Headline:\\s*(.*?)(?:\\n|$)", "i"));
  const headline = headlineMatch ? headlineMatch[1] : "";
  let cleaned = rawMessage.replace(new RegExp("Headline:.*?\\n", "gi"), "").replace(new RegExp("Source URL:.*?\\n", "gi"), "").replace(/Message Details/gi, "").trim();
  return (cleaned.length < 5 && headline) ? headline + " " + cleaned : cleaned;
}

function normalizarTextoGlobal(str) {
  if (!str) return "";
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").replace(/z/g, "s").trim();
}

function normalizarEntradaAvanzada(texto) {
  let t = normalizarTextoGlobal(texto);
  const sinonimos = {
    "closet": "ropero",
    "placard": "ropero",
    "guardarropa": "ropero",
    "chilero": "bonito",
    "peinador": "marquesa",
    "tocador": "marquesa",
    "marqueza": "marquesa",
    "matrimonial": "matri",
    "cosina": "cocina"
  };
  Object.keys(sinonimos).forEach(key => {
    t = t.replace(new RegExp("\\b" + key + "\\b", "g"), sinonimos[key]);
  });
  return t;
}

function getCustomFieldValue(contact, fieldId) {
  if (!contact || !Array.isArray(contact.customFields) || !fieldId) return null;
  const field = contact.customFields.find(f => f.id === fieldId);
  return field ? (field.value || field.field_value) : null;
}

async function getContactFromGHL(contactId, env, trace) {
  try {
    const res = await fetch("https://services.leadconnectorhq.com/contacts/" + contactId, {
      method: "GET",
      headers: {
        "Authorization": "Bearer " + env.GHL_API_KEY,
        "Content-Type": "application/json",
        "Version": "2021-07-28"
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.contact;
  } catch (err) {
    return null;
  }
}

async function getLatestMessageAttachments(contactId, locationId, env, trace) {
  if (trace) trace.add("Buscando conversación para contactId: " + contactId);
  try {
    // 1. Get conversation ID
    const convRes = await fetch("https://services.leadconnectorhq.com/conversations/search?contactId=" + contactId + "&locationId=" + locationId, {
      method: "GET",
      headers: {
        "Authorization": "Bearer " + env.GHL_API_KEY,
        "Content-Type": "application/json",
        "Version": "2021-04-15"
      }
    });
    if (!convRes.ok) {
      if (trace) trace.add("Error buscando conversación: " + convRes.status);
      return [];
    }
    const convData = await convRes.json();
    const conversationId = convData.conversations?.[0]?.id;
    if (!conversationId) {
      if (trace) trace.add("No se encontró conversación.");
      return [];
    }

    // 2. Get latest message (with retry)
    for (let i = 0; i < 2; i++) {
      if (trace) trace.add("Buscando mensajes para conversación: " + conversationId + " (Intento " + (i + 1) + ")");
      const msgRes = await fetch("https://services.leadconnectorhq.com/conversations/" + conversationId + "/messages?limit=1", {
        method: "GET",
        headers: {
          "Authorization": "Bearer " + env.GHL_API_KEY,
          "Content-Type": "application/json",
          "Version": "2021-04-15"
        }
      });
      if (!msgRes.ok) {
        if (trace) trace.add("Error buscando mensajes: " + msgRes.status);
        continue;
      }
      const msgData = await msgRes.json();
      if (trace) trace.obj("Respuesta API Mensajes", msgData);

      const latestMsg = msgData.messages?.[0];
      if (latestMsg) {
        if (trace) trace.obj("Último mensaje de la API", latestMsg);
        return latestMsg.attachments || [];
      }

      if (i === 0) {
        if (trace) trace.add("No se encontraron mensajes, esperando 1s para reintentar...");
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    return [];
  } catch (err) {
    if (trace) trace.error("Excepción en getLatestMessageAttachments: ", err);
    return [];
  }
}

async function saveKVState(contactId, state, env) {
  if (!contactId || !state) return;
  try {
    await env.PRODUCTS_DB.put("state:" + contactId, JSON.stringify({
      ...state,
      updatedAt: Date.now()
    }), {
      expirationTtl: 3600
    }); // 1 hour persistence
  } catch (e) { }
}

async function setCustomFieldValue(contact, fieldId, value, env, trace, stateToUpdate = null, stateKey = null) {
  if (trace) trace.add("Actualizando campo custom: " + fieldId + " -> " + value);
  if (!fieldId || value === undefined || value === null) return;

  // Actualizar cache local si se proporciona
  if (stateToUpdate && stateKey) {
    stateToUpdate[stateKey] = value;
    await saveKVState(contact.id, stateToUpdate, env);
  }

  try {
    const res = await fetch("https://services.leadconnectorhq.com/contacts/" + contact.id, {
      method: "PUT",
      headers: {
        "Authorization": "Bearer " + env.GHL_API_KEY,
        "Content-Type": "application/json",
        "Version": "2021-07-28"
      },
      body: JSON.stringify({
        customFields: [{
          id: fieldId,
          value: value,
          field_value: value
        }]
      })
    });
    if (!res.ok && trace) trace.add("Error update field: " + res.status);
  } catch (err) { }
}

async function addToWorkflow(contactId, workflowId, env, trace) {
  if (trace) trace.add("Añadiendo contacto a workflow: " + workflowId);
  try {
    const eventStartTime = new Date().toISOString().split(".")[0] + "+00:00";
    await fetch("https://services.leadconnectorhq.com/contacts/" + contactId + "/workflow/" + workflowId, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.GHL_API_KEY,
        "Content-Type": "application/json",
        "Version": "2021-07-28"
      },
      body: JSON.stringify({
        eventStartTime
      })
    });
  } catch (err) { }
}

async function sendMessageToGHL(contactId, text, env, trace, imagenes = [], locationId = null, conversationId = null) {
  if (trace) trace.add("Enviando mensaje a GHL. Texto: " + (text ? text.substring(0, 50) + "..." : "N/A") + " Imágenes: " + (imagenes?.length || 0));
  if (!text && (!imagenes || imagenes.length === 0)) return false;
  const filtradas = (Array.isArray(imagenes) ? imagenes : [imagenes])
    .map(img => typeof img === "string" ? img : (img?.url || img?.link || img?.link_publico || img?.imagen1 || img?.imagen2 || img?.imagen))
    .filter(url => typeof url === "string" && url.length > 10 && url.startsWith("http"));

  let success = false;
  if (text && text.trim()) {
    try {
      const payload = {
        type: "WhatsApp",
        contactId: contactId,
        message: text,
        text: {
          body: text
        },
        direction: "outbound"
      };
      if (locationId) payload.locationId = locationId;
      if (conversationId) payload.conversationId = conversationId;
      if (trace) trace.obj("GHL Payload Texto", payload);
      const res = await fetch("https://services.leadconnectorhq.com/conversations/messages", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + env.GHL_API_KEY,
          "Content-Type": "application/json",
          "Version": "2021-04-15"
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        success = true;
        if (trace) trace.add("Mensaje de texto enviado OK.");
      } else {
        const errTxt = await res.text();
        if (trace) trace.add("Error enviando texto (Status " + res.status + "): " + errTxt);
      }
    } catch (err) {
      if (trace) trace.error("Excepción enviando texto: ", err);
    }
  }
  for (let imgUrl of filtradas.slice(0, 5)) {
    try {
      await new Promise(r => setTimeout(r, 1500));
      const payload = {
        type: "WhatsApp",
        contactId: contactId,
        message: imgUrl,
        text: {
          body: imgUrl
        },
        direction: "outbound"
      };
      if (locationId) payload.locationId = locationId;
      if (conversationId) payload.conversationId = conversationId;
      await fetch("https://services.leadconnectorhq.com/conversations/messages", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + env.GHL_API_KEY,
          "Content-Type": "application/json",
          "Version": "2021-04-15"
        },
        body: JSON.stringify(payload)
      });
    } catch (err) { }
  }
  return success;
}

async function handleMediaAttachment(attachment, env, trace) {
  if (trace) trace.obj("Iniciando handleMediaAttachment con data", attachment);
  let url = typeof attachment === "string" ? attachment : (attachment?.url || attachment?.link || attachment?.attachment || attachment?.location);

  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    if (trace) trace.add("URL de adjunto no válida o ausente.");
    return "";
  }

  try {
    if (trace) trace.add("Haciendo fetch a URL de adjunto: " + url);
    const res = await fetch(url);
    if (trace) trace.add("Resultado fetch attachment: " + res.status + " " + res.statusText);
    if (!res.ok) {
      const errTxt = await res.text();
      if (trace) trace.add("Error fetch attachment: " + errTxt);
      return "";
    }
    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "";
    const ext = url.split(".").pop().toLowerCase();

    if (contentType.includes("image") || ["jpg", "jpeg", "png", "webp"].includes(ext)) {
      if (trace) trace.add("Procesando como imagen (OCR). Content-Type: " + contentType);
      // Vision OCR - Chunked base64 conversion to avoid RangeError
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const CHUNK_SIZE = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE));
      }
      const base64 = btoa(binary);
      if (trace) trace.add("Base64 generado (length): " + base64.length);

      if (trace) trace.add("Llamando a OpenAI Vision para OCR...");
      const ocrResp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + (env.OPENAI_API_KEY || "MISSING")
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{
            role: "user",
            content: [{
              type: "text",
              text: "Extrae el texto de esta imagen. Si no hay texto o es un mueble, describe brevemente qué mueble o producto ves (ej: Es un ropero de madera café)."
            }, {
              type: "image_url",
              image_url: {
                url: "data:" + contentType + ";base64," + base64
              }
            }]
          }]
        })
      });
      const ocrData = await ocrResp.json();
      if (trace) trace.obj("OpenAI OCR Response", ocrData);
      const textFound = ocrData.choices?.[0]?.message?.content || "";
      if (trace) trace.add("Texto extraído OCR: " + textFound);
      return textFound;
    } else if (contentType.startsWith("audio/") || ["mp3", "wav", "m4a", "ogg", "opus"].includes(ext) || contentType.includes("octet-stream")) {
      if (trace) trace.add("Procesando como audio (Whisper). Content-Type: " + contentType);
      // Whisper Transcription
      const formData = new FormData();
      const audioBlob = new Blob([buffer], {
        type: contentType.includes("octet-stream") ? "audio/mpeg" : contentType
      });
      formData.append("file", audioBlob, "audio." + (ext && ext.length < 5 ? ext : "mp3"));
      formData.append("model", "whisper-1");
      if (trace) trace.add("Llamando a OpenAI Whisper...");
      const transcriptionResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + (env.OPENAI_API_KEY || "MISSING")
        },
        body: formData
      });
      const transData = await transcriptionResp.json();
      if (trace) trace.obj("OpenAI Whisper Response", transData);
      if (trace) trace.add("Texto transcrito: " + (transData.text || "N/A"));
      return transData.text || "";
    }
  } catch (e) {
    if (trace) trace.error("Error media: ", e);
  }
  return "";
}

async function getProductList(env, trace) {
  try {
    const raw = await env.PRODUCTS_DB.get("productos:listado");
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

async function triggerHandover(contactId, env, trace) {
  if (trace) trace.add("Iniciando Handover (Traspaso a humano)");
  try {
    await fetch("https://services.leadconnectorhq.com/contacts/" + contactId, {
      method: "PUT",
      headers: {
        "Authorization": "Bearer " + env.GHL_API_KEY,
        "Content-Type": "application/json",
        "Version": "2021-07-28"
      },
      body: JSON.stringify({
        tags: ["humano"]
      })
    });
    if (env.GHL_HANDOVER_WORKFLOW_ID) await addToWorkflow(contactId, env.GHL_HANDOVER_WORKFLOW_ID, env, trace);
  } catch (err) { }
}

async function obtenerRespuestaCoverage(texto, env, trace) {
  if (trace) trace.add("Buscando cobertura para: " + texto);
  try {
    const listadoRaw = await env.COVERAGE_DB.get("coverage:listado");
    const listado = JSON.parse(listadoRaw || "[]");
    const m = normalizarTextoGlobal(texto);
    for (const item of listado) {
      const u = normalizarTextoGlobal(item.ubicacion);
      if (u.length > 3 && m.includes(u)) {
        if (trace) trace.add("Cobertura encontrada para: " + u);
        return item.respuesta;
      }
    }
  } catch (e) {
    if (trace) trace.error("Error en obtenerRespuestaCoverage: ", e);
  }
  return null;
}

/**
 * Función para buscar respuestas en el listado de P&R (Preguntas y Respuestas)
 * Utiliza AI para un Fuzzy Matching preciso.
 */
async function obtenerRespuestaPyR(mensaje, env, trace) {
  if (trace) trace.add("Buscando P&R para: " + mensaje);
  try {
    const listadoRaw = await env.PRODUCTS_DB.get("pyr:listado");
    if (!listadoRaw) return null;
    const listado = JSON.parse(listadoRaw);
    if (!Array.isArray(listado) || listado.length === 0) return null;

    // Prompt para Fuzzy Matching con AI
    const prompt = `El usuario dijo: "${mensaje}"
    A continuación hay una lista de Preguntas y Respuestas predefinidas:
    ${listado.map((item, i) => `${i}. P: ${item.pregunta} | R: ${item.respuesta}`).join('\n')}

    ¿Alguna de estas preguntas coincide con la intención del usuario?
    Responde ÚNICAMENTE con el índice numérico (0, 1, 2...) de la mejor coincidencia.
    Si ninguna coincide realmente o el mensaje es un simple saludo o selección de producto, responde "NULL".`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + env.OPENAI_API_KEY
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "Eres un clasificador de preguntas preciso que ayuda a encontrar la mejor respuesta predefinida." }, { role: "user", content: prompt }],
        temperature: 0
      })
    });
    const data = await res.json();
    const result = data.choices[0].message.content.trim();

    if (result !== "NULL" && !isNaN(result)) {
      const index = parseInt(result);
      if (listado[index]) {
        if (trace) trace.add("P&R encontrada mediante AI: " + listado[index].pregunta);
        return listado[index].respuesta;
      }
    }
  } catch (e) {
    if (trace) trace.error("Error en obtenerRespuestaPyR: ", e);
  }
  return null;
}

async function analizarSiEsUbicacion(mensaje, env, trace) {
  if (trace) trace.add("Analizando si el mensaje es una ubicación: " + mensaje);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + env.OPENAI_API_KEY
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{
          role: "system",
          content: "Eres un experto en geografía de Guatemala. El usuario te enviará un mensaje y debes determinar si contiene el nombre de un municipio o departamento de Guatemala. Responde 'SI' o 'NO' únicamente."
        }, {
          role: "user",
          content: mensaje
        }],
        temperature: 0
      })
    });
    const data = await res.json();
    const result = data.choices[0].message.content.trim().toUpperCase();
    if (trace) trace.add("Resultado análisis ubicación: " + result);
    return result === "SI";
  } catch (err) {
    return false;
  }
}

async function fuzzyMatchMunicipio(municipio, listaMunicipios, env, trace) {
  const prompt = "El cliente escribió '" + municipio + "'. Los válidos son: " + listaMunicipios.join(", ") + ". ¿Cuál es el correcto? Responde SOLO el nombre o 'NULL'.";
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + env.OPENAI_API_KEY
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{
          role: "system",
          content: "Responde solo con el nombre."
        }, {
          role: "user",
          content: prompt
        }],
        temperature: 0
      })
    });
    const data = await res.json();
    return data.choices[0].message.content.trim();
  } catch (err) {
    return "NULL";
  }
}

async function obtenerProductoSeguro(id, env, trace) {
  if (trace) trace.add("Buscando producto seguro para ID: " + id);
  if (!id) return null;
  let rid = id.toString().trim().toUpperCase();
  if (rid.includes(":")) rid = rid.split(":").pop();
  const rawCombo = await env.PRODUCTS_DB.get("combo:" + rid);
  const meta = await env.PRODUCTS_DB.get("combo_meta:" + rid, {
    type: "json"
  });
  if (rawCombo || meta) {
    if (trace) trace.add("Detectado como COMBO: " + rid);
    let items = [];
    let totalPiezas = 0;
    if (rawCombo) {
      const parts = rawCombo.split(/[\s,]+/).map(s => s.trim()).filter(s => s);
      for (let i = 0; i < parts.length; i += 2) {
        const cId = parts[i];
        const qty = parseInt(parts[i + 1]) || 1;
        const pData = await env.PRODUCTS_DB.get("individual:" + cId, {
          type: "json"
        });
        if (pData) {
          const tit = (pData.titulo || pData.nombre || "").toUpperCase();
          if (!tit.includes("FLETE") && !cId.toUpperCase().includes("FLETE")) totalPiezas += qty;
          items.push({
            p: pData,
            q: qty
          });
        }
      }
    }
    const res = {
      id: rid,
      key: "combo:" + rid,
      tipo: "combo",
      conteo_piezas: totalPiezas,
      titulo: meta?.titulo || ("Combo " + rid),
      precio: meta?.precio || items.reduce((t, i) => t + ((parseFloat(i.p.precio) || 0) * i.q), 0),
      descripcion: meta?.descripcion || "",
      medidas: meta?.medidas || items.map(i => (i.p.titulo || i.p.nombre) + ": " + (i.p.medidas || "N/A")).filter(x => !x.endsWith(": N/A")).join("\n"),
      estructura: meta?.estructura || items.map(i => (i.p.titulo || i.p.nombre) + ": " + (i.p.estructura || "N/A")).filter(x => !x.endsWith(": N/A")).join("\n"),
      colores: meta?.colores || items.map(i => (i.p.titulo || i.p.nombre) + ": " + (i.p.colores || "N/A")).filter(x => !x.endsWith(": N/A")).join("\n"),
      resistencia_peso: meta?.resistencia_peso || items.map(i => (i.p.titulo || i.p.nombre) + ": " + (i.p.resistencia_peso || "N/A")).filter(x => !x.endsWith(": N/A")).join("\n"),
      garantia: meta?.garantia || items.map(i => (i.p.titulo || i.p.nombre) + ": " + (i.p.garantia || "N/A")).filter(x => !x.endsWith(": N/A")).join("\n"),
      imagenes: [meta?.imagen1, meta?.imagen2, ...items.flatMap(i => [i.p.imagen1, i.p.imagen2, i.p.imagen, i.p.url, i.p.link, i.p.link_publico])].filter(img => typeof img === "string" && img.length > 10 && img.startsWith("http")),
      ficha_combinada: items.map(i => {
        const pre = i.q > 1 ? "(" + i.q + " Unidades) " : "";
        return "[" + pre + (i.p.titulo || i.p.nombre) + "] - Medidas: " + (i.p.medidas || "N/A") + " - Material: " + (i.p.estructura || "N/A") + " - Colores: " + (i.p.colores || "N/A");
      }).join("\n"),
      ...(meta || {}),
      items: items.map(i => i.p)
    };
    res.imagenes = [...new Set(res.imagenes)];
    return res;
  }
  const ind = await env.PRODUCTS_DB.get("individual:" + rid, {
    type: "json"
  });
  if (ind) {
    if (trace) trace.add("Detectado como INDIVIDUAL: " + rid);
    const basePrice = parseFloat(ind.precio) || 0;
    const finalPrice = basePrice > 0 ? (basePrice + 200) : 0;
    return {
      ...ind,
      id: rid,
      key: "individual:" + rid,
      tipo: "individual",
      precio: finalPrice,
      titulo: ind.titulo || ind.nombre,
      imagenes: [ind.imagen1, ind.imagen2, ind.link_publico, ind.url, ind.link, ind.imagen].filter(img => typeof img === "string" && img.length > 10 && img.startsWith("http"))
    };
  }
  return null;
}

async function buscarComboAlternativoPorTamano(currentCombo, targetSize, env, trace) {
  if (!currentCombo || currentCombo.tipo !== "combo") return null;
  const listado = await getProductList(env, trace);
  const curTitle = normalizarTextoGlobal(currentCombo.titulo || "");
  const baseParts = curTitle.replace(/\b(matri|queen|king|matrimonial)\b/g, "").split(/\s+/).filter(p => p.length > 3);

  const bestMatch = listado.find(p => {
    const t = normalizarTextoGlobal(p.nombre || p.titulo || "");
    const key = (p.key || "").toLowerCase();
    const isCombo = key.includes("combo") || t.includes("combo") || t.includes("amueblado");
    if (!isCombo) return false;
    const hasTargetSize = t.includes(targetSize);
    if (!hasTargetSize) return false;
    return baseParts.some(p => t.includes(p));
  });

  if (bestMatch) {
    const id = bestMatch.key ? bestMatch.key.split(":").pop() : null;
    if (id) return await obtenerProductoSeguro(id, env);
  }
  return null;
}

async function buscarProductoPorNombreEnMensaje(mensaje, env, trace) {
  if (trace) trace.add("Buscando producto por nombre en mensaje...");
  try {
    const listado = await getProductList(env, trace);
    const m = normalizarTextoGlobal(mensaje);
    const ignorar = ["cocina", "ropero", "cama", "mueble", "amueblado", "comedor", "sofa", "gavetero", "tocador", "cabecera", "mesita", "librera"];
    if (m.length < 4) return null;
    let mejorMatch = null;
    let maxScore = 0;
    for (const p of listado) {
      const nombre = normalizarTextoGlobal(p.nombre || p.titulo || "");
      if (nombre.length < 4) continue;
      let score = 0;
      const palabras = nombre.split(" ");
      for (let pal of palabras) {
        if (pal.length > 4 && !ignorar.includes(pal) && m.includes(pal)) score += pal.length;
      }
      if (score > maxScore && score >= 10) {
        maxScore = score;
        mejorMatch = p;
      }
    }
    if (mejorMatch) {
      if (trace) trace.add("Mejor match por nombre: " + (mejorMatch.nombre || mejorMatch.titulo) + " Score: " + maxScore);
      const id = mejorMatch.key ? mejorMatch.key.split(":").pop() : null;
      if (id) return await obtenerProductoSeguro(id, env, trace);
    }
  } catch (e) {
    if (trace) trace.error("Error en buscarProductoPorNombreEnMensaje: ", e);
  }
  return null;
}

async function buscarProductoPorCodigoEnMensaje(mensaje, env, trace) {
  if (trace) trace.add("Buscando producto por código en mensaje...");
  try {
    const listado = await getProductList(env, trace);
    const m = mensaje.toUpperCase();
    for (const p of listado) {
      const idFromKey = (p.key || "").toUpperCase().split(':').pop();
      const codigo = (p.sku || "").toUpperCase() || idFromKey;
      if (codigo && codigo.length > 4 && m.includes(codigo)) {
        if (trace) trace.add("Código encontrado en mensaje: " + codigo);
        return await obtenerProductoSeguro(codigo, env, trace);
      }
    }
  } catch (e) {
    if (trace) trace.error("Error en buscarProductoPorCodigoEnMensaje: ", e);
  }
  return null;
}

function detectarSeleccionNatural(mensaje, lista) {
  if (!Array.isArray(lista) || lista.length === 0) return null;
  const m = normalizarEntradaAvanzada(mensaje);

  if (lista.length === 1) {
    const pideDetalle = /\b(interesa|interes|comprar|fotos|imagenes|colores|medidas|material|combo|llevarmelo|llevarmela)\b/i.test(m);
    if (pideDetalle) return 0;
  }

  const matchPrecio = m.match(/\b(?:q|qt)?\s?(\d{3,5})\b/i);
  if (matchPrecio) {
    const precioMsg = parseInt(matchPrecio[1]);
    const idxPrecio = lista.findIndex(p => {
      const pProd = parseInt(p.precio?.toString().replace(/[^\d]/g, ""));
      return pProd === precioMsg || (pProd > 0 && Math.abs(pProd - precioMsg) <= 10);
    });
    if (idxPrecio !== -1) return idxPrecio;
  }

  if (/\b(medida|cuanto|precio|limpia|resiste|material|fotos|imagenes|color|garantia|dimension)\b/i.test(m)) return null;

  const mapa = {
    "primero": 0, "primer": 0, "uno": 0, "la 1": 0, "el 1": 0, "segundo": 1, "dos": 1, "la 2": 1, "el 2": 1, "tercero": 2, "tres": 2, "la 3": 2, "el 3": 2, "cuarto": 3, "cuatro": 3, "la 4": 3, "el 4": 3, "ultimo": lista.length - 1
  };
  for (let key in mapa) {
    if (new RegExp("\\b" + key + "\\b", "i").test(m)) return mapa[key];
  }
  const matchNum = /\b([1-4])\b(?!\s*(cuerpo|puerta|plaza|gaveta|cajon|c|k|q|p|mt|cm|unid|pieza))/i.exec(m);
  if (matchNum) {
    const idx = parseInt(matchNum[1]) - 1;
    if (idx < lista.length) return idx;
  }
  const scores = lista.map((item, index) => {
    const textoBase = normalizarTextoGlobal(item.nombre || item.titulo || "");
    let score = 0;
    const ignorar = ["cocina", "ropero", "cama", "mueble", "amueblado", "comedor", "sofa", "gavetero", "tocador", "cabecera", "mesita", "librera"];
    const pesos = {
      "arisona": 60, "frostmont": 60, "wengue": 60, "slah": 60, "estandar": 30
    };
    Object.keys(pesos).forEach(p => {
      if (m.includes(p) && textoBase.includes(p)) score += pesos[p];
    });
    m.split(/\s+/).forEach(word => {
      if (word.length >= 5 && !ignorar.includes(word) && textoBase.includes(word)) score += 15;
    });
    return {
      index, score
    };
  });
  const ganador = scores.sort((a, b) => b.score - a.score)[0];
  return (ganador && ganador.score >= 15) ? ganador.index : null;
}

async function callVendedorElitePro(message, contact, env, productoActual, intencionCierre, coverage, esSoloSaludo = false, esPrimerMensaje = false, yaEnvioMenu = false, esNuevoProducto = false, confirmandoCat = null, pideFotos = false, trace = null, pyrInfo = null) {
  if (trace) trace.add("Llamando a OpenAI (VendedorElitePro). Producto: " + (productoActual?.titulo || "Ninguno") + " esPrimerMensaje: " + esPrimerMensaje);
  let info = "";
  if (productoActual) {
    const p = productoActual;
    const fullSpecs = "Medidas: " + (p.medidas || "N/A") + "\nMaterial: " + (p.estructura || "N/A") + "\nColores: " + (p.colores || "N/A") + "\nResistencia: " + (p.resistencia_peso || "N/A") + "\nGarantía: " + (p.garantia || "N/A");
    if (esNuevoProducto) {
      info = "PRODUCTO: " + p.titulo + "\nPrecio: Q" + p.precio + "\nDescripción: " + (p.descripcion || "N/A") + (p.tipo === "combo" ? "\nComponentes: " + (p.ficha_combinada || "N/A") : "") + "\n(NOTA: El resto de especificaciones técnicas están ocultas para esta primera respuesta, solo da el resumen)";
    } else if (p.tipo === "combo") {
      info = "PRODUCTO: " + p.titulo + " (Combo de " + p.conteo_piezas + " piezas)\nPrecio: Q" + p.precio + "\nDescripción: " + (p.descripcion || "N/A") + "\n" + fullSpecs + "\nComponentes del combo:\n" + p.ficha_combinada;
    } else {
      info = "PRODUCTO: " + p.titulo + "\nPrecio: Q" + p.precio + "\nDescripción: " + (p.descripcion || "N/A") + "\n" + fullSpecs;
    }
  }

  // Integración de P&R en el contexto de la IA
  if (pyrInfo) {
    info += "\n\nINFORMACIÓN DE P&R PREDEFINIDA (USAR COMO PRIORIDAD): " + pyrInfo;
  }

  const mostrarMenu = !!productoActual && !esSoloSaludo && (!yaEnvioMenu || esNuevoProducto);
  const instruccionSaludo = esPrimerMensaje ? "Saluda amablemente al inicio." : "ESTÁ PROHIBIDO SALUDAR. Ve directo al punto.";

  let reglas = [
    "1. BREVEDAD: Máximo 2 oraciones normalmente. Evita saltos de línea excesivos.",
    "2. LISTAS: Usa viñetas atractivas (ej: ✨ o 📍) para características y componentes.",
    "3. NATURALIDAD: PROHIBIDO usar etiquetas como 'Producto:', 'Resumen:', 'Estado:', o '¡Invita a comprar!'. Escribe como un humano en un chat. Usa negritas con un solo asterisco (ej: *texto*) para resaltar nombres y precios.",
    "4. PRESENTACIÓN: Si esNuevoProducto es TRUE, DEBES resumir la 'Descripción' y mencionar brevemente los 'Componentes' usando una lista atractiva. PROHIBIDO dar Medidas, Material, Colores, Resistencia o Garantía en este primer mensaje a menos que el cliente ya haya preguntado.",
    "5. COMBOS: Si el cliente pide Medidas, Colores o Materiales de un COMBO, debes revisar la información de cada componente en los DATOS PRODUCTO y dar una respuesta detallada para cada uno.",
    "6. SOLO LO SOLICITADO: No divagues. Si el cliente pide algo técnico (medidas, materiales), búscalo en DATOS PRODUCTO y dalo de inmediato. NO respondas únicamente con el menú de ayuda.",
    "7. AYUDA: " + (mostrarMenu ? "Al final añade una frase amable indicando que puedes informar sobre: Medidas, Colores, Materiales, Precios, Envío y Cuotas. DEBES poner un doble salto de línea antes de esta frase." : "NO añadas temas de ayuda."),
    "8. COMPRA: " + (pideFotos ? "Después de la ayuda, añade una invitación para comprar solicitando estos datos en listado vertical:\n- Nombre\n- DPI\n- Dirección\n- Teléfono" : ""),
    "9. EMOJIS: Máximo uno (fuera de las listas).",
    "10. CIERRE: NUNCA pidas datos si el cliente tiene dudas. Responde primero la duda.",
    "11. SALUDO: " + instruccionSaludo + " (Incluso evita '¡Hola!', 'Buen día', etc. si no es el primer mensaje).",
    "12. REDUNDANCIA: No repitas la misma frase exacta si el cliente insiste. Si ya diste una información (como el color) y vuelven a preguntar, confirma que es el único disponible o amplía con detalles de la descripción.",
    "13. ESTRUCTURA: Si el cliente pregunta sobre temas estructurales (ej: 'se desarma', 'es colgante', 'se dobla', 'empotra', 'pared', 'madera tipo') y la información NO ESTÁ en los DATOS PRODUCTO ni en P&R PREDEFINIDA, DEBES responder exactamente '[TRANSFERIR]'.",
    "14. P&R: Si se proporciona INFORMACIÓN DE P&R PREDEFINIDA, úsala como la fuente de verdad absoluta para responder la duda del cliente de forma natural, combinándola con los datos del producto si es relevante.",
    "15. PAGOS: Aceptamos hasta 18 Visa Cuotas SIN RECARGO. Otros métodos: Tarjetas Débito/Crédito, Pago Contra Entrega y Depósito. NO tenemos crédito propio, solo Visa Cuotas.",
    "16. TIENDAS: \n- Petapa: AV Petapa 41-25 zona 12 Guatemala, frente del IRTRA. Tel: 5253 5965. Ubicación: https://maps.app.goo.gl/UbDQxjRqruWjhdXW9\n- Xenacoj: KM 40 zona 0 lote 91 carretera a Santo Domingo Xenacoj. Tel: 5253 3898. Ubicación: https://maps.app.goo.gl/4u9FqSDemcFy3zkv7",
    "17. COLCHÓN: Si el cliente menciona la palabra 'colchón' o pregunta por sus materiales, DEBES incluir esta información: 'es de fibra de algodón con polipropileno, que brinda una buena firmeza, resistencia y acolchonamiento'."
  ];
  if (confirmandoCat) {
    reglas.push("18. CONFIRMACIÓN: Cliente mencionó '" + confirmandoCat + "'. Pregunta si desea ver esa categoría o seguir con " + (productoActual ? productoActual.titulo : "lo actual") + ".");
  }
  const prompt = "Eres un asesor de ventas amable de La Mueblería. REGLAS:\n" + reglas.join("\n") + "\n\nDATOS PRODUCTO:\n" + info + "\n\nMensaje cliente: " + message;
  try {
    if (trace) trace.add("Prompt enviado a OpenAI (resumen): " + prompt.substring(0, 100) + "...");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + env.OPENAI_API_KEY
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{
          role: "system",
          content: "Asesor de chat. Habla natural. Sin etiquetas estructuradas. Si no sabes algo estructural, di [TRANSFERIR]."
        }, {
          role: "user",
          content: prompt
        }],
        temperature: 0.1
      })
    });
    const data = await res.json();
    if (trace) trace.obj("OpenAI Vendedor Response", data);
    let content = data.choices[0].message.content;
    if (!mostrarMenu) {
      const lines = content.split("\n");
      const filteredLines = lines.filter(line => {
        const isHelpLine = /(?:informar sobre|ayudarte con|detalles sobre|puedo darle|puedo informarle).*(?:Medidas|Colores|Materiales|Precios|Envío|Cuotas)/gi.test(line);
        return !isHelpLine;
      });
      content = filteredLines.join("\n").trim();
      if (!content && data.choices[0].message.content) {
        content = data.choices[0].message.content.trim();
      }
    }
    return content;
  } catch (err) {
    return "Con gusto le ayudo.";
  }
}

async function moduloCatalogo(message, contact, env, trace, forcingCat = null) {
  if (trace) trace.add("Entrando a moduloCatalogo. ForcingCat: " + forcingCat);
  const m = forcingCat || normalizarEntradaAvanzada(message);
  const listado = await getProductList(env, trace);
  const categorias = ["cama", "cocina", "ropero", "sofa", "comedor", "gavetero", "tocador", "cabecera", "mesita", "librera", "mesa", "trinchante", "platera", "mueble", "amueblado"];
  const fUltimaCat = getFieldId(env, "ultima_categoria");
  const fFiltroTamano = getFieldId(env, "filtro_tamano");
  const fOffset = getFieldId(env, "catalogo_offset");

  let catFound = categorias.find(c => m.includes(c));
  let cat = catFound || getCustomFieldValue(contact, fUltimaCat) || "muebles";
  let tamano = getCustomFieldValue(contact, fFiltroTamano);

  const mTamano = m.match(/\b(mediano|mediana|medianos|medianas|grande|grandes|pequeño|pequeña|pequeños|pequeñas|chico|chica|chicos|chicas|enorme|enormes|gigante|gigantes|estandar|media|grando|grandos|amplio|amplios|espacioso|espaciosos)\b/i);
  if (mTamano) {
    const matched = mTamano[1].toLowerCase();
    const isMed = /median|peque|chico|chica|estandar|media/.test(matched);
    tamano = isMed ? "mediano" : "grande";
    await setCustomFieldValue(contact, fFiltroTamano, tamano, env, trace);
  }
  if (catFound) await setCustomFieldValue(contact, fUltimaCat, cat, env, trace);

  const esPreCatalogo = /\b(mueble|muebles|amueblado|amueblados|enseres|articulos|modelos|opciones)\b/i.test(m);
  if (!catFound && esPreCatalogo) {
    if (trace) trace.add("Pre-catálogo disparado: Término general detectado.");
    return { text: "¡Con gusto le ayudo! Contamos con gran variedad de muebles para su hogar. 🏠\n\n¿Busca opciones de *CAMAS*, *COCINAS* o *ROPEROS*? 😉" };
  }

  if (!cat || cat === "muebles") {
    return { text: "Bienvenido. ¿En qué puedo ayudarle hoy? Contamos con variedad de:\n\n✨ CAMAS\n✨ COCINAS\n✨ ROPEROS\n✨ SALAS\n✨ COMEDORES\n✨ GAVETEROS\n\n¿Cuál le gustaría conocer? 😉" };
  }

  if (!tamano) {
    const genero = /cama|cocina|sala|mesa/.test(cat) ? "a" : "o";
    const displaySize = genero === "a" ? "mediana" : "mediano";
    return {
      text: "¿Busca opciones de " + cat.toUpperCase() + " en tamaño " + displaySize + " o grande? 😉"
    };
  }

  const filteredList = (cat === "muebles") ? listado : listado.filter(p => normalizarTextoGlobal(p.nombre || p.titulo).includes(cat));
  const combos = filteredList.filter(p => {
    const k = (p.key || "").toLowerCase();
    const n = (p.nombre || p.titulo || "").toLowerCase();
    return k.includes("combo") || n.includes("combo") || n.includes("amueblado");
  });

  let resultados = [];
  if (tamano === "mediano") {
    if (cat === "cama") resultados = combos.filter(p => {
      const n = normalizarTextoGlobal(p.nombre || p.titulo);
      return n.includes("matri") || n.includes("queen");
    });
    else if (cat === "ropero" || cat === "cocina") resultados = combos.filter(p => (parseFloat(p.precio) || 0) <= 3499);
    else resultados = combos.filter(p => (parseFloat(p.precio) || 0) <= 5000);
  } else if (tamano === "grande") {
    if (cat === "cama") resultados = combos.filter(p => normalizarTextoGlobal(p.nombre || p.titulo).includes("king"));
    else if (cat === "ropero" || cat === "cocina") resultados = combos.filter(p => (parseFloat(p.precio) || 0) >= 3500);
    else resultados = combos.filter(p => (parseFloat(p.precio) || 0) > 5000);
  }

  const mNorm = normalizarTextoGlobal(message);
  const stopWords = ["combo", "combos", "opciones", "otros", "otras", "promociones", "promocion", "catálogo", "muestreme", "mostrame", "ver", "mas", "quiero", "gustaria", "tiene"];
  const specs = mNorm.split(/\s+/).filter(word => word.length >= 4 && !stopWords.includes(word) && !categorias.includes(word) && !/mediano|mediana|medianos|medianas|grande|grandes|pequeño|pequeña|pequeños|pequeñas|chico|chica|chicos|chicas|enorme|enormes|gigante|gigantes|estandar|media|grando|grandos|amplio|amplios|espacioso|espaciosos/.test(word));

  if (specs.length > 0) {
    const refinados = resultados.filter(p => {
      const t = normalizarTextoGlobal((p.nombre || p.titulo || "") + " " + (p.sku || "") + " " + (p.key || ""));
      return specs.some(s => t.includes(s));
    });
    if (refinados.length > 0) resultados = refinados;
  }

  let offset = parseInt(getCustomFieldValue(contact, fOffset)) || 0;
  if (mNorm.includes("otro") || mNorm.includes("variedad") || mNorm.includes("mas")) {
    offset += 4;
    if (offset >= resultados.length) offset = 0;
  } else {
    offset = 0;
  }
  await setCustomFieldValue(contact, fOffset, offset.toString(), env, trace);

  let preMsg = "";
  if (resultados.length === 0 && tamano) {
    preMsg = "Por el momento no tengo opciones de " + cat.toUpperCase() + " con esas características, pero aquí tiene lo que tenemos disponible:\n\n";
    resultados = combos;
    offset = 0;
  }

  let finalResultados = resultados.slice(offset, offset + 4);

  if (tamano && finalResultados.length < 4) {
    const altTamano = tamano === "mediano" ? "grande" : "mediano";
    let altResultados = [];
    if (altTamano === "mediano") {
      if (cat === "cama") altResultados = combos.filter(p => {
        const n = normalizarTextoGlobal(p.nombre || p.titulo);
        return n.includes("matri") || n.includes("queen");
      });
      else if (cat === "ropero" || cat === "cocina") altResultados = combos.filter(p => (parseFloat(p.precio) || 0) <= 3499);
      else altResultados = combos.filter(p => (parseFloat(p.precio) || 0) <= 5000);
    } else {
      if (cat === "cama") altResultados = combos.filter(p => normalizarTextoGlobal(p.nombre || p.titulo).includes("king"));
      else if (cat === "ropero" || cat === "cocina") altResultados = combos.filter(p => (parseFloat(p.precio) || 0) >= 3500);
      else altResultados = combos.filter(p => (parseFloat(p.precio) || 0) > 5000);
    }

    for (let p of altResultados) {
      if (finalResultados.length >= 4) break;
      if (!finalResultados.find(r => r.key === p.key)) {
        finalResultados.push(p);
      }
    }
  }

  if (finalResultados.length === 0) {
    return {
      text: "No encontré opciones de " + cat.toUpperCase() + " en este momento. Un asesor le ayudará pronto. 😉",
      handover: true
    };
  }

  const paraGuardar = finalResultados.map(p => ({
    key: p.key,
    nombre: p.nombre || p.titulo,
    precio: p.precio
  }));
  await setCustomFieldValue(contact, getFieldId(env, "carrito_json"), JSON.stringify(paraGuardar), env, trace);
  await setCustomFieldValue(contact, getFieldId(env, "carrito"), paraGuardar.map(p => p.nombre).join(", "), env, trace);
  await setCustomFieldValue(contact, fFiltroTamano, null, env, trace);

  let resp = preMsg || ("Aquí tiene opciones de *" + cat.toUpperCase() + (tamano ? " " + tamano.toUpperCase() : "") + "S* disponibles:\n\n");
  finalResultados.forEach((p, i) => {
    resp += "📍 *" + (i + 1) + ". " + (p.nombre || p.titulo).toUpperCase() + "*\n";
    resp += "💰 *Precio: Q" + p.precio + "*\n\n";
  });
  resp += "¿Cuál le gustaría conocer a detalle? 😉";
  return {
    text: resp
  };
}

async function processFullFlow(rawMsg, contactId, contact, env, trace, conversationId = null) {
  if (trace) {
    trace.add("--- INICIO ROUTER ---");
    trace.obj("Mensaje Consolidado", rawMsg);
    trace.obj("Contacto GHL", { id: contact.id, tags: contact.tags, assignedTo: contact.assignedTo });
  }

  try {
    const message = limpiarMensaje(rawMsg);
    const norm = normalizarTextoGlobal(message);
    const metaMatch = rawMsg.match(/\b(B[A-Z0-9]{5,})\b/i);

    // Detecciones de Intención
    let pideFotos = /fotos?|imagenes?|verlo|verla|mostrar|enviame|fts/i.test(message);
    const pideCompra = /\b(quiero comprar|lo quiero|la quiero|comprarlo|comprarla|pedido|ordenar|pagar|cuota|visa|deposito|transferencia|efectivo)\b/i.test(norm);
    const pideInformacion = /(medida|dimension|precio|vale|cuesta|costo|material|color|cuota|detalle|fotos|garantia|resiste|pago|visa|cuotas|tarjeta|deposito|transferencia|efectivo|toda la info|todos los datos)/i.test(norm);
    const pideCatalogo = /catalogo|modelos|opciones|variedad|otros|ver mas|muestreme|mostrame|oferta|venden|vende|que mas|muebles|amueblado|amueblados/i.test(norm);
    const pideCobertura = /\b(ubicacion|lugar|donde|entrega|envio|cobertura|mandan|reparten|llegan|estan|direccion|tienda|fisica|puntos)\b/i.test(norm);
    const pideGarantia = /\b(compre|adquiri|garantia|rompio|arruino|dañado|malo|reclamo|fallo)\b/i.test(norm);
    const pideSoloParte = /\b(solo|solamente|separado|aparte|sin el|sin la|solo la|solo el|venden solo|por separado|incluye solo)\b/i.test(norm);
    const esAfirmacionGenerica = /^(ok|vale|esta bien|muy bien|si gracias|de acuerdo|perfecto|entendido|así es|si|sii|por favor|porfavor|claro|envia|mandame|ofertas|oferta|si porfavor|si por favor|si claro)$/i.test(norm.trim());
    const esSoloSaludo = /^(hola|buen|buena|buenas|tarde|dia|dias|noche|noches|\s)+$/i.test(norm.trim());
    const esConsultaTecnicaRara = /\b(colgante|desarmar|desarma|doblar|dobla|empotra|pared|techo|tornillo|instala|clavo|madera tipo)\b/i.test(norm);
    const pideInstalacion = norm.includes("instalacion") || norm.includes("instala");
    const pideVagaMejora = /\b(mas grande|mas pequeña|mas cara|barata|barato|economico)\b/i.test(norm);
    const pideCambioCama = /\b(matri|matrimonial|king|queen)\b/i.test(norm);

    const categorias = ["cama", "ropero", "cocina", "mueble", "amueblado", "comedor", "mesa", "gavetero", "tocador", "trinchante", "platera", "marquesa", "cabecera", "mesita", "librera"];
    const catMencionada = categorias.find(c => norm.includes(c));

    // Mapeo de Campos Custom de GHL
    const fields = {
      estado: getFieldId(env, "estado_actual"),
      menuEnviado: getFieldId(env, "menu_ayuda_enviado"),
      propCat: getFieldId(env, "categoria_propuesta"),
      dept: getFieldId(env, "departamento_actual"),
      munProp: getFieldId(env, "municipio_propuesto"),
      offset: getFieldId(env, "catalogo_offset"),
      prodId: getFieldId(env, "producto_id"),
      ultimaCat: getFieldId(env, "ultima_categoria"),
      catInteres: getFieldId(env, "categoria_interes"),
      comboPadre: getFieldId(env, "GHL_combo_padre_FIELD_ID"),
      comboComp: getFieldId(env, "GHL_combo_componentes_FIELD_ID"),
      carrito: getFieldId(env, "carrito_json")
    };

    const cachedState = await env.PRODUCTS_DB.get("state:" + contactId, { type: "json" });
    const state = {
      currentEstado: cachedState?.currentEstado || getCustomFieldValue(contact, fields.estado) || "nuevo",
      propCat: cachedState?.propCat || getCustomFieldValue(contact, fields.propCat),
      yaEnvioMenu: cachedState?.yaEnvioMenu || getCustomFieldValue(contact, fields.menuEnviado) === "true",
      munProp: cachedState?.munProp || getCustomFieldValue(contact, fields.munProp),
      prevProductoId: cachedState?.prevProductoId || getCustomFieldValue(contact, fields.prodId),
      deptActual: cachedState?.deptActual || getCustomFieldValue(contact, fields.dept),
      carrito: cachedState?.carrito || JSON.parse(getCustomFieldValue(contact, fields.carrito) || "[]")
    };

    // Búsqueda de P&R Predefinida (Fuzzy AI)
    const pyrInfo = await obtenerRespuestaPyR(message, env, trace);

    let targetProduct = null;
    if (state.prevProductoId) targetProduct = await obtenerProductoSeguro(state.prevProductoId, env, trace);

    if (trace) {
      trace.obj("Estado Router", {
        estado: state.currentEstado,
        productoId: state.prevProductoId,
        productoIdentificado: targetProduct?.titulo,
        catMencionada,
        pideInformacion,
        pideFotos,
        esSoloSaludo,
        pyrEncontrada: !!pyrInfo
      });
    }

    let esSeleccionReciente = false;
    let responseText = "";
    let responseImgs = [];
    let estadoPropuesto = state.currentEstado === "nuevo" ? "interaccion" : state.currentEstado;

    if ((esConsultaTecnicaRara || pideInstalacion) && !pyrInfo) {
      let resp = "Excelente pregunta. Para brindarle una respuesta técnica exacta sobre la instalación y materiales específicos, le transferiré con un asesor especializado. Un momento por favor... 👨‍💼";

      const catCocina = ["cocina", "cocinas"].some(c => norm.includes(c)) || (targetProduct && normalizarTextoGlobal(targetProduct?.titulo || "").includes("cocina"));
      if (pideInstalacion && catCocina) {
        resp = "Sí, contamos con instalación con un costo adicional en algunos departamentos. ¿De qué departamento o municipio nos saluda? 😉";
        await setCustomFieldValue(contact, fields.estado, "esperando_departamento", env, trace, state, "currentEstado");
      }

      await sendMessageToGHL(contactId, resp, env, trace, [], (env.GHL_LOCATION_ID || contact.locationId), conversationId);
      await triggerHandover(contactId, env, trace);
      return;
    }

    if (pideVagaMejora && state.prevProductoId) {
      await sendMessageToGHL(contactId, "¿Me puedes especificar qué nuevo producto estás buscando? Le transferiré con un asesor para que le dé seguimiento personalizado. 😉", env, trace, [], (env.GHL_LOCATION_ID || contact.locationId), conversationId);
      await triggerHandover(contactId, env, trace);
      return;
    }

    const depmunRaw = await env.COVERAGE_DB.get("listado:depmun");
    const depmun = JSON.parse(depmunRaw || "{}");

    if (state.currentEstado === "esperando_departamento") {
      const foundDept = Object.keys(depmun).find(d => norm.includes(normalizarTextoGlobal(d)));
      if (foundDept) {
        await setCustomFieldValue(contact, fields.dept, foundDept, env, trace, state, "deptActual");
        const municipios = depmun[foundDept] || [];
        const munPendiente = state.munProp ? normalizarTextoGlobal(state.munProp) : "";
        let munReal = null;
        if (munPendiente.length > 3) {
          munReal = municipios.find(m => {
            const nm = normalizarTextoGlobal(m);
            return munPendiente.includes(nm) || nm.includes(munPendiente);
          });
          if (!munReal) {
            const partes = munPendiente.split(" ").filter(p => p.length > 3);
            for (let p of partes) {
              munReal = municipios.find(m => normalizarTextoGlobal(m).includes(p));
              if (munReal) break;
            }
          }
          if (!munReal) {
            munReal = await fuzzyMatchMunicipio(munPendiente, municipios, env, trace);
            if (munReal === "NULL") munReal = null;
          }
        }
        if (munReal) {
          const resp = await obtenerRespuestaCoverage(munReal, env, trace);
          if (resp) {
            await setCustomFieldValue(contact, fields.munProp, null, env, trace, state, "munProp");
            await setCustomFieldValue(contact, fields.estado, "producto", env, trace, state, "currentEstado");
            await sendMessageToGHL(contactId, resp, env, trace, [], (env.GHL_LOCATION_ID || contact.locationId), conversationId);
            return;
          }
        }
        await setCustomFieldValue(contact, fields.estado, "esperando_municipio", env, trace, state, "currentEstado");
        await sendMessageToGHL(contactId, "¿En qué municipio de " + foundDept.toUpperCase() + " está?", env, trace, [], null, conversationId);
        return;
      }
      await sendMessageToGHL(contactId, "¿En qué departamento de Guatemala se encuentra? 🇬🇹", env, trace, [], null, conversationId);
      return;
    }

    if (state.currentEstado === "esperando_municipio") {
      const dept = state.deptActual;
      const municipios = depmun[dept] || [];
      let mun = municipios.find(m => norm.includes(normalizarTextoGlobal(m)));
      if (!mun) {
        mun = await fuzzyMatchMunicipio(message, municipios, env, trace);
        if (mun === "NULL") mun = null;
      }
      if (mun) {
        const resp = await obtenerRespuestaCoverage(mun, env, trace);
        if (resp) {
          await sendMessageToGHL(contactId, resp, env, trace, [], null, conversationId);
          await setCustomFieldValue(contact, fields.estado, "producto", env, trace, state, "currentEstado");
          return;
        }
      }
      await sendMessageToGHL(contactId, "Un asesor le confirmará cobertura pronto. 😉", env, trace, [], null, conversationId);
      await triggerHandover(contactId, env, trace);
      return;
    }
    if (pideCobertura) {
      const resp = await obtenerRespuestaCoverage(message, env, trace);
      if (resp) {
        await sendMessageToGHL(contactId, resp, env, trace, [], null, conversationId);
        return;
      }
      const stopWords = ["ubicacion", "lugar", "donde", "entrega", "envio", "cobertura", "mandan", "reparten", "llegan", "estan", "direccion", "entregan", "hola", "buen", "dia", "tarde", "noche", "tienda", "fisica", "cuenta", "con"];
      const potentialMun = norm.split(/\s+/).filter(w => w.length > 3 && !stopWords.includes(w)).join(" ");
      if (potentialMun) await setCustomFieldValue(contact, fields.munProp, potentialMun, env, trace, state, "munProp");
      await setCustomFieldValue(contact, fields.estado, "esperando_departamento", env, trace, state, "currentEstado");
      await sendMessageToGHL(contactId, "¡Claro! Ofrecemos envío a domicilio en toda Guatemala. Para brindarle el costo exacto y confirmar cobertura, ¿en qué departamento o municipio se encuentra? 😉", env, trace, [], null, conversationId);
      return;
    }

    if (state.currentEstado !== "esperando_departamento" && state.currentEstado !== "esperando_municipio" && !pideInformacion && !pideCatalogo) {
      const esUbicacion = await analizarSiEsUbicacion(message, env, trace);
      const depEnMsg = Object.keys(depmun).find(d => norm.includes(normalizarTextoGlobal(d)));

      if (depEnMsg || esUbicacion) {
        const resp = await obtenerRespuestaCoverage(message, env, trace);
        if (resp) {
          await sendMessageToGHL(contactId, resp, env, trace, [], null, conversationId);
          return;
        }

        if (depEnMsg) {
          await setCustomFieldValue(contact, fields.dept, depEnMsg, env, trace, state, "deptActual");
          await setCustomFieldValue(contact, fields.estado, "esperando_municipio", env, trace, state, "currentEstado");
          await sendMessageToGHL(contactId, "Excelente, realizamos entregas en " + depEnMsg.toUpperCase() + ". ¿En qué municipio se encuentra? 😉", env, trace, [], null, conversationId);
          return;
        } else {
          await setCustomFieldValue(contact, fields.munProp, message, env, trace, state, "munProp");
          await setCustomFieldValue(contact, fields.estado, "esperando_departamento", env, trace, state, "currentEstado");
          await sendMessageToGHL(contactId, "Excelente, para confirmarle la cobertura en " + message.toUpperCase() + ", ¿me podría indicar a qué departamento pertenece? 😉", env, trace, [], null, conversationId);
          return;
        }
      }
    }

    if (targetProduct && targetProduct.tipo === "combo" && pideCambioCama && state.currentEstado !== "confirmacion_categoria") {
      const catCama = ["matri", "matrimonial", "king", "queen"].find(sz => norm.includes(sz));
      if (catCama) {
        const altCombo = await buscarComboAlternativoPorTamano(targetProduct, catCama, env, trace);
        if (altCombo) {
          targetProduct = altCombo;
          esSeleccionReciente = true;
        }
      }
    }
    if (metaMatch) {
      const metaProd = await obtenerProductoSeguro(metaMatch[1], env, trace);
      if (metaProd) {
        targetProduct = metaProd;
        await setCustomFieldValue(contact, getFieldId(env, "Anuncio"), metaMatch[1], env, trace);
      }
    }
    if (!targetProduct) targetProduct = await buscarProductoPorCodigoEnMensaje(rawMsg, env, trace);
    if (!targetProduct) {
      let selIdx = detectarSeleccionNatural(message, state.carrito);
      if (selIdx !== null && state.carrito[selIdx]) {
        const selProd = await obtenerProductoSeguro(state.carrito[selIdx].key.split(":").pop(), env, trace);
        if (selProd) { targetProduct = selProd; esSeleccionReciente = true; }
      }
    }
    if (!targetProduct && !pideCatalogo && !pideInformacion && !catMencionada) targetProduct = await buscarProductoPorNombreEnMensaje(message, env, trace);

    if (targetProduct) {
      await setCustomFieldValue(contact, fields.prodId, targetProduct.id, env, trace, state, "prevProductoId");
      if (esSeleccionReciente || metaMatch) {
        await setCustomFieldValue(contact, fields.offset, "0", env, trace);
      }
    }
    if (pideGarantia) {
      await triggerHandover(contactId, env, trace);
      return;
    }

    if (state.currentEstado === "confirmacion_categoria") {
      const confirmaCambio = esAfirmacionGenerica || norm.startsWith("si") || (state.propCat && norm.includes(state.propCat));
      if (confirmaCambio) {
        await setCustomFieldValue(contact, fields.propCat, null, env, trace, state, "propCat");
        const resCat = await moduloCatalogo(message, contact, env, trace, state.propCat);
        if (resCat.text) await sendMessageToGHL(contactId, resCat.text, env, trace, [], (env.GHL_LOCATION_ID || contact.locationId), conversationId);
        await setCustomFieldValue(contact, fields.estado, "catalogo", env, trace, state, "currentEstado");
        return;
      }
    }
    if (targetProduct && catMencionada && !pideInformacion && !pideFotos && !pideCatalogo) {
      const tituloNormal = normalizarTextoGlobal(targetProduct.titulo || targetProduct.nombre || "");
      if (!tituloNormal.includes(catMencionada)) {
        await setCustomFieldValue(contact, fields.propCat, catMencionada, env, trace, state, "propCat");
        responseText = await callVendedorElitePro(message, contact, env, targetProduct, false, null, esSoloSaludo, state.currentEstado === "nuevo", state.yaEnvioMenu, false, catMencionada, false, trace, pyrInfo);
        await setCustomFieldValue(contact, fields.estado, "confirmacion_categoria", env, trace, state, "currentEstado");
        await sendMessageToGHL(contactId, responseText, env, trace, [], (env.GHL_LOCATION_ID || contact.locationId), conversationId);
        return;
      }
    }

    const pideMasOpciones = /variedad|otros?|otras?|mas opciones|catalogo|muestreme mas/i.test(norm);

    if (targetProduct && !pideCatalogo && !pideCobertura && !pideMasOpciones) {
      if (state.currentEstado === "producto" && esAfirmacionGenerica) pideFotos = true;

      if (pideSoloParte && targetProduct.tipo === "combo" && Array.isArray(targetProduct.items)) {
        const itemKeywords = ["ropero", "cocina", "cama", "cabecera", "mesita", "gavetero", "tocador", "marquesa", "trinchante", "platera", "mueble", "colchon"];
        const pieceFound = targetProduct.items.find(item => {
          const title = normalizarTextoGlobal(item.titulo || item.nombre || "");
          return itemKeywords.some(k => norm.includes(k) && title.includes(k));
        });
        if (pieceFound) {
          const dbPiece = await obtenerProductoSeguro(pieceFound.id || pieceFound.sku, env, trace);
          const finalPrice = dbPiece ? dbPiece.precio : (parseFloat(pieceFound.precio) + 200);
          const priceStr = finalPrice > 0 ? ("💰 *Precio: Q" + finalPrice + "*") : "";
          const specs = "📏 Medidas: " + (pieceFound.medidas || "N/A") + "\n🛠 Material: " + (pieceFound.estructura || "N/A") + "\n🎨 Colores: " + (pieceFound.colores || "N/A");
          const responseImgs = [pieceFound.imagen1, pieceFound.imagen2, pieceFound.imagen, pieceFound.url, pieceFound.link_publico].filter(img => typeof img === "string" && img.length > 10 && img.startsWith("http"));
          const sheet = "Con gusto, aquí tiene el detalle de la pieza individual:\n\n" +
            "*" + (pieceFound.titulo || pieceFound.nombre).toUpperCase() + "*\n" +
            priceStr + "\n" +
            specs + "\n\nLe transferiré con un asesor para que pueda ayudarle con la compra por separado. 😉";
          await sendMessageToGHL(contactId, sheet, env, trace, responseImgs, (env.GHL_LOCATION_ID || contact.locationId), conversationId);
          await triggerHandover(contactId, env, trace);
          return;
        }
      }

      const catProd = categorias.find(c => normalizarTextoGlobal(targetProduct.titulo || targetProduct.nombre || "").includes(c)) || getCustomFieldValue(contact, fields.ultimaCat);
      if (catProd) {
        await setCustomFieldValue(contact, fields.ultimaCat, catProd, env, trace);
        await setCustomFieldValue(contact, fields.catInteres, catProd, env, trace);
      }
      if ((pideFotos || pideCompra || esAfirmacionGenerica) && (!targetProduct.imagenes || targetProduct.imagenes.length === 0)) {
        if (catProd === "ropero") await addToWorkflow(contactId, "9b36093c-f008-4261-b2ba-bc54a0cdd9c9", env, trace);
        else if (catProd === "cocina") await addToWorkflow(contactId, "a2fca18f-d0c7-4c97-8185-7926540bf2de", env, trace);
      }
      if (esSeleccionReciente || pideFotos) {
        if (targetProduct.tipo === "combo" && Array.isArray(targetProduct.items) && targetProduct.items.length >= 3) responseImgs = [...new Set(targetProduct.items.map(i => i.imagen1 || i.imagen2 || i.imagen || i.url).filter(u => typeof u === "string" && u.length > 10 && u.startsWith("http")))];
        else responseImgs = targetProduct.imagenes || [];
      }
      const esNuevoProducto = targetProduct.id !== state.prevProductoId && !pideInformacion;
      responseText = await callVendedorElitePro(message, contact, env, targetProduct, pideCompra, await obtenerRespuestaCoverage(rawMsg, env, trace), esSoloSaludo, state.currentEstado === "nuevo", state.yaEnvioMenu, esNuevoProducto, null, (pideFotos || norm.includes("toda")), trace, pyrInfo);

      if (responseText && responseText.includes("[TRANSFERIR]")) {
        const cleanedResp = responseText.replace("[TRANSFERIR]", "").trim() || "Le pondré en contacto con un asesor para resolver sus dudas técnicas. 😉";
        await sendMessageToGHL(contactId, cleanedResp, env, trace, [], (env.GHL_LOCATION_ID || contact.locationId), conversationId);
        await triggerHandover(contactId, env, trace);
        return;
      }

      if ((esNuevoProducto || !state.yaEnvioMenu) && /Medidas|Colores|Materiales|Precios|Envío|Cuotas/i.test(responseText)) await setCustomFieldValue(contact, fields.menuEnviado, "true", env, trace);
      await setCustomFieldValue(contact, getFieldId(env, "total_pedido"), targetProduct.precio || 0, env, trace);
      if (targetProduct.tipo === "combo") {
        await setCustomFieldValue(contact, fields.comboPadre, targetProduct.id, env, trace);
        if (Array.isArray(targetProduct.items)) await setCustomFieldValue(contact, fields.comboComp, JSON.stringify(targetProduct.items.map(i => i.id)), env, trace);
      }
      estadoPropuesto = pideCompra ? "cierre" : "producto";
      await setCustomFieldValue(contact, fields.estado, estadoPropuesto, env, trace, state, "currentEstado");
      let final = responseText;
      const currentTitle = (targetProduct?.titulo || targetProduct?.nombre || "");
      if (esNuevoProducto && currentTitle && !responseText.toUpperCase().includes(currentTitle.toUpperCase())) {
        final = "*" + currentTitle.toUpperCase() + "*\n\n" + responseText;
      }

      final = final.replace(/\*\*(.*?)\*\*/g, "*$1*");

      await sendMessageToGHL(contactId, final, env, trace, responseImgs, (env.GHL_LOCATION_ID || contact.locationId), conversationId);
      if (pideCompra && !pideInformacion) await triggerHandover(contactId, env, trace);
      return;
    } else if (pideCatalogo || catMencionada || pideMasOpciones || /\b(mediano|mediana|medianos|medianas|grande|grandes|pequeño|pequeña|pequeños|pequeñas|chico|chica|chicos|chicas|enorme|enormes|gigante|gigantes|estandar|media|grando|grandos)\b/i.test(norm) || (state.currentEstado === "catalogo" && norm.length > 3)) {
      let resCat = await moduloCatalogo(message, contact, env, trace);
      if (resCat.retryWithoutKeywords) resCat = await moduloCatalogo("ver mas", contact, env, trace);
      if (resCat.text) await sendMessageToGHL(contactId, resCat.text, env, trace, [], (env.GHL_LOCATION_ID || contact.locationId), conversationId);
      if (resCat.handover) await triggerHandover(contactId, env, trace);
      await setCustomFieldValue(contact, fields.estado, "catalogo", env, trace);
      return;
    } else {
      responseText = await callVendedorElitePro(message, contact, env, targetProduct, pideCompra, await obtenerRespuestaCoverage(rawMsg, env, trace), esSoloSaludo, state.currentEstado === "nuevo", state.yaEnvioMenu, false, null, false, trace, pyrInfo);

      responseText = responseText.replace(/\*\*(.*?)\*\*/g, "*$1*");

      if (responseText && responseText.includes("[TRANSFERIR]")) {
        const cleanedResp = responseText.replace("[TRANSFERIR]", "").trim() || "Un asesor le ayudará con su consulta en un momento. 😉";
        await sendMessageToGHL(contactId, cleanedResp, env, trace, [], (env.GHL_LOCATION_ID || contact.locationId), conversationId);
        await triggerHandover(contactId, env, trace);
        return;
      }
      await sendMessageToGHL(contactId, responseText, env, trace, [], (env.GHL_LOCATION_ID || contact.locationId), conversationId);
      return;
    }
  } catch (err) {
    if (contactId) await triggerHandover(contactId, env, trace);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("OK");
    const trace = new TraceLog();
    let contactId;
    try {
      const rawBody = await request.text();
      const body = JSON.parse(rawBody);
      contactId = body.contact_id || body.contact?.id;
      if (!contactId) return new Response("OK");

      const contact = await getContactFromGHL(contactId, env, trace);
      if (!contact || contact.tags?.includes("humano") || contact.assignedTo) {
        trace.add("Contacto no apto para IA (Humano o Asignado).");
        trace.flush();
        return new Response("OK");
      }

      const convId = body.conversation_id || body.message?.conversationId;
      const locationId = body.locationId || body.location?.id || contact.locationId;
      const msgType = body.message?.type;
      const isMediaMessage = (msgType === 19 || msgType === 21 || msgType === "image" || msgType === "audio");
      const currentText = (body.message?.body || body.message?.text || "").trim();
      const currentAttachments = body.message?.attachments || body.attachments || [];

      const bKey = "buffer:" + contactId;
      const lKey = "last:" + contactId;
      const now = Date.now();

      let buffer = await env.PRODUCTS_DB.get(bKey, { type: "json" }) || {
        text: "",
        attachments: [],
        isMedia: false,
        locationId: locationId,
        conversationId: convId
      };

      if (currentText) buffer.text += " " + currentText;
      if (currentAttachments.length > 0) buffer.attachments = [...buffer.attachments, ...currentAttachments];
      if (isMediaMessage) buffer.isMedia = true;
      if (locationId) buffer.locationId = locationId;
      if (convId) buffer.conversationId = convId;

      await env.PRODUCTS_DB.put(bKey, JSON.stringify(buffer), { expirationTtl: 60 });
      await env.PRODUCTS_DB.put(lKey, now.toString(), { expirationTtl: 60 });

      ctx.waitUntil((async () => {
        try {
          await new Promise(r => setTimeout(r, 2500));
          const latestTs = await env.PRODUCTS_DB.get(lKey);
          if (latestTs === now.toString()) {
            const finalBuffer = await env.PRODUCTS_DB.get(bKey, { type: "json" });
            await env.PRODUCTS_DB.delete(bKey);
            await env.PRODUCTS_DB.delete(lKey);

            if (!finalBuffer) return;
            trace.add("--- PROCESANDO BUFFER CONSOLIDADO ---");

            let extractedText = "";
            let attachmentsToProcess = finalBuffer.attachments || [];

            if (finalBuffer.isMedia && attachmentsToProcess.length === 0) {
              attachmentsToProcess = await getLatestMessageAttachments(contactId, finalBuffer.locationId, env, trace);
            }

            if (attachmentsToProcess.length > 0) {
              for (const att of attachmentsToProcess) {
                const text = await handleMediaAttachment(att, env, trace);
                if (text) extractedText += " " + text;
              }
            }

            let fullMsg = (finalBuffer.text + " " + extractedText).trim();
            if (!fullMsg && finalBuffer.isMedia) {
              fullMsg = "[Imagen/Audio Recibido]";
            }

            if (!fullMsg) return;

            await processFullFlow(fullMsg, contactId, contact, env, trace, finalBuffer.conversationId);
          }
        } catch (err) {
          trace.error("Excepción en flujo de fondo (waitUntil): ", err);
        } finally {
          trace.flush();
        }
      })());

      return new Response("OK");
    } catch (e) {
      if (contactId) {
        try {
          await triggerHandover(contactId, env, trace);
        } catch (err) { }
      }
      return new Response("OK");
    }
  }
};
