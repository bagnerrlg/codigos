/**
 * META EXPERT - LANZADOR DE PUBLICIDAD INTEGRADO (CLOUDFLARE WORKER)
 * Versión Unificada: Interfaz Visual + Lógica de Automatización
 *
 * VARIABLES DE ENTORNO REQUERIDAS EN CLOUDFLARE:
 * - META_ACCESS_TOKEN: Token de acceso de Facebook Ads.
 * - OPENAI_API_KEY: Key de OpenAI para generación de copy.
 * - AD_ACCOUNT_ID: ID de la cuenta de anuncios (ej: 123456789).
 * - WHATSAPP_1 a WHATSAPP_5: Números de WhatsApp con código de país (ej: 50212345678).
 */

const API_VERSION = "v19.0";
const FIXED_TEXT = "📲 ¡Escríbenos ahora y recibe tu cotización con promoción especial!\n📦 Entregas a todo el país\n💯 Garantía asegurada";

async function safeJson(response) {
  try {
    const text = await response.text();
    if (!text || !text.trim()) return {};
    return JSON.parse(text);
  } catch (e) {
    console.error("safeJson error:", e.message);
    return { error: { message: "Invalid JSON response" } };
  }
}

// --- HANDLERS DE API (LOGICA DE NEGOCIO) ---

function getAdAccId(env, b, headers) {
  let id = (b?.ad_account_id || b?.config?.ad_account_id || headers?.get("x-meta-ad-account-id") || env.AD_ACCOUNT_ID || "").trim();
  if (!id) return null;
  return id.startsWith("act_") ? id : "act_" + id;
}

function getToken(env, b, headers) {
  return b?.access_token || b?.config?.access_token || headers?.get("x-meta-access-token") || env.META_ACCESS_TOKEN;
}

function validateImageBytes(bytes) {

  if (!bytes || bytes.length < 10) {
    return false;
  }

  const jpeg =
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255;

  const png =
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71;

  const webp =
    bytes[0] === 82 && // R
    bytes[1] === 73 && // I
    bytes[2] === 70 && // F
    bytes[3] === 70 && // F
    bytes[8] === 87 && // W
    bytes[9] === 69 && // E
    bytes[10] === 66 && // B
    bytes[11] === 80; // P

  return jpeg || png || webp;
}

async function handleGetAccounts(body, env, headers) {
  const token = getToken(env, body, headers);
  const r = await fetch(`https://graph.facebook.com/${API_VERSION}/me/accounts?access_token=${token}&limit=100`);
  const d = await safeJson(r);
  return new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
}

async function handleMetaSearch(body, env, headers) {
  const token = getToken(env, body, headers);
  const url = `https://graph.facebook.com/${API_VERSION}/search?type=${body.type}&q=${encodeURIComponent(body.q)}&access_token=${token}&limit=10`;
  const r = await fetch(url);
  const d = await safeJson(r);
  return new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
}

async function handleOpenAIGenerate(body, env, headers) {
  try {
    const userPrompt = body.prompt || "Genera un anuncio para este producto.";
    const kRole = ["r", "o", "l", "e"].join("");
    const kContent = ["c", "o", "n", "t", "e", "n", "t"].join("");
    const aiMessages = [];

    const sysMsg = {};
    sysMsg[kRole] = "system";
    sysMsg[kContent] = "Eres un experto en Copywriting para Facebook Ads. Responde siempre en formato JSON con llaves 'texto' y 'titulo'. No incluyas markdown, solo el JSON puro.";
    aiMessages.push(sysMsg);

    if (body.image) {
      const userMsg = {};
      userMsg[kRole] = "user";
      userMsg[kContent] = [
        { "type": "text", "text": userPrompt },
        { "type": "image_url", "image_url": { "url": body.image } }
      ];
      aiMessages.push(userMsg);
    } else {
      const userMsg = {};
      userMsg[kRole] = "user";
      userMsg[kContent] = userPrompt;
      aiMessages.push(userMsg);
    }

    const kMsgs = ["m", "e", "s", "s", "a", "g", "e", "s"].join("");
    const payload = {
      "model": "gpt-4o-mini",
      "max_tokens": 500
    };
    payload[kMsgs] = aiMessages;

    const openAiKey = body.openai_api_key || env.OPENAI_API_KEY;
    const authHeader = "Bearer " + openAiKey;
    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const openAiData = await safeJson(openAiResponse);
    if (openAiData.error) {
      console.error("OpenAI Error:", JSON.stringify(openAiData.error));
      return new Response(JSON.stringify({ error: openAiData.error.message || "Error de OpenAI" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify(openAiData), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    console.error("handleOpenAIGenerate exception:", e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function handleGetInsights(body, env, headers) {
  const accId = getAdAccId(env, body, headers);
  const token = getToken(env, body, headers);
  const url = `https://graph.facebook.com/${API_VERSION}/${accId}/insights?level=${body.level}&date_preset=${body.range}&fields=spend,clicks,impressions,reach&access_token=${token}`;
  const r = await fetch(url);
  const d = await safeJson(r);
  return new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
}


async function handleGetActiveCampaigns(body, env, headers) {
  const accId = getAdAccId(env, body, headers);
  const token = getToken(env, body, headers);
  if (!accId) return new Response(JSON.stringify({ error: "AD_ACCOUNT_ID no configurada" }), { status: 400 });
  const r = await fetch(`https://graph.facebook.com/${API_VERSION}/${accId}/campaigns?fields=name,status,objective,buying_type&access_token=${token}&limit=100`);
  const d = await safeJson(r);
  return new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
}

async function handleGetAdSets(body, env, headers) {
  const campaignId = body.campaignId;
  const token = getToken(env, body, headers);

  const url =
    `https://graph.facebook.com/${API_VERSION}/${campaignId}/adsets` +
    `?fields=` +
    `id,name,status,` +
    `optimization_goal,billing_event,` +
    `bid_amount,daily_budget,lifetime_budget,` +
    `targeting,promoted_object,` +
    `destination_type,attribution_spec` +
    `&access_token=${token}` +
    `&limit=100`;

  const r = await fetch(url);
  const d = await safeJson(r);

  return new Response(
    JSON.stringify(d),
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

async function handleGetAds(body, env, headers) {
  const adsetId = body.adsetId;
  const token = getToken(env, body, headers);

  const url =
    `https://graph.facebook.com/${API_VERSION}/${adsetId}/ads` +
    `?fields=` +
    `id,name,status,` +
    `creative{id,name,object_story_spec,image_url,thumbnail_url}` +
    `&access_token=${token}` +
    `&limit=100`;

  const r = await fetch(url);
  const d = await r.json();

  return new Response(
    JSON.stringify(d),
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

async function handleGetCustomAudiences(body, env, headers) {
  const accId = getAdAccId(env, body, headers);
  const token = getToken(env, body, headers);
  if (!accId) return new Response(JSON.stringify({ error: "AD_ACCOUNT_ID no configurada" }), { status: 400 });
  const url = `https://graph.facebook.com/${API_VERSION}/${accId}/customaudiences?fields=name,description,approximate_count_lower_bound&access_token=${token}`;
  const r = await fetch(url);
  const d = await safeJson(r);
  return new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
}

async function handleGetInstagramAccounts(body, env, headers) {
  const pageId = body.pageId;
  const token = getToken(env, body, headers);
  const url = `https://graph.facebook.com/${API_VERSION}/${pageId}?fields=instagram_business_account&access_token=${token}`;
  const r = await fetch(url);
  const d = await safeJson(r);
  return new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
}

async function handleGetMessageTemplates(body, env, headers) {
  const pageId = body.pageId;
  const token = getToken(env, body, headers);
  const url = `https://graph.facebook.com/${API_VERSION}/${pageId}/message_templates?access_token=${token}`;
  const r = await fetch(url);
  const d = await safeJson(r);
  return new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
}

async function handleGetWhatsAppNumbers(body, env, headers) {
  const pageId = body.pageId;
  const token = getToken(env, body, headers);
  try {
    const pRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${pageId}?fields=whatsapp_business_account&access_token=${token}`);
    const pData = await safeJson(pRes);
    if (pData.whatsapp_business_account && pData.whatsapp_business_account.id) {
      const wabaId = pData.whatsapp_business_account.id;
      const nRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${wabaId}/phone_numbers?access_token=${token}`);
      const nData = await safeJson(nRes);
      return new Response(JSON.stringify(nData), { headers: { "Content-Type": "application/json" } });
    }
  } catch (e) { }
  return new Response(JSON.stringify({ data: [] }), { headers: { "Content-Type": "application/json" } });
}

async function handleValidateSetup(body, env, headers) {
  const token = getToken(env, body, headers);
  const results = {
    token: { status: 'ok', message: 'Verificando...' },
    account: { status: 'ok', message: 'Verificando...' },
    permissions: []
  };

  try {
    const pRes = await fetch(`https://graph.facebook.com/${API_VERSION}/me/permissions?access_token=${token}`);
    const pData = await safeJson(pRes);
    if (pData.error) {
      results.token = { status: 'error', message: pData.error.message };
    } else {
      results.permissions = pData.data || [];
      const required = ['ads_management', 'ads_read', 'pages_manage_ads'];
      const granted = results.permissions.filter(p => p.status === 'granted').map(p => p.permission);
      const missing = required.filter(req => !granted.includes(req));

      if (missing.length > 0) {
        results.token = { status: 'warning', message: `Faltan permisos clave: ${missing.join(', ')}` };
      } else {
        results.token = { status: 'ok', message: 'Token válido con permisos de administrador.' };
      }
    }

    const finalAccId = getAdAccId(env, body, headers);
    if (finalAccId) {
      const aRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${finalAccId}?fields=account_status,disable_reason,currency&access_token=${token}`);
      const aData = await safeJson(aRes);
      if (aData.error) {
        results.account = { status: 'error', message: aData.error.message };
      } else {
        const statuses = { 1: 'ACTIVA', 2: 'DESHABILITADA', 3: 'EN REVISIÓN', 7: 'PENDIENTE CIERRE', 9: 'RESTRINGIDA', 100: 'PREPAGO_VACÍO', 101: 'DEUDA' };
        results.account = {
          status: aData.account_status === 1 ? 'ok' : 'error',
          message: `Cuenta ${statuses[aData.account_status] || 'ID:' + aData.account_status}. Moneda: ${aData.currency}`
        };
      }
    }
    return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

async function handleCheckPermissions(body, env, headers) {
  return await handleValidateSetup(body, env, headers);
}

async function handleGetTokenInfo(body, env, headers) {
  const token = getToken(env, body, headers);
  const r = await fetch(`https://graph.facebook.com/debug_token?input_token=${token}&access_token=${token}`);
  const d = await safeJson(r);
  console.log("Resultado debug_token:", JSON.stringify(d));
  return new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
}

async function handleUpdateStatus(body, env, headers) {
  const { id, status } = body;
  const token = getToken(env, body, headers);
  const r = await fetch(`https://graph.facebook.com/${API_VERSION}/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, access_token: token })
  });
  const d = await safeJson(r);
  return new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
}

async function handleDebugPost(body, env, headers) {

  const postId = body.postId;
  const token = getToken(env, body, headers);

  const url =
    `https://graph.facebook.com/${API_VERSION}/${postId}` +
    `?fields=` +
    [
      "id",
      "message",
      "full_picture",
      "permalink_url",
      "created_time"
    ].join(",") +
    `&access_token=${token}`;

  const r = await fetch(url);

  const d = await safeJson(r);

  return new Response(
    JSON.stringify(d, null, 2),
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}
function getCTA(channel) {

  const CTA_MAP = {

    messenger: {
      type: "MESSAGE_PAGE"
    },

    message_page: {
      type: "MESSAGE_PAGE"
    },

    whatsapp: {
      type: "WHATSAPP_MESSAGE",
      value: {
        app_destination: "WHATSAPP"
      }
    },

    instagram: {
      type: "INSTAGRAM_MESSAGE",
      value: {
        app_destination: "INSTAGRAM_DIRECT"
      }
    }

  };

  const result = CTA_MAP[channel] || {
    type: "MESSAGE_PAGE"
  };
  console.log(`[Worker] getCTA(${channel}) ->`, JSON.stringify(result));
  return result;
}
async function handleGetFullReport(body, env, headers) {
  try {

    const acc = getAdAccId(env, body, headers);
    const { start, end } = body;
    const token = getToken(env, body, headers);

    const time_range = JSON.stringify({
      since: start,
      until: end
    });

    // ==========================
    // CAMPAIGNS
    // ==========================
    const campUrl =
      `https://graph.facebook.com/${API_VERSION}/${acc}/campaigns` +
      `?fields=id,name,status,insights.time_range(${time_range}){spend,impressions,reach,actions}` +
      `&access_token=${token}` +
      `&limit=100`;

    // ==========================
    // ADSETS
    // ==========================

    const adsetUrl =
      `https://graph.facebook.com/${API_VERSION}/${acc}/adsets` +
      `?fields=` +
      [
        "id",
        "name",
        "status",
        "campaign_id",
        "configured_placements",
        "optimization_goal",
        "billing_event",
        "daily_budget",
        "lifetime_budget",
        "destination_type",
        "targeting",
        "promoted_object",
        "attribution_spec",
        "targeting_automation",
        "configured_status",
        "effective_status",
        "bid_strategy",
        `insights.time_range(${time_range}){spend,impressions,reach,actions}`
      ].join(",") +
      `&access_token=${token}` +
      `&limit=150`;

    // ==========================
    // ADS
    // ==========================

    const adUrl =
      `https://graph.facebook.com/${API_VERSION}/${acc}/ads` +
      `?fields=` +
      [
        "id",
        "name",
        "status",
        "campaign_id",
        "adset_id",

        "creative{" +
        [
          "id",
          "name",
          "image_url",
          "thumbnail_url",
          "object_story_spec",
          "asset_feed_spec",
          "object_type"
        ].join(",") +
        "}",

        `insights.time_range(${time_range}){spend,impressions,reach,actions}`
      ].join(",") +
      `&access_token=${token}` +
      `&limit=300`;

    const [campRes, adsetRes, adRes] = await Promise.all([
      fetch(campUrl),
      fetch(adsetUrl),
      fetch(adUrl)
    ]);

    const campData = await safeJson(campRes);
    const adsetData = await safeJson(adsetRes);
    const adData = await safeJson(adRes);

    if (campData.error) {
      throw new Error(campData.error.message);
    }

    if (adsetData.error) {
      throw new Error(adsetData.error.message);
    }

    if (adData.error) {
      throw new Error(adData.error.message);
    }

    const campaigns = campData.data || [];
    const adsets = adsetData.data || [];
    const ads = adData.data || [];

    const integratedData = campaigns.map(campaign => {

      const campaignInsight =
        campaign.insights?.data?.[0] || {};

      const campaignAdsets = adsets
        .filter(
          adset => adset.campaign_id === campaign.id
        )
        .map(adset => {

          const adsetInsight =
            adset.insights?.data?.[0] || {};

          const adsetAds =
            ads
              .filter(
                ad => ad.adset_id === adset.id
              )
              .map(ad => {

                const insight =
                  ad.insights?.data?.[0] || {};

                const actions =
                  insight.actions || [];

                const conversations =
                  actions.find(
                    a =>
                      a.action_type ===
                      "onsite_conversion.messaging_conversation_started_7d"
                  )?.value || 0;

                const objectStorySpec =
                  ad.creative?.object_story_spec || {};

                const linkData =
                  objectStorySpec.link_data || {};

                const videoData =
                  objectStorySpec.video_data || {};

                const content =
                  Object.keys(linkData).length
                    ? linkData
                    : videoData;

                // SINGLE CTA
                const singleDestination =
                  content?.call_to_action?.value?.app_destination || "";

                const singleCTA =
                  content?.call_to_action?.type || "";

                // MULTI CTA
                const multiCTAs =
                  ad.creative?.asset_feed_spec?.call_to_actions || [];

                const destinations =
                  multiCTAs
                    .map(
                      x => x.value?.app_destination
                    )
                    .filter(Boolean);

                const ctas =
                  multiCTAs
                    .map(
                      x => x.type
                    )
                    .filter(Boolean);

                return {

                  id: ad.id,
                  name: ad.name,
                  status: ad.status,

                  campaign_id:
                    ad.campaign_id,

                  adset_id:
                    ad.adset_id,

                  creative_id:
                    ad.creative?.id || "",

                  creative_name:
                    ad.creative?.name || "",

                  object_type:
                    ad.creative?.object_type || "",

                  page_id:
                    objectStorySpec.page_id || "",

                  destination:
                    destinations.join(","),

                  cta:
                    ctas.join(","),

                  destinations,

                  ctas,

                  titulo:
                    content?.name ||
                    content?.title ||
                    "",

                  texto:
                    content?.message ||
                    "",

                  descripcion:
                    content?.description ||
                    "",

                  link:
                    content?.link ||
                    "",

                  page_welcome_message:
                    content?.page_welcome_message ||
                    "",

                  image:
                    ad.creative?.image_url ||
                    ad.creative?.thumbnail_url ||
                    "",

                  image_hash:
                    content?.image_hash ||
                    "",

                  spend:
                    Number(
                      insight.spend || 0
                    ),

                  impressions:
                    Number(
                      insight.impressions || 0
                    ),

                  reach:
                    Number(
                      insight.reach || 0
                    ),

                  conversations:
                    Number(conversations),

                  actions,

                  metrics:
                    insight

                };

              });

          return {

            id:
              adset.id,

            name:
              adset.name,

            status:
              adset.status,

            campaign_id:
              adset.campaign_id,

            optimization_goal:
              adset.optimization_goal || "",

            billing_event:
              adset.billing_event || "",

            destination_type:
              adset.destination_type || "",

            promoted_object:
              adset.promoted_object || {},

            attribution_spec:
              adset.attribution_spec || [],

            daily_budget:
              Number(
                adset.daily_budget || 0
              ),

            lifetime_budget:
              Number(
                adset.lifetime_budget || 0
              ),

            targeting:
              adset.targeting || {},

            spend:
              Number(
                adsetInsight.spend || 0
              ),

            impressions:
              Number(
                adsetInsight.impressions || 0
              ),

            reach:
              Number(
                adsetInsight.reach || 0
              ),

            metrics:
              adsetInsight,

            ads:
              adsetAds

          };

        });

      return {

        id: campaign.id,
        name: campaign.name,
        status: campaign.status,

        spend:
          Number(campaignInsight.spend || 0),

        impressions:
          Number(campaignInsight.impressions || 0),

        reach:
          Number(campaignInsight.reach || 0),

        metrics:
          campaignInsight,

        adsets:
          campaignAdsets
      };

    });

    return new Response(
      JSON.stringify({
        success: true,
        data: integratedData
      }),
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  } catch (error) {

    console.error(
      "FULL REPORT ERROR:",
      error.message
    );

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
}
async function handleDebugAdSet(body, env, headers) {

  const adsetId = body.adsetId;
  const token = getToken(env, body, headers);

  const url =
    `https://graph.facebook.com/${API_VERSION}/${adsetId}` +
    `?fields=` +
    [
      "id",
      "name",

      "targeting",

      "promoted_object",

      "destination_type",

      "attribution_spec",

      "optimization_goal",

      "billing_event",

      "effective_status"
    ].join(",") +
    `&access_token=${token}`;

  const r = await fetch(url);

  const d = await safeJson(r);

  return new Response(
    JSON.stringify(d),
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}
async function handleResolveRegions(body, env, headers) {
  const depts = body.depts || [];
  const token = getToken(env, body, headers);
  const promises = depts.map(async (dept) => {
    try {
      const r = await fetch(`https://graph.facebook.com/${API_VERSION}/search?type=adgeolocation&q=${encodeURIComponent(dept)}&location_types=['region']&access_token=${token}`);
      const d = await safeJson(r);
      if (d.data && d.data.length > 0) {
        const match =
          d.data.find(it =>
            it.country_code === 'GT' &&
            (
              it.type === 'region' ||
              it.region_type
            )
          ) || null;
        if (match) {
          console.log(`Región resuelta: ${dept} -> ${match.key}`);
          return { key: match.key };
        }
      }
    } catch (e) {
      console.error(`Error resolviendo región ${dept}:`, e);
    }
    return null;
  });
  const results = await Promise.all(promises);
  return new Response(JSON.stringify({ regions: results.filter(r => r !== null) }), { headers: { "Content-Type": "application/json" } });
}

async function handleUploadMedia(bodyJson, env, headers) {
  const { fileName, fileType, base64 } = bodyJson;
  const isImg = (fileType || "").startsWith("image/");
  const token = getToken(env, bodyJson, headers);
  const acc = getAdAccId(env, bodyJson, headers);

  try {
    console.log("Cuenta:", acc);
    console.log("Nombre:", fileName);
    console.log("Tipo:", fileType);

    if (!token) {
      throw new Error("META_ACCESS_TOKEN no configurado");
    }

    if (!acc) {
      throw new Error("AD_ACCOUNT_ID no configurado");
    }

    if (!base64) {
      throw new Error("Base64 vacío");
    }

    // Limpiar DataURL
    let cleanBase64 = base64;

    if (cleanBase64.includes("base64,")) {
      cleanBase64 = cleanBase64.split("base64,")[1];
    }

    console.log("Base64 Length:", cleanBase64.length);
    console.log(
      "Base64 Inicio:",
      cleanBase64.substring(0, 60)
    );

    // Decodificar
    const binary = atob(cleanBase64);

    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    console.log("Bytes decodificados:", bytes.length);

    // Logs de diagnóstico
    console.log(
      "Firma:",
      bytes[0],
      bytes[1],
      bytes[2],
      bytes[3],
      bytes[4],
      bytes[5],
      bytes[6],
      bytes[7]
    );

    console.log(
      "HEX:",
      Array.from(bytes.slice(0, 20))
        .map(b => b.toString(16).padStart(2, "0"))
        .join(" ")
    );

    // Validar imagen
    if (!validateImageBytes(bytes)) {
      throw new Error(
        "La imagen recibida no es JPEG ni PNG válida"
      );
    }

    const blob = new Blob(
      [bytes],
      {
        type: fileType || "image/jpeg"
      }
    );

    const form = new FormData();

    form.append("access_token", token);

    // Meta suele aceptar mejor filename separado
    form.append("filename", fileName);

    form.append("source", blob, fileName);
    const endpoint =
      `https://graph.facebook.com/${API_VERSION}/${acc}/${isImg ? 'adimages' : 'advideos'}`;

    console.log("Endpoint:", endpoint);
    console.log("Enviando a Meta...");

    const response = await fetch(
      endpoint,
      {
        method: "POST",
        body: form
      }
    );

    const responseText =
      await response.text();

    console.log(
      "Status Meta:",
      response.status
    );

    console.log(
      "Respuesta Meta:",
      responseText
    );

    let data = {};

    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(
        "Meta devolvió una respuesta no JSON"
      );
    }

    if (data.error) {

      console.error(
        "ERROR META:",
        JSON.stringify(
          data.error,
          null,
          2
        )
      );

      throw new Error(
        data.error.message || "Error Meta"
      );
    }

    if (isImg) {
      if (!data.images) {
        throw new Error("Meta no devolvió el objeto images");
      }
      const imageInfo = Object.values(data.images)[0];
      const hash = imageInfo?.hash;
      if (!hash) throw new Error("Meta no devolvió hash");
      return new Response(
        JSON.stringify({
          success: true,
          image_hash: hash,
          id: hash,
          type: "img"
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    } else {
      if (!data.id) {
        throw new Error("Meta no devolvió ID de video");
      }
      console.log("Video subido correctamente. ID:", data.id);
      return new Response(
        JSON.stringify({
          success: true,
          video_id: data.id,
          id: data.id,
          type: "vid"
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

  } catch (e) {

    console.error(
      "ERROR FATAL handleUploadMedia:",
      e.stack || e.message
    );

    return new Response(
      JSON.stringify({
        success: false,
        error: e.message
      }),
      {
        status: 500,
        headers: {
          "Content-Type":
            "application/json"
        }
      }
    );
  }
}

function normalizeObjective(objective) {

  const map = {

    // antiguos
    MESSAGES: "OUTCOME_ENGAGEMENT",
    MESSAGE: "OUTCOME_ENGAGEMENT",

    CONVERSIONS: "OUTCOME_SALES",
    SALES: "OUTCOME_SALES",

    TRAFFIC: "OUTCOME_TRAFFIC",

    LEADS: "OUTCOME_LEADS",

    AWARENESS: "OUTCOME_AWARENESS",

    APP_INSTALLS: "OUTCOME_APP_PROMOTION",

    // nuevos
    OUTCOME_ENGAGEMENT: "OUTCOME_ENGAGEMENT",
    OUTCOME_SALES: "OUTCOME_SALES",
    OUTCOME_TRAFFIC: "OUTCOME_TRAFFIC",
    OUTCOME_LEADS: "OUTCOME_LEADS",
    OUTCOME_AWARENESS: "OUTCOME_AWARENESS",
    OUTCOME_APP_PROMOTION: "OUTCOME_APP_PROMOTION"
  };

  return map[objective] || objective;
}

async function handleCreateAdvancedAd(body, env, headers) {
  const config = body.config;
  const token = getToken(env, body, headers);
  const acc = getAdAccId(env, body, headers);

  console.log(`[Worker] Iniciando publicación en cuenta: ${acc}`);
  console.log(`[Worker] Config recibida:`, JSON.stringify(config, null, 2));

  // Audit permissions again in logs
  try {
    const pRes = await fetch(`https://graph.facebook.com/${API_VERSION}/me/permissions?access_token=${token}`);
    const pData = await safeJson(pRes);
    console.log(`[Worker] Permisos detectados: ${JSON.stringify(pData.data)}`);
  } catch (e) { console.error("[Worker] Error verificando permisos internos:", e.message); }

  try {
    let mediaId = config.mediaId;
    let mediaType = config.mediaType;

    let campaignId = config.campaignId;

    if (campaignId === "NEW") {

      console.log(`[Worker] Creando campaña: ${config.campaignName}`);

      const campaignBody = {
        name: config.campaignName,

        objective: normalizeObjective(config.objective),

        status: config.status || "PAUSED",

        special_ad_categories: ["NONE"],

        // NUEVOS CAMPOS OBLIGATORIOS
        is_campaign_budget_optimization_enabled: false,
        is_adset_budget_sharing_enabled: false
      };
      const cr = await fetch(
        `https://graph.facebook.com/${API_VERSION}/${acc}/campaigns`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            ...campaignBody,
            access_token: token
          })
        }
      );
      const responseText = await cr.text();

      let cd = {};

      try {
        cd = JSON.parse(responseText);
      } catch (e) {
        throw new Error(
          "Meta devolvió respuesta inválida al crear campaña: " +
          responseText
        );
      }

      if (!cr.ok || cd.error) {

        console.error(
          "[META CAMPAIGN ERROR]",
          JSON.stringify(cd, null, 2)
        );

        throw new Error(
          "Error creando campaña: " +
          JSON.stringify(cd, null, 2)
        );
      }

      if (!cd.id) {

        console.error(
          "[META CAMPAIGN ERROR SIN ID]",
          JSON.stringify(cd, null, 2)
        );

        throw new Error(
          "Meta no devolvió ID de campaña"
        );
      }

      campaignId = cd.id;

      console.log(
        `[Worker] Campaña creada correctamente: ${campaignId}`
      );
      const pageInfo = await fetch(
        `https://graph.facebook.com/${API_VERSION}/${config.pageId}?metadata=1&access_token=${token}`
      ).then(r => safeJson(r));

      console.log(
        "[PAGE METADATA]",
        JSON.stringify(pageInfo, null, 2)
      );
    }
    let destinations = [];
    let adSetId = config.adSetId;
    let isMultiDestination = false;
    let destinationType = null;
    if (config.messagingDestinations?.messenger)
      destinations.push("MESSENGER");

    if (config.messagingDestinations?.instagram)
      destinations.push("INSTAGRAM_DIRECT");

    if (config.messagingDestinations?.whatsapp)
      destinations.push("WHATSAPP");

    console.log(`[Worker] Destinations detectados:`, destinations);

    // Prioridad y mapeo de destination_type
    if (destinations.length === 0) {
      destinationType = "MESSENGER";
    } else if (destinations.length === 1) {
      if (destinations[0] === "INSTAGRAM_DIRECT") {
        destinationType = "MESSAGING_INSTAGRAM_DIRECT";
      } else if (destinations[0] === "WHATSAPP") {
        destinationType = "WHATSAPP";
      } else {
        destinationType = "MESSENGER";
      }
    }
    else if (destinations.length === 3) {

      destinationType =
        "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP";

    }
    else if (
      destinations.includes("INSTAGRAM_DIRECT") &&
      destinations.includes("MESSENGER")
    ) {

      destinationType =
        "MESSAGING_INSTAGRAM_DIRECT_MESSENGER";

    }
    else if (
      destinations.includes("INSTAGRAM_DIRECT") &&
      destinations.includes("WHATSAPP")
    ) {

      destinationType =
        "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP";

    }
    else if (
      destinations.includes("MESSENGER") &&
      destinations.includes("WHATSAPP")
    ) {

      destinationType =
        "MESSAGING_MESSENGER_WHATSAPP";

    }

    console.log(`[Worker] destinationType final: ${destinationType}`);

    if (adSetId === "NEW") {

      let promoted_object = {};

    const WA_MAP = body.whatsapp_numbers || {
        WHATSAPP_1: env.WHATSAPP_1,
        WHATSAPP_2: env.WHATSAPP_2,
        WHATSAPP_3: env.WHATSAPP_3,
        WHATSAPP_4: env.WHATSAPP_4,
        WHATSAPP_5: env.WHATSAPP_5
      };

      let whatsappNumber =
        WA_MAP[config.whatsappNumber] || config.whatsappNumber || null;

      console.log(
        "[WHATSAPP MAP]",
        JSON.stringify({
          selected: config.whatsappNumber,
          resolved: whatsappNumber
        }, null, 2)
      );

      if (
        destinations.includes("WHATSAPP") &&
        whatsappNumber
      ) {
        // Asegurar que sea solo números
        const cleanNumber = String(whatsappNumber).replace(/\D/g, "");
        if (cleanNumber) {
          promoted_object.whatsapp_phone_number = cleanNumber;
        }
      }

      // custom_event_type ANTES de validar vacío
      const obj = normalizeObjective(config.objective);

      if (
        ![
          "CONVERSATIONS",
          "OUTCOME_ENGAGEMENT"
        ].includes(obj) &&
        config.customEventType
      ) {
        promoted_object.custom_event_type =
          config.customEventType;
      }
      // SOLO al final validar vacío
      if (Object.keys(promoted_object).length === 0) {
        promoted_object = undefined; // mejor que null para Meta Ads
      }


      const geo_locations = {
        countries: ["GT"]
      };

      if (
        config.resolvedRegions?.length
      ) {

        geo_locations.regions =
          config.resolvedRegions;

        delete geo_locations.countries;

      }


      isMultiDestination =
        destinations.length > 1;
      console.log(
        "[FINAL PROMOTED OBJECT]",
        JSON.stringify(promoted_object, null, 2)
      );
      const asb = {
        name: config.adSetName,

        campaign_id: campaignId,

        optimization_goal: "CONVERSATIONS",

        billing_event: "IMPRESSIONS",

        bid_strategy: "LOWEST_COST_WITHOUT_CAP",

        daily_budget: Math.max(
          100,
          Math.round(
            Number(config.budgetAmount || 1) * 100
          )
        ),

        destination_type: destinationType,

        promoted_object,

        targeting: {
          geo_locations,
          age_min:
            parseInt(
              config.manualAudience?.ageMin
            ) || 18,

          publisher_platforms:
            Object.keys(
              config.platforms || { facebook: true }
            ).filter(k => config.platforms[k]),

          device_platforms: [
            "mobile",
            "desktop"
          ]
        },

        status:
          config.status || "PAUSED",

        access_token: token
      };
      console.log(
        "[ADSET DESTINATION]",
        JSON.stringify({
          destinations,
          destinationType,
          promoted_object
        }, null, 2)
      );
      console.log(
        "[PROMOTED OBJECT FINAL]",
        JSON.stringify(
          promoted_object,
          null,
          2
        )
      );
      const asr =
        await fetch(
          `https://graph.facebook.com/${API_VERSION}/${acc}/adsets`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body:
              JSON.stringify(asb)
          }
        );

      const asrd =
        await safeJson(asr);

      if (
        !asr.ok
        ||
        asrd.error
      ) {

        throw new Error(
          JSON.stringify(
            asrd
          )
        );

      }

      adSetId =
        asrd.id;


      console.log(
        `[Worker] Conjunto creado correctamente: ${adSetId}`
      );
    }

    // Debug AdSet info always (NEW or EXISTING)
    try {
      const adSetInfo = await fetch(
        `https://graph.facebook.com/${API_VERSION}/${adSetId}` +
        `?fields=id,name,destination_type,promoted_object` +
        `&access_token=${token}`
      ).then(r => safeJson(r));

      console.log(
        "[Worker] INFO ADSET ACTUAL EN META:",
        JSON.stringify(adSetInfo, null, 2)
      );
    } catch (e) {
      console.error("[Worker] Error consultando info del AdSet:", e.message);
    }

    let creativeId;

    // If editing and no new media, fetch existing creative details
    let existingMediaId = null;
    let existingMediaType = null;
    if (config.adId !== "NEW" && !mediaId) {

      const adr = await fetch(
        `https://graph.facebook.com/${API_VERSION}/${config.adId}?fields=creative{id,object_story_spec}&access_token=${token}`
      );

      const adrd = await safeJson(adr);

      const spec = adrd.creative?.object_story_spec;

      if (spec) {

        if (spec.link_data) {
          existingMediaId = spec.link_data.image_hash;
          existingMediaType = "img";
        }

        else if (spec.video_data) {
          existingMediaId = spec.video_data.video_id;
          existingMediaType = "vid";
        }

      }
    }

    const finalMediaId = mediaId || existingMediaId;
    const finalMediaType = mediaType || existingMediaType;
    if (
      !finalMediaId
      &&
      config.adId === "NEW"
    ) {

      throw new Error(
        "No hay media seleccionada"
      );

    }
    if (finalMediaId) {

      console.log(
        `[Worker] Configurando AdCreative con Media ${finalMediaId}`
      );

      const finalMsg =
        `${config.primaryText}\n\n${FIXED_TEXT}`;

      const destinationLink =
        config.destinationLink
        ||
        `https://facebook.com/${config.pageId}`;

      isMultiDestination =
        [
          "MESSAGING_MESSENGER_WHATSAPP",
          "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP",
          "MESSAGING_INSTAGRAM_DIRECT_MESSENGER",
          "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP"
        ].includes(destinationType);

      console.log(`[Worker] isMultiDestination: ${isMultiDestination}`);

      const cb = {

        name:
          `${config.adName}_${Date.now()}`,

        object_story_spec: {
          page_id: config.pageId
        },

        access_token:
          token
      };

      // Instagram opcional
      if (config.instagramId) {
        cb.object_story_spec.instagram_user_id =
          config.instagramId;
      }

      // Creative enhancement opcional

      if (
        config.enableCreativeEnhancement &&
        !config.isDynamicCreative &&
        finalMediaType !== "vid"
      ) {
        // tu lógica aquí
      }



      // =======================
      // IMAGEN
      // =======================

      if (finalMediaType === "img") {

        cb.object_story_spec.link_data = {
          image_hash: finalMediaId,
          message: finalMsg,
          name: config.headline || ""
        };
        console.log(
          "[MULTI DESTINATION CHECK]",
          JSON.stringify({
            destinationType,
            isMultiDestination,
            destinations
          }, null, 2)
        );
    // Asignar link y CTA base
    cb.object_story_spec.link_data.link =
      destinationLink || `https://facebook.com/${config.pageId}`;

    // Determinar CTA primaria (sirve de fallback en multi-destino)
    const primaryCTA =
      destinationType === "WHATSAPP"
        ? getCTA("whatsapp")
        : (destinations.includes("WHATSAPP") ? getCTA("whatsapp") : getCTA("messenger"));

    // SINGLE DESTINATION
    if (!isMultiDestination) {
      cb.object_story_spec.link_data.call_to_action = primaryCTA;
        }

        // MULTI DESTINATION
        else {
      // Para DOF, Meta a veces prefiere que link_data tenga la CTA primaria o ninguna.
      // Probaremos dejando la de WhatsApp si está disponible para darle peso.
      cb.object_story_spec.link_data.call_to_action = primaryCTA;

      // Pero conservar link porque Meta lo exige
          cb.object_story_spec.link_data.page_welcome_message =
            JSON.stringify({

              type: "VISUAL_EDITOR",

              version: 2,

              landing_screen_type:
                "welcome_message",

              media_type:
                "text",

              text_format: {

                customer_action_type:
                  "autofill_message",

                message: {

                  autofill_message: {

                    content:
                      config.autoFillMessage ||
                      "Quiero más información"

                  },

                  text:
                    "¡Hola! ¿Cómo podemos ayudarte?"

                }

              }

            });

          cb.asset_feed_spec = {

            optimization_type:
              "DOF_MESSAGING_DESTINATION",

            call_to_actions: [],

            additional_data: {

              multi_share_end_card:
                false,

              is_click_to_message:
                true

            }

          };

          if (
            destinations.includes(
              "WHATSAPP"
            )
          ) {

            cb.asset_feed_spec.call_to_actions.push({

              type:
                "WHATSAPP_MESSAGE",

              value: {

                app_destination:
                  "WHATSAPP"

              }

            });

          }

          if (
            destinations.includes(
              "MESSENGER"
            )
          ) {

            cb.asset_feed_spec.call_to_actions.push({

              type:
                "MESSAGE_PAGE",

              value: {

                app_destination:
                  "MESSENGER"

              }

            });

          }

          if (
            destinations.includes(
              "INSTAGRAM_DIRECT"
            )
          ) {

            cb.asset_feed_spec.call_to_actions.push({

              type:
                "INSTAGRAM_MESSAGE",

              value: {

                app_destination:
                  "INSTAGRAM_DIRECT"

              }

            });

          }

        }

      }


      // =======================
      // VIDEO
      // =======================

      else if (
        finalMediaType === "vid"
      ) {

        cb.object_story_spec.video_data = {

          video_id:
            finalMediaId,

          message:
            finalMsg,

          title:
            config.headline || ""

        };

        // Determinar CTA primaria
        const primaryCTA =
          destinationType === "WHATSAPP"
            ? getCTA("whatsapp")
            : (destinations.includes("WHATSAPP") ? getCTA("whatsapp") : getCTA("messenger"));

        // SINGLE DESTINATION
        if (!isMultiDestination) {
          cb.object_story_spec.video_data.call_to_action = primaryCTA;
        }

        // MULTI DESTINATION
        else {
          // Para Video multi-destino, Meta requiere que video_data NO tenga CTA
          // pero que asset_feed_spec SI las tenga.
          // Sin embargo, para que funcione el 'DOF_MESSAGING_DESTINATION',
          // necesitamos un link_data base.
          cb.object_story_spec.link_data = {
            link: `https://facebook.com/${config.pageId}`,
            call_to_action: primaryCTA
          };

          cb.object_story_spec.link_data.page_welcome_message =
            JSON.stringify({

              type: "VISUAL_EDITOR",

              version: 2,

              landing_screen_type:
                "welcome_message",

              media_type:
                "text",

              text_format: {

                customer_action_type:
                  "autofill_message",

                message: {

                  autofill_message: {

                    content:
                      config.autoFillMessage ||
                      "Quiero más información"

                  },

                  text:
                    "¡Hola! ¿Cómo podemos ayudarte?"

                }

              }

            });

          cb.asset_feed_spec = {

            optimization_type:
              "DOF_MESSAGING_DESTINATION",

            call_to_actions: [],

            additional_data: {

              multi_share_end_card:
                false,

              is_click_to_message:
                true

            }

          };

          if (destinations.includes("WHATSAPP")) {

            cb.asset_feed_spec.call_to_actions.push({

              type: "WHATSAPP_MESSAGE",

              value: {

                app_destination:
                  "WHATSAPP"

              }

            });

          }

          if (destinations.includes("MESSENGER")) {

            cb.asset_feed_spec.call_to_actions.push({

              type: "MESSAGE_PAGE",

              value: {

                app_destination:
                  "MESSENGER"

              }

            });

          }

          if (destinations.includes("INSTAGRAM_DIRECT")) {

            cb.asset_feed_spec.call_to_actions.push({

              type: "INSTAGRAM_MESSAGE",

              value: {

                app_destination:
                  "INSTAGRAM_DIRECT"

              }

            });

          }

        }
      }
      console.log(
        "[CREATIVE PAYLOAD]",
        JSON.stringify(
          {

            destinationType,

            isMultiDestination,

            linkCTA:
              cb.object_story_spec
                ?.link_data
                ?.call_to_action,

            videoCTA:
              cb.object_story_spec
                ?.video_data
                ?.call_to_action,

            link:
              cb.object_story_spec
                ?.link_data
                ?.link,

            assetFeed:
              cb.asset_feed_spec

          },
          null,
          2
        )
      );

      console.log(
        "[VERIFY CTA]",
        JSON.stringify(
          {
            link:
              cb.object_story_spec?.link_data?.link,

            linkCTA:
              cb.object_story_spec?.link_data?.call_to_action,

            videoCTA:
              cb.object_story_spec?.video_data?.call_to_action,

            assetFeed:
              cb.asset_feed_spec,

            destinations,
            destinationType,
            isMultiDestination
          },
          null,
          2
        )
      );
      console.log("[Worker] Payload completo para AdCreative:", JSON.stringify(cb, null, 2));
      const ctr = await fetch(
        `https://graph.facebook.com/${API_VERSION}/${acc}/adcreatives`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(cb)
        }
      );

      const creativeRaw = await ctr.text();
      console.log("[Worker] Respuesta de Meta AdCreative (Raw):", creativeRaw);

      let ctrd = {};

      try {

        ctrd = JSON.parse(creativeRaw);

      } catch (e) {

        throw new Error(
          "Respuesta inválida de Meta: " +
          creativeRaw
        );

      }

      if (!ctr.ok || ctrd.error) {

        console.error(
          "[META CREATIVE ERROR]",
          JSON.stringify(ctrd, null, 2)
        );

        throw new Error(
          "Error creando creativo: " +
          JSON.stringify(ctrd, null, 2)
        );

      }

      if (!ctrd.id) {

        throw new Error(
          "Meta no devolvió ID del creativo"
        );

      }

      creativeId = ctrd.id;
      console.log(`[Worker] AdCreative creado: ${creativeId}`);
    }

    if (!creativeId && config.adId === "NEW") {
      throw new Error("creativeId vacío");
    }

    // Inspect Creative to get DOF spec
    let creativeInspectData = {};
    try {
      const creativeInspect = await fetch(
        `https://graph.facebook.com/${API_VERSION}/${creativeId}` +
        `?fields=id,object_story_spec,asset_feed_spec,degrees_of_freedom_spec` +
        `&access_token=${token}`
      );
      creativeInspectData = await safeJson(creativeInspect);
      console.log("[Worker] INFO CREATIVE ACTUAL EN META:", JSON.stringify(creativeInspectData, null, 2));
    } catch (e) {
      console.error("[Worker] Error consultando info del Creative:", e.message);
    }


    if (config.adId !== "NEW") {
      console.log(`[Worker] Actualizando Anuncio existente: ${config.adId}`);
      console.log(`[Worker] adSetId para update: ${adSetId}`);
      const adBody = {
        name: config.adName,
        adset_id: adSetId,
        creative: {
          creative_id: creativeId
        },
        status: config.status || "PAUSED",
        access_token: token
      };
      const adr = await fetch(`https://graph.facebook.com/${API_VERSION}/${config.adId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: config.adName,
          creative: creativeId ? { creative_id: creativeId } : undefined,
          status: config.status || 'PAUSED',
          access_token: token
        })
      });
      const res = await safeJson(adr);
      if (res.error) {
        console.error("Error Meta Ads (Update):", JSON.stringify(res.error));
        throw new Error("Error actualizando anuncio: " + (res.error.message || JSON.stringify(res.error)));
      }
      console.log(`Anuncio actualizado: ${config.adId}`);
      return new Response(JSON.stringify({ success: true, adId: config.adId }), { headers: { "Content-Type": "application/json" } });
    }

    else if (creativeId) {

      console.log("Creando el anuncio final...");

      const creativeObject = {
        creative_id: creativeId
      };

      // Si es multi-destino, NO pasamos el degrees_of_freedom_spec si solo trae OPT_OUTs
      // ya que Meta lo activa automáticamente al detectar asset_feed_spec.
      // Solo lo pasaríamos si quisiéramos FORZAR un enrolamiento específico.

      const adBody = {
        name: config.adName,

        adset_id: adSetId,

        creative: creativeObject,

        status:
          config.status ||
          "PAUSED",

        access_token:
          token
      };

      console.log("[Worker] Payload para crear Anuncio:", JSON.stringify(adBody, null, 2));
      const adr = await fetch(
        `https://graph.facebook.com/${API_VERSION}/${acc}/ads`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(adBody)
        }
      );

      const res = await safeJson(adr);
      console.log("[Worker] Respuesta de Meta Ad (JSON):", JSON.stringify(res, null, 2));

      if (
        !adr.ok ||
        res.error ||
        !res.id
      ) {
        console.error("Error Meta Ads (Create):", JSON.stringify(res.error));
        throw new Error(
          JSON.stringify({
            message: res.error?.message,
            code: res.error?.code,
            subcode: res.error?.error_subcode,
            title: res.error?.error_user_title,
            detail: res.error?.error_user_msg,
            trace: res.error?.fbtrace_id
          }, null, 2)
        );
      }
      console.log(`Anuncio publicado exitosamente: ${res.id}`);

      const adInspect = await fetch(
        `https://graph.facebook.com/${API_VERSION}/${res.id}` +
        `?fields=id,adset{id,destination_type,promoted_object}` +
        `&access_token=${token}`
      ).then(r => safeJson(r));

      console.log(
        "[FINAL AD DESTINATION]",
        JSON.stringify(adInspect, null, 2)
      );

      const adInfo = await fetch(
        `https://graph.facebook.com/${API_VERSION}/${res.id}` +
        `?fields=id,name,creative{object_story_spec,asset_feed_spec}` +
        `&access_token=${token}`
      ).then(r => safeJson(r));

      console.log(
        "[FINAL AD INFO]",
        JSON.stringify(adInfo, null, 2)
      );

      // NUEVO LOG
      const adInfoExtended = await fetch(
        `https://graph.facebook.com/${API_VERSION}/${res.id}` +
        `?fields=id,name,adset{id,destination_type,promoted_object}` +
        `&access_token=${token}`
      ).then(r => safeJson(r));

      console.log(
        "[FINAL AD INFO EXTENDED]",
        JSON.stringify(adInfoExtended, null, 2)
      );

      return new Response(
        JSON.stringify({
          success: true,
          adId: res.id
        }),
        {
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
        }
    return new Response(JSON.stringify({ success: false, error: "No se pudo generar el creativo (mediaId faltante)" }), { status: 400 });
  } catch (e) {
    console.error("Error fatal en handleCreateAdvancedAd:", e);
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
  }
}

// --- INTERFAZ VISUAL ---

function generateHTML(env, initialData = null) {
  const meta_token = (initialData && initialData.access_token) ? "Sesión Dinámica (Landing)" : (env.META_ACCESS_TOKEN ? "Configurado (oculto)" : "No configurado");
  const openai_key = env.OPENAI_API_KEY ? "Configurado (oculto)" : "No configurado";
  const ad_acc_id = (initialData && initialData.ad_account_id) || env.AD_ACCOUNT_ID || "";
  const whatsapp_1 = (initialData && initialData.whatsapp_numbers && initialData.whatsapp_numbers.WHATSAPP_1) || env.WHATSAPP_1 || "";
  const whatsapp_2 = (initialData && initialData.whatsapp_numbers && initialData.whatsapp_numbers.WHATSAPP_2) || env.WHATSAPP_2 || "";
  const whatsapp_3 = (initialData && initialData.whatsapp_numbers && initialData.whatsapp_numbers.WHATSAPP_3) || env.WHATSAPP_3 || "";
  const whatsapp_4 = (initialData && initialData.whatsapp_numbers && initialData.whatsapp_numbers.WHATSAPP_4) || env.WHATSAPP_4 || "";
  const whatsapp_5 = (initialData && initialData.whatsapp_numbers && initialData.whatsapp_numbers.WHATSAPP_5) || env.WHATSAPP_5 || "";

  let html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Meta Expert</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .active-tab { background: #1e293b; color: #60a5fa; border-right: 4px solid #3b82f6; }
    .card { background: white; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05); padding: 1.5rem; }
    .loader-spin { width: 24px; height: 24px; border: 3px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .step-num { position: absolute; left: -1rem; top: 1.5rem; width: 2rem; height: 2rem; background: #2563eb; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border: 2px solid white; z-index: 10; }
  </style>
</head>
<body class="bg-slate-50 flex h-screen overflow-hidden font-sans relative">
  <div id="side-overlay" onclick="toggleSidebar()" class="fixed inset-0 bg-black/50 z-40 hidden lg:hidden transition-opacity"></div>

  <nav id="sidebar" class="fixed lg:static inset-y-0 left-0 w-64 bg-[#0f172a] text-white flex flex-col justify-between py-8 shrink-0 z-50 shadow-xl transition-transform -translate-x-full lg:translate-x-0">
    <div>
      <div class="px-8 mb-12 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-black">M</div>
          <h1 class="text-xl font-black tracking-tighter uppercase">Meta Expert</h1>
        </div>
        <button onclick="toggleSidebar()" class="lg:hidden p-1 hover:bg-slate-800 rounded">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="space-y-1">
        <button id="nav-dash" onclick="tab('dash')" class="w-full px-8 py-3 flex items-center gap-3 text-slate-400 hover:bg-slate-800 transition">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"/></svg> Reportes
        </button>
        <button id="nav-create" onclick="tab('create')" class="w-full px-8 py-3 flex items-center gap-3 active-tab transition">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg> Crear Anuncio
        </button>
        <button id="nav-config" onclick="tab('config')" class="w-full px-8 py-3 flex items-center gap-3 text-slate-400 hover:bg-slate-800 transition">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924-1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg> API Config
        </button>
      </div>
    </div>
    <div class="px-8 text-[10px] uppercase tracking-widest text-slate-500 font-bold">Cloudflare Worker Edition</div>
  </nav>

  <main class="flex-1 flex flex-col overflow-hidden relative z-10">
    <header class="lg:hidden bg-[#0f172a] text-white p-4 flex items-center justify-between shadow-lg">
      <div class="flex items-center gap-3">
        <button onclick="toggleSidebar()" class="p-2 hover:bg-slate-800 rounded-lg">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7"/></svg>
        </button>
        <span class="font-black uppercase tracking-tighter text-sm">Meta Expert</span>
      </div>
      <div id="mobile-tab-title" class="text-[10px] font-bold text-blue-400 uppercase">Crear Anuncio</div>
    </header>

    <div id="tab-create" class="flex-1 flex flex-col lg:flex-row overflow-hidden p-4 lg:p-8 gap-4 lg:gap-8">
      <div class="flex-1 overflow-y-auto space-y-6 pb-20 px-4">
        <div class="card relative">
          <div class="step-num">1</div>
          <h2 class="text-sm font-black uppercase tracking-widest text-slate-800 mb-6">Campaña</h2>
          <div class="space-y-4">
            <div>
              <label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Seleccionar Campaña</label>
              <select id="sel-camp" onfocus="if(this.options.length <= 1) fetchActiveCampaigns()" onchange="loadAdSets(this.value)" class="w-full bg-slate-50 border rounded-lg p-3 text-sm font-bold text-slate-700">
                <option value="NEW">+ Crear Nueva Campaña</option>
              </select>
            </div>
            <div id="camp-new-config" class="space-y-4">
              <input type="text" id="cn" placeholder="Nombre de la Nueva Campaña..." class="w-full bg-slate-50 border rounded-lg p-3 outline-none text-lg focus:ring-2 ring-blue-500 font-medium text-slate-700">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Objetivo</label>
                  <select id="ob" class="w-full bg-slate-50 border rounded-lg p-3 outline-none font-bold text-slate-600 cursor-pointer">
                    <option value="OUTCOME_ENGAGEMENT">Interacción</option>
                    <option value="OUTCOME_SALES">Ventas</option>
                  </select>
                </div>
                <div>
                  <label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Tipo de Compra</label>
                  <input type="text" value="Subasta" readonly class="w-full bg-slate-100 border rounded-lg p-3 text-sm font-bold text-slate-500">
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="card relative">
          <div class="step-num">2</div>
          <h2 class="text-sm font-black uppercase tracking-widest text-slate-800 mb-6">Conjunto de Anuncios</h2>
          <div class="space-y-4">
            <div>
              <label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Seleccionar Conjunto</label>
              <select id="sel-adset" onfocus="if(this.options.length <= 1 && document.getElementById('sel-camp').value !== 'NEW') loadAdSets(document.getElementById('sel-camp').value)" onchange="loadAds(this.value)" class="w-full bg-slate-50 border rounded-lg p-3 text-sm font-bold text-slate-700">
                <option value="NEW">+ Crear Nuevo Conjunto</option>
              </select>
            </div>
            <div id="adset-new-config" class="space-y-4">
              <input type="text" id="asn" placeholder="Nombre del Nuevo Conjunto..." class="w-full bg-slate-50 border rounded-lg p-3 outline-none text-sm font-bold text-slate-700">
              <div class="grid grid-cols-2 gap-4">
                <div><label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Estrategia Ciclo de Vida</label><input type="text" value="Captar nuevos clientes" readonly class="w-full bg-slate-100 border rounded-lg p-3 text-sm font-bold text-slate-500"></div>
                <div><label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Ubicación Conversión</label><input type="text" value="Destinos mensajes" readonly class="w-full bg-slate-100 border rounded-lg p-3 text-sm font-bold text-slate-500"></div>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div><label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Destinos de Mensajes</label><div class="flex flex-wrap gap-2 mt-2"><label class="flex items-center gap-1 text-[10px] font-bold"><input type="checkbox" id="dest-msg" checked> Messenger</label><label class="flex items-center gap-1 text-[10px] font-bold"><input type="checkbox" id="dest-ig" checked> Instagram</label><label class="flex items-center gap-1 text-[10px] font-bold"><input type="checkbox" id="dest-wa" onchange="document.getElementById('wa-number-config').classList.toggle('hidden', !this.checked)"> WhatsApp</label></div></div>
                <div><label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Objetivo Rendimiento</label><input type="text" value="Maximizar conversaciones" readonly class="w-full bg-slate-100 border rounded-lg p-3 text-sm font-bold text-slate-500"></div>
              </div>
              <div id="wa-number-config" class="hidden"><label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Número WhatsApp</label><select id="wa-num" class="w-full bg-slate-50 border rounded-lg p-3 text-sm font-bold text-slate-700"><option value="">Seleccione número...</option></select></div>
              <div class="grid grid-cols-2 gap-4">
                <div><label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Presupuesto Diario (Q)</label><input type="number" id="ba" value="250" class="w-full bg-slate-50 border rounded-lg p-3 font-black text-blue-600"></div>
                <div><label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Fecha de Inicio</label><input type="date" id="sd" class="w-full bg-slate-50 border rounded-lg p-3 text-sm font-bold text-slate-700"></div>
              </div>
              <div class="space-y-2">
                <label class="text-[10px] font-bold text-slate-400 uppercase block">Público</label>
                <select id="sel-audience" class="w-full bg-slate-50 border rounded-lg p-3 text-sm font-bold text-slate-700"><option value="">+ Crear Público Manual</option></select>
                <div id="manual-audience" class="space-y-4 border-t pt-4">
                  <div><label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Lugares (Departamentos GT)</label><div id="dept-list" class="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto border p-2 rounded"></div></div>
                  <div class="grid grid-cols-2 gap-4">
                    <div><label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Edad Mín</label><input type="number" id="ami" value="18" class="w-full bg-slate-50 border rounded-lg p-3 text-sm"></div>
                    <div><label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Sugerir Público (Intereses)</label><input type="text" id="adsug" placeholder="Ej: Muebles, Decoración..." class="w-full bg-slate-50 border rounded-lg p-3 text-sm"></div>
                  </div>
                </div>
              </div>
              <div><label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Plataformas</label><div class="flex flex-wrap gap-4 mt-2"><label class="flex items-center gap-1 text-[10px] font-bold"><input type="checkbox" id="plat-fb" checked> Facebook</label><label class="flex items-center gap-1 text-[10px] font-bold"><input type="checkbox" id="plat-ig" checked> Instagram</label><label class="flex items-center gap-1 text-[10px] font-bold"><input type="checkbox" id="plat-an" checked> Audience Network</label><label class="flex items-center gap-1 text-[10px] font-bold"><input type="checkbox" id="plat-msg" checked> Messenger</label></div></div>
            </div>
          </div>
        </div>

        <div class="card relative">
          <div class="step-num">3</div>
          <h2 class="text-sm font-black uppercase tracking-widest text-slate-800 mb-6">Anuncio</h2>
          <div class="space-y-4">
            <div><label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Seleccionar Anuncio (Editar)</label><select id="sel-ad" onfocus="if(this.options.length <= 1 && document.getElementById('sel-adset').value !== 'NEW') loadAds(document.getElementById('sel-adset').value)" onchange="loadAdDetails(this.value)" class="w-full bg-slate-50 border rounded-lg p-3 text-sm font-bold text-slate-700"><option value="NEW">+ Crear Nuevo Anuncio</option></select></div>
            <div id="ad-config" class="space-y-4">
              <input type="text" id="ad-name" placeholder="Nombre del Anuncio..." class="w-full bg-slate-50 border rounded-lg p-3 outline-none text-sm font-bold text-slate-700">
              <div class="grid grid-cols-2 gap-4">
                <div><label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Página de Facebook</label><select id="pgs" onchange="updatePageDetails(this.value)" class="w-full bg-slate-50 border rounded-lg p-3 text-sm font-bold text-slate-700"></select></div>
                <div><label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Perfil de Instagram</label><select id="sel-ig" class="w-full bg-slate-50 border rounded-lg p-3 text-sm font-bold text-slate-700"></select></div>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div><label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Formato</label><select id="ad-format" class="w-full bg-slate-50 border rounded-lg p-3 text-sm font-bold text-slate-700"><option value="SINGLE_IMAGE_OR_VIDEO">Imagen o video único</option><option value="CAROUSEL">Secuencia</option></select></div>
                <div><label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Anuncios multianunciante</label><input type="text" value="Activado" readonly class="w-full bg-slate-100 border rounded-lg p-3 text-sm font-bold text-slate-500"></div>
              </div>
              <div class="space-y-2">
                <label class="text-[10px] font-bold text-slate-400 uppercase block">Conversaciones (Plantilla)</label><select id="sel-template" onfocus="if(this.options.length <= 1) updatePageDetails(document.getElementById('pgs').value)" onchange="initTemplateUI()" class="w-full bg-slate-50 border rounded-lg p-3 text-sm font-bold text-slate-700"><option value="NEW">+ Crear Nueva Plantilla</option></select>
                <div id="new-template-config" class="space-y-4 border-t pt-4 hidden"><input type="text" id="tpl-text" placeholder="Texto de bienvenida..." class="w-full bg-slate-50 border rounded-lg p-3 text-sm"><input type="text" id="tpl-res" placeholder="Respuesta sugerida..." class="w-full bg-slate-50 border rounded-lg p-3 text-sm"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="w-full lg:w-80 flex flex-col gap-6 shrink-0">
        <div class="card flex-1 lg:overflow-y-auto space-y-4 shadow-xl">
          <input type="file" id="fi" class="hidden" onchange="preview(this)">
          <div id="dropzone" onclick="document.getElementById('fi').click()" class="border-2 border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center text-slate-400 hover:border-blue-400 cursor-pointer aspect-square max-w-[120px] sm:max-w-none mx-auto w-full bg-slate-50 group transition"><svg class="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg><span class="text-xs font-black uppercase">Sube Imagen o Video</span></div>
          <button onclick="suggestIA()" id="btn-ia" class="w-full bg-gradient-to-r from-indigo-600 to-blue-500 text-white rounded-xl py-3 font-black shadow-lg uppercase text-[11px] tracking-widest">Sugerir con IA ✨</button>
          <textarea id="pt" placeholder="Texto Principal" class="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 outline-none text-sm h-32"></textarea>
          <input type="text" id="hd" placeholder="Título del Anuncio" class="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 outline-none text-sm font-medium">
          <select class="w-full bg-slate-100 border-none rounded-xl p-3 outline-none text-sm font-bold text-slate-600"><option>Enviar Mensaje</option></select>
        </div>
        <button onclick="launchAd()" id="btn-go" class="w-full bg-blue-600 text-white rounded-2xl py-5 font-black text-lg shadow-xl shadow-blue-300 hover:bg-blue-700 transition uppercase tracking-widest">Lanzar Ahora</button>
      </div>
    </div>

    <div id="tab-dash" class="hidden flex-1 flex flex-col p-4 lg:p-8 overflow-y-auto">
      <div class="max-w-6xl mx-auto w-full">
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <h1 class="text-2xl font-black text-slate-800 flex items-center gap-3"><div class="w-2 h-8 bg-blue-600 rounded-full"></div>Centro de Reportes</h1>
          <div class="flex gap-2 items-center"><input type="date" id="rep-start" class="bg-white border rounded-lg p-2 text-xs font-bold"><span class="text-slate-400">al</span><input type="date" id="rep-end" class="bg-white border rounded-lg p-2 text-xs font-bold"><button onclick="loadDash()" class="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold text-xs uppercase tracking-widest">Buscar</button></div>
        </div>
        <div id="dash-main" class="space-y-4"></div>
      </div>
    </div>

    <div id="tab-config" class="hidden flex-1 flex flex-col p-4 lg:p-8 overflow-y-auto">
      <div class="max-w-xl mx-auto w-full space-y-6">
        <h1 class="text-2xl font-black mb-8 text-slate-800">Configuración</h1>
        <div class="card space-y-4">
          <div><label class="text-[10px] font-black uppercase text-slate-400">Meta Token</label><input type="text" id="mt" value="[META_TOKEN]" readonly class="w-full border p-3 rounded-lg bg-slate-100"></div>
          <div><label class="text-[10px] font-black uppercase text-slate-400">OpenAI Key</label><input type="text" id="ok" value="[OPENAI_KEY]" readonly class="w-full border p-3 rounded-lg bg-slate-100"></div>
          <div><label class="text-[10px] font-black uppercase text-slate-400">Ad Account ID</label><input type="text" id="aa" value="[AD_ACC_ID]" readonly class="w-full border p-3 rounded-lg bg-slate-100"></div>
          <hr class="my-4"><h3 class="font-black text-sm text-slate-700 uppercase">Números WhatsApp Configurados</h3>
          <div><label class="text-[10px] font-black uppercase text-slate-400">WhatsApp 1</label><input type="text" id="wa1" value="[WHATSAPP_1]" readonly class="w-full border p-3 rounded-lg bg-slate-100"></div>
          <div><label class="text-[10px] font-black uppercase text-slate-400">WhatsApp 2</label><input type="text" id="wa2" value="[WHATSAPP_2]" readonly class="w-full border p-3 rounded-lg bg-slate-100"></div>
          <div><label class="text-[10px] font-black uppercase text-slate-400">WhatsApp 3</label><input type="text" id="wa3" value="[WHATSAPP_3]" readonly class="w-full border p-3 rounded-lg bg-slate-100"></div>
          <div><label class="text-[10px] font-black uppercase text-slate-400">WhatsApp 4</label><input type="text" id="wa4" value="[WHATSAPP_4]" readonly class="w-full border p-3 rounded-lg bg-slate-100"></div>
          <div><label class="text-[10px] font-black uppercase text-slate-400">WhatsApp 5</label><input type="text" id="wa5" value="[WHATSAPP_5]" readonly class="w-full border p-3 rounded-lg bg-slate-100"></div>
          <p class="text-[10px] text-slate-400 font-bold uppercase italic">Los valores se toman de las variables de entorno de Cloudflare para mayor seguridad.</p>
          <div class="flex gap-2"><button onclick="checkPerms()" class="flex-1 bg-blue-100 text-blue-700 py-4 rounded-xl font-black uppercase tracking-widest text-xs mt-4 border border-blue-200">Verificar Permisos</button><button onclick="alert('Configuración guardada (Local). Use Cloudflare para cambios permanentes.')" class="flex-1 bg-slate-800 text-white py-4 rounded-xl font-black uppercase tracking-widest text-xs mt-4">Guardar</button></div>
        </div>
      </div>
    </div>
  </main>

  <div id="ldr" class="fixed inset-0 bg-[#0f172a]/90 backdrop-blur-md flex items-center justify-center hidden text-white flex-col gap-6 z-[100] transition duration-500"><div class="relative w-20 h-20"><div class="absolute inset-0 border-4 border-blue-500/20 rounded-full"></div><div class="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div><div class="text-center max-w-sm w-full px-4"><p class="font-black tracking-widest uppercase text-sm mb-2">Sincronizando con Meta...</p><div id="ldr-log" class="bg-black/40 rounded-lg p-3 text-left font-mono text-[9px] h-32 overflow-y-auto space-y-1 border border-white/10"></div><p id="ldr-msg" class="mt-2 text-[10px] font-bold text-blue-400 uppercase tracking-tighter opacity-70 animate-pulse">Iniciando proceso...</p></div></div>

<script>
    window.onerror = function(msg, url, line, col, error) { alert("Error en la App: " + msg + "\\nLínea: " + line); console.error(error); return false; };
    window.INITIAL_DATA = JSON.parse(document.getElementById('initial-data').textContent);
    const DEPTS_GT = ["Alta Verapaz", "Baja Verapaz", "Chimaltenango", "Chiquimula", "El Progreso", "Escuintla", "Guatemala", "Huehuetenango", "Izabal", "Jalapa", "Jutiapa", "Petén", "Quetzaltenango", "Quiché", "Retalhuleu", "Sacatepéquez", "San Marcos", "Santa Rosa", "Sololá", "Suchitepéquez", "Totonicapán", "Zacapa"];

    function loadWhatsAppNumbers() {
      const wa = document.getElementById('wa-num');
      wa.innerHTML = '<option value="">Seleccione número...</option>';

      const numbers = {
        WHATSAPP_1: document.getElementById('wa1').value,
        WHATSAPP_2: document.getElementById('wa2').value,
        WHATSAPP_3: document.getElementById('wa3').value,
        WHATSAPP_4: document.getElementById('wa4').value,
        WHATSAPP_5: document.getElementById('wa5').value
      };

      Object.keys(numbers).forEach(key => {
        if (numbers[key] && numbers[key] !== "No configurado" && numbers[key] !== "") {
          const opt = document.createElement('option');
          opt.value = key;
          opt.innerText = key.replace('_', ' ') + (numbers[key].length > 5 ? (' (' + numbers[key] + ')') : '');
          wa.appendChild(opt);
        }
      });

      if (wa.options.length > 1) {
        wa.selectedIndex = 1;
      }
    }

    function getSession() {
      return {
        access_token: INITIAL_DATA.access_token || "",
        openai_api_key: INITIAL_DATA.openai_api_key || "",
        ad_account_id: INITIAL_DATA.ad_account_id || "",
        whatsapp_numbers: INITIAL_DATA.whatsapp_numbers || null
      };
    }

    window.onload=async()=>{
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('rep-start').value = today;
      document.getElementById('rep-end').value = today;
      document.getElementById('sd').value = today;

      if (INITIAL_DATA.campaign_code) {
        document.getElementById('cn').value = INITIAL_DATA.campaign_code;
      }
      if (INITIAL_DATA.ad_code) {
        const adNameInput = document.getElementById('ad-name');
        adNameInput.value = INITIAL_DATA.ad_code;
        adNameInput.readOnly = true;
        adNameInput.classList.add('bg-slate-100');
      }

      if (INITIAL_DATA.ad_headline) {
        document.getElementById('hd').value = INITIAL_DATA.ad_headline;
      }

      if (INITIAL_DATA.ad_text) {
        document.getElementById('pt').value = INITIAL_DATA.ad_text;
      }

      if (INITIAL_DATA.image_url) {
        document.getElementById('dropzone').innerHTML = '<img src="' + INITIAL_DATA.image_url + '" class="max-h-full rounded-xl shadow-lg border-2 border-white">';
      }

      loadWhatsAppNumbers();
      const dl = document.getElementById('dept-list');
      DEPTS_GT.forEach(dept => { const div = document.createElement('label'); div.className = 'flex items-center gap-2 bg-slate-100 p-2 rounded cursor-pointer hover:bg-slate-200 transition'; div.innerHTML = '<input type="checkbox" value="' + dept + '" class="dept-check"> <span class="text-[10px] font-bold">' + dept + '</span>'; dl.appendChild(div); });
      fetchAccounts(); fetchActiveCampaigns(); fetchCustomAudiences();
    };

    async function fetchAccounts() {
      try { const r = await fetch('/api/get-accounts', { method: 'POST', body: JSON.stringify(getSession()) }); const d = await r.json(); const s = document.getElementById('pgs'); s.innerHTML = '<option value="">Página de Facebook...</option>'; if (d.data) { d.data.forEach(p => s.add(new Option(p.name, p.id))); if (s.options.length > 1) { s.selectedIndex = 1; updatePageDetails(s.value); } } } catch (e) { console.error("Error fetching accounts:", e); }
    }

    async function fetchActiveCampaigns() {
      const sc = document.getElementById('sel-camp');
      sc.innerHTML = '<option value="">Cargando campañas...</option>';
      try {
        const r = await fetch('/api/get-active-campaigns', { method: 'POST', body: JSON.stringify(getSession()) });
        const d = await r.json();
        sc.innerHTML = '<option value="NEW">+ Crear Nueva Campaña</option>';
        if (d.data) {
          d.data.forEach(c => sc.add(new Option(c.name, c.id)));
          if (INITIAL_DATA.campaign_code) {
            for (let i=0; i<sc.options.length; i++) {
              if (sc.options[i].text.startsWith(INITIAL_DATA.campaign_code)) {
                sc.selectedIndex = i;
                loadAdSets(sc.value);
                break;
              }
            }
          }
        }
      } catch (e) { console.error("Error fetching campaigns:", e); }
    }

    async function fetchCustomAudiences() {
      try { const r = await fetch('/api/get-custom-audiences', { method: 'POST', body: JSON.stringify(getSession()) }); const d = await r.json(); const sa = document.getElementById('sel-audience'); sa.innerHTML = '<option value="">+ Crear Público Manual</option>'; if (d.data) d.data.forEach(a => sa.add(new Option(a.name, a.id))); } catch (e) { console.error("Error fetching audiences:", e); }
    }

    async function loadAdSets(campId) {
      const s = document.getElementById('sel-adset'); const campConfig = document.getElementById('camp-new-config');
      if (campId === "NEW" || !campId) { s.innerHTML = '<option value="NEW">+ Crear Nuevo Conjunto</option>'; campConfig.classList.toggle('hidden', campId !== "NEW"); return; }
      campConfig.classList.add('hidden'); s.innerHTML = '<option value="">Cargando conjuntos...</option>';
      try { const r = await fetch('/api/get-adsets', { method: 'POST', body: JSON.stringify({ ...getSession(), campaignId: campId }) }); const d = await r.json(); s.innerHTML = '<option value="NEW">+ Crear Nuevo Conjunto</option>'; if (d.data) d.data.forEach(as => s.add(new Option(as.name, as.id))); } catch (e) { console.error("Exception loadAdSets:", e); }
    }

    async function loadAds(adsetId) {
      const s = document.getElementById('sel-ad'); const adsetConfig = document.getElementById('adset-new-config');
      if (adsetId === "NEW" || !adsetId) { s.innerHTML = '<option value="NEW">+ Crear Nuevo Anuncio</option>'; adsetConfig.classList.toggle('hidden', adsetId !== "NEW"); return; }
      adsetConfig.classList.add('hidden'); s.innerHTML = '<option value="">Cargando anuncios...</option>';
      try { const r = await fetch('/api/get-ads', { method: 'POST', body: JSON.stringify({ ...getSession(), adsetId: adsetId }) }); const d = await r.json(); s.innerHTML = '<option value="NEW">+ Crear Nuevo Anuncio</option>'; if (d.data) d.data.forEach(ad => s.add(new Option(ad.name, ad.id))); } catch (e) { console.error("Exception loadAds:", e); }
    }

    async function loadAdDetails(adId) {
      if (adId === "NEW") return;
      try { const r = await fetch('/api/get-ad-details', { method: 'POST', body: JSON.stringify({ ...getSession(), adId }) }); const d = await r.json(); if (d.data) { document.getElementById('ad-name').value = d.data.name; document.getElementById('pt').value = d.data.creative?.object_story_spec?.link_data?.message || d.data.creative?.object_story_spec?.video_data?.message || ""; document.getElementById('hd').value = d.data.creative?.name || ""; } } catch (e) { console.error("Error loadAdDetails:", e); }
    }

    async function updatePageDetails(pageId){
      if(!pageId) return;
      try {
        const r1 = await fetch('/api/get-instagram-accounts', { method: 'POST', body: JSON.stringify({ ...getSession(), pageId }) });
        const d1 = await r1.json();
        const sig = document.getElementById('sel-ig');
        sig.innerHTML = '<option value="">Perfil de Instagram...</option>';
        if(d1.instagram_business_account) sig.add(new Option(d1.instagram_business_account.name || "Instagram vinculado", d1.instagram_business_account.id));
        else sig.add(new Option("No hay cuenta de IG vinculada", ""));

        const st = document.getElementById('sel-template');
        st.innerHTML = '<option value="">Cargando plantillas...</option>';
        const [r2, r3] = await Promise.all([
          fetch('/api/get-message-templates', { method:'POST', body:JSON.stringify({ ...getSession(), pageId }) }),
          fetch('/api/get-whatsapp-numbers', { method:'POST', body:JSON.stringify({ ...getSession(), pageId }) })
        ]);
        const d2 = await r2.json();
        st.innerHTML = '<option value="NEW">+ Crear Nueva Plantilla</option>';
        if(d2.data) d2.data.forEach(t => st.add(new Option(t.name, t.id)));
        initTemplateUI();
      } catch(e){ console.error("Error updating page details:", e); }
    }

    function tab(t) {
      const tabs = ["dash", "create", "config"];
      tabs.forEach(v => { const el = document.getElementById("tab-" + v); if (el) { el.style.display = "none"; el.classList.add("hidden"); } const nav = document.getElementById("nav-" + v); if (nav) nav.classList.remove("active-tab"); });
      const target = document.getElementById("tab-" + t);
      if (target) { target.classList.remove("hidden"); target.style.display = "flex"; }
      const targetNav = document.getElementById("nav-" + t); if (targetNav) targetNav.classList.add("active-tab");
      const mTitle = document.getElementById("mobile-tab-title"); if (mTitle) mTitle.innerText = {dash: "Reportes", create: "Crear Anuncio", config: "API Config"}[t] || "";
      if (window.innerWidth < 1024) toggleSidebar(false);
    }

    function initTemplateUI() { const val = document.getElementById('sel-template').value; const config = document.getElementById('new-template-config'); config.classList.toggle('hidden', val !== 'NEW'); }

    function toggleSidebar(force) {
      const sb = document.getElementById('sidebar'); const ov = document.getElementById('side-overlay');
      if (typeof force === 'boolean') { sb.classList.toggle('-translate-x-full', !force); sb.classList.toggle('translate-x-0', force); ov.classList.toggle('hidden', !force); return; }
      const isOpen = sb.classList.contains('translate-x-0');
      sb.classList.toggle('-translate-x-full', isOpen); sb.classList.toggle('translate-x-0', !isOpen); ov.classList.toggle('hidden', isOpen);
    }

    async function toggleStatus(id, currentStatus){
      const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      try { const r=await fetch('/api/update-status',{method:'POST',body:JSON.stringify({ ...getSession(), id, status:newStatus})}); const d=await r.json(); if(d.error) alert('Error: ' + d.error.message); loadDash(); } catch(e){ console.error("toggleStatus error:", e); }
    }

    async function loadDash(){
      document.getElementById('ldr').classList.remove('hidden');
      const start = document.getElementById('rep-start').value; const end = document.getElementById('rep-end').value;
      try {
        const r=await fetch('/api/get-full-report',{method:'POST',body:JSON.stringify({ ...getSession(), start, end})}); const d=await r.json(); if(d.error) { alert('Error: ' + d.error); return; }
        const container = document.getElementById('dash-main'); container.innerHTML = '';
        d.data.forEach(camp => {
          const msgs = camp.metrics?.actions?.find(a => a.action_type === 'onsite_conversion.messaging_first_reply') || { value:0 };
          const campDiv = document.createElement('div'); campDiv.className = 'bg-white rounded-xl shadow-sm border overflow-hidden mb-4';

          const header = document.createElement('div'); header.className = 'p-4 bg-slate-50 flex justify-between items-center cursor-pointer hover:bg-slate-100';
          header.onclick = () => { const c = campDiv.querySelector('.adsets-container'); if (c) c.classList.toggle('hidden'); };

          let headerHTML = '<div class="flex items-center gap-4"><div class="w-3 h-3 rounded-full ' + (camp.status === "ACTIVE" ? "bg-emerald-500" : "bg-slate-300") + '"></div><div><p class="text-xs font-black uppercase text-slate-400">Campaña</p><p class="font-bold text-slate-700">' + camp.name + '</p></div></div>' +
            '<div class="flex gap-8 text-right items-center"><div><p class="text-[10px] font-black text-slate-400 uppercase">Gasto</p><p class="font-bold text-slate-700">$' + camp.spend.toFixed(2) + '</p></div><div><p class="text-[10px] font-black text-slate-400 uppercase">Mensajes</p><p class="font-bold text-blue-600">' + msgs.value + '</p></div><div><p class="text-[10px] font-black text-slate-400 uppercase">Imp</p><p class="font-bold text-slate-700">' + camp.impressions + '</p></div><div><p class="text-[10px] font-black text-slate-400 uppercase">Alcance</p><p class="font-bold text-slate-700">' + camp.reach + '</p></div><div class="btn-placeholder"></div></div>';
          header.innerHTML = headerHTML;

          const campBtn = document.createElement('button');
          campBtn.className = 'px-4 py-2 ' + (camp.status === "ACTIVE" ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-600") + ' rounded-lg text-[10px] font-black uppercase';
          campBtn.innerText = camp.status === "ACTIVE" ? "Pausar" : "Activar";
          campBtn.onclick = (e) => { e.stopPropagation(); toggleStatus(camp.id, camp.status); };
          header.querySelector('.btn-placeholder').appendChild(campBtn);

          const adsetsContainer = document.createElement('div'); adsetsContainer.className = 'adsets-container hidden border-t';
          camp.adsets.forEach(as => {
            const amsgs = as.metrics?.actions?.find(a => a.action_type === 'onsite_conversion.messaging_first_reply') || { value:0 };
            const asDiv = document.createElement('div'); asDiv.className = 'p-4 border-b ml-8 bg-white';

            asDiv.innerHTML = '<div class="flex justify-between items-center mb-4"><div class="flex items-center gap-3"><div class="w-2 h-2 rounded-full ' + (as.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-300') + '"></div><p class="text-sm font-bold text-slate-600">AS: ' + as.name + '</p></div><div class="flex gap-6 text-right items-center"><span class="text-[10px] font-bold text-slate-500">$' + as.spend.toFixed(2) + ' | ' + amsgs.value + ' MSGs | ' + as.impressions + ' Imp | ' + as.reach + ' Alcance</span><div class="as-btn-placeholder"></div></div></div>';

            const asBtn = document.createElement('button');
            asBtn.className = 'text-[10px] font-black uppercase ' + (as.status === 'ACTIVE' ? 'text-red-500' : 'text-emerald-500');
            asBtn.innerText = as.status === 'ACTIVE' ? 'OFF' : 'ON';
            asBtn.onclick = () => toggleStatus(as.id, as.status);
            asDiv.querySelector('.as-btn-placeholder').appendChild(asBtn);

            const adsGrid = document.createElement('div'); adsGrid.className = 'grid grid-cols-1 gap-2';
            as.ads.forEach(ad => {
              const admsgs = ad.metrics?.actions?.find(a => a.action_type === 'onsite_conversion.messaging_first_reply') || { value:0 };
              const adDiv = document.createElement('div'); adDiv.className = 'bg-slate-50 p-4 rounded-xl ml-4 mb-4 border border-slate-100 shadow-sm';

              adDiv.innerHTML = '<div class="flex flex-col md:flex-row gap-6"><div class="shrink-0 flex justify-center"><img src="' + ad.image + '" class="w-48 h-48 rounded-lg bg-slate-200 object-cover shadow-inner border border-white"></div><div class="flex-1 flex flex-col justify-between"><div><div class="flex items-center gap-2 mb-2"><div class="w-2 h-2 rounded-full ' + (ad.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-300') + '"></div><span class="text-[10px] font-black uppercase text-slate-400 tracking-widest">' + ad.status + '</span></div><p class="text-lg font-black text-slate-800 leading-tight mb-4">' + ad.name + '</p><div class="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-white p-3 rounded-lg border border-slate-100"><div><p class="text-[9px] font-black text-slate-400 uppercase">Gasto</p><p class="font-bold text-slate-700">$' + ad.spend.toFixed(2) + '</p></div><div><p class="text-[9px] font-black text-slate-400 uppercase">Mensajes</p><p class="font-bold text-blue-600">' + admsgs.value + '</p></div><div><p class="text-[9px] font-black text-slate-400 uppercase">Imp</p><p class="font-bold text-slate-700">' + ad.impressions + '</p></div><div><p class="text-[9px] font-black text-slate-400 uppercase">Alcance</p><p class="font-bold text-slate-700">' + ad.reach + '</p></div></div></div><div class="flex justify-end mt-4 ad-btn-placeholder"></div></div></div>';

              const adBtn = document.createElement('button');
              adBtn.className = 'flex items-center gap-2 px-6 py-2 rounded-lg font-bold text-xs uppercase tracking-widest transition ' + (ad.status === 'ACTIVE' ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100');
              adBtn.innerText = ad.status === 'ACTIVE' ? 'Pausar' : 'Activar';
              adBtn.onclick = () => toggleStatus(ad.id, ad.status);
              adDiv.querySelector('.ad-btn-placeholder').appendChild(adBtn);

              adsGrid.appendChild(adDiv);
            });
            asDiv.appendChild(adsGrid); adsetsContainer.appendChild(asDiv);
          });
          campDiv.appendChild(header); campDiv.appendChild(adsetsContainer); container.appendChild(campDiv);
        });
      } catch(e){ console.error("loadDash error:", e); } finally { document.getElementById('ldr').classList.add('hidden'); }
    }

    function preview(input){ if(input.files && input.files[0]){ const reader=new FileReader(); reader.onload=e=>document.getElementById('dropzone').innerHTML='<img src="'+e.target.result+'" class="max-h-full rounded-xl shadow-lg border-2 border-white">'; reader.readAsDataURL(input.files[0]); } }

    async function suggestIA(){
      const pt=document.getElementById('pt'); const hd=document.getElementById('hd'); const btn=document.getElementById('btn-ia'); const old=btn.innerHTML; btn.innerHTML='<div class="loader-spin mx-auto"></div>';
      try {
        const file = document.getElementById('fi').files[0]; let base64Image = null;
        if (file && file.type.startsWith('image/')) { base64Image = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = e => resolve(e.target.result); reader.readAsDataURL(file); }); }
        const r=await fetch('/api/openai-generate',{ method:'POST', body:JSON.stringify({ ...getSession(), prompt: 'Genera un anuncio de Facebook Ads (Copywriting experto) para el producto: ' + document.getElementById('cn').value + '. Si hay una imagen, analízala para resaltar sus características.', image: base64Image }) });
        const d=await r.json();
        if (d.error) throw new Error(d.error);
        const aiMsg = d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message : null; if (!aiMsg || !aiMsg.content) throw new Error('No se recibió contenido de la IA');
        const aiResponse = aiMsg.content.replace(/\`\`\`json|\`\`\`/g, '').trim(); const res = JSON.parse(aiResponse); pt.value=res.texto || res.text; hd.value=res.titulo || res.headline;
      } catch(e){ console.error(e); pt.value='Error al generar sugerencia. Intente de nuevo.'; } finally { btn.innerHTML=old; }
    }

    function setLdr(msg){
      const msgEl = document.getElementById('ldr-msg'); if (msgEl) msgEl.innerText = msg;
      const log = document.getElementById('ldr-log'); if (log) { const entry = document.createElement('div'); entry.className = msg.includes('Error') ? 'text-red-400' : 'text-slate-300'; entry.innerHTML = '<span class="text-white/30 mr-1">' + new Date().toLocaleTimeString() + '</span> ' + msg; log.appendChild(entry); log.scrollTop = log.scrollHeight; }
    }

    async function checkPerms(){
      const ldr = document.getElementById('ldr'); ldr.classList.remove('hidden'); setLdr('Analizando Token y Cuenta...');
      try {
        const [r1, r2] = await Promise.all([ fetch('/api/check-permissions', {method:'POST', body: JSON.stringify(getSession())}), fetch('/api/debug-token', {method:'POST', body: JSON.stringify(getSession())}) ]); const d1 = await r1.json(); const d2 = await r2.json();
        let report = "--- REPORTE DE SALUD ---\\n\\n"; if(d1.token) report += 'TOKEN: ' + d1.token.status.toUpperCase() + ' - ' + d1.token.message + '\\n'; if(d1.account) report += 'CUENTA: ' + d1.account.status.toUpperCase() + ' - ' + d1.account.message + '\\n'; if(d2.data) { const expires = d2.data.expires_at ? new Date(d2.data.expires_at * 1000).toLocaleString() : "Nunca"; report += 'EXPIRA: ' + expires + '\\n'; report += 'TIPO: ' + d2.data.type + '\\n'; }
        ldr.classList.add('hidden'); alert(report);
      } catch(e) { ldr.classList.add('hidden'); alert('Error en verificación: ' + e.message); }
    }

    async function launchAd(){
      try {
        const isNewAd = document.getElementById('sel-ad').value === 'NEW'; const f=document.getElementById('fi').files[0]; const pageId = document.getElementById('pgs').value; const waNumber = document.getElementById('wa-num').value; const waChecked = document.getElementById('dest-wa').checked;
        const adSetName = document.getElementById('asn').value;
        if(document.getElementById('sel-adset').value === 'NEW' && !adSetName.trim()) { alert('El nombre del conjunto de anuncios es obligatorio.'); return; }
        if (waChecked && !waNumber) { alert('Seleccione un número de WhatsApp'); return; }
        if(isNewAd && !f) { alert('Debe subir una imagen o video para un anuncio nuevo.'); return; }
        if(!pageId) { alert('Seleccione una página emisora.'); return; }
        const ldr = document.getElementById('ldr'); const log = document.getElementById('ldr-log'); log.innerHTML = ''; ldr.classList.remove('hidden');
        setLdr('Verificando acceso a Meta...');
        try { const vr = await fetch('/api/check-permissions', {method:'POST', body: JSON.stringify(getSession())}); const vd = await vr.json(); if(vd.token?.status === 'error') throw new Error('Token inválido: ' + vd.token.message); setLdr('Acceso validado correctamente.'); if(vd.account?.status === 'error') { setLdr('Aviso de Cuenta: ' + vd.account.message); if(!confirm('Aviso de Cuenta: ' + vd.account.message + '\\n¿Desea intentar publicar de todos modos?')) { ldr.classList.add('hidden'); return; } } } catch(ve) { setLdr('Error de validación: ' + ve.message); setTimeout(() => ldr.classList.add('hidden'), 3000); return; }

        let resolvedRegions = []; const depts = Array.from(document.querySelectorAll('.dept-check:checked')).map(c => c.value);
        if(depts.length > 0) { setLdr("Resolviendo " + depts.length + " ubicaciones en Meta..."); try { const rr = await fetch('/api/resolve-regions', {method:'POST', body:JSON.stringify({ ...getSession(), depts })}); const rd = await rr.json(); resolvedRegions = rd.regions || []; setLdr("Ubicaciones resueltas: " + resolvedRegions.length); } catch(re) { setLdr('Error resolviendo ubicaciones: ' + re.message); } }

        let mediaId = null, mediaType = null;
        if(f) {
          setLdr("Preparando archivo: " + f.name + "...");
          try {
            const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(f); });
            setLdr("Subiendo " + (f.size/1024/1024).toFixed(2) + "MB a Meta...");
            const mr = await fetch('/api/upload-media', { method:'POST', body: JSON.stringify({ ...getSession(), fileName: f.name, fileType: f.type, fileSize: f.size, base64: base64 }) });
            const md = await mr.json(); if(md.error) throw new Error(md.error); mediaId = md.image_hash || md.video_id || md.id; mediaType = md.type; setLdr("Archivo subido exitosamente ID: " + mediaId);
          } catch(me) { setLdr('Error subiendo archivo: ' + me.message); setTimeout(() => ldr.classList.add('hidden'), 5000); return; }
        } else if (isNewAd && INITIAL_DATA.image_url) {
          setLdr("Descargando imagen desde URL...");
          try {
            const imgRes = await fetch(INITIAL_DATA.image_url);
            const blob = await imgRes.blob();
            const base64 = await new Promise((resolve) => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
            setLdr("Subiendo imagen de URL a Meta...");
            const mr = await fetch('/api/upload-media', { method:'POST', body: JSON.stringify({ ...getSession(), fileName: "image_from_url.jpg", fileType: blob.type || "image/jpeg", base64: base64 }) });
            const md = await mr.json(); if(md.error) throw new Error(md.error); mediaId = md.image_hash || md.id; mediaType = "img"; setLdr("Imagen de URL subida exitosamente");
          } catch(me) { setLdr('Error con imagen de URL: ' + me.message); setTimeout(() => ldr.classList.add('hidden'), 5000); return; }
        }

        setLdr('Publicando anuncio final en Meta...');
        const rawHeadline = document.getElementById('hd').value;
        const adCode = INITIAL_DATA.ad_code || "";
        const finalHeadline = rawHeadline ? (rawHeadline + " *" + adCode) : (document.getElementById('ad-name').value || adCode);

        const config={ mediaId, mediaType, resolvedRegions, campaignId:document.getElementById('sel-camp').value, campaignName:document.getElementById('cn').value, objective:document.getElementById('ob').value, adSetId:document.getElementById('sel-adset').value, adSetName:document.getElementById('asn').value, budgetAmount:document.getElementById('ba').value, startDate:document.getElementById('sd').value, messagingDestinations: { messenger: document.getElementById('dest-msg').checked, instagram: document.getElementById('dest-ig').checked, whatsapp: document.getElementById('dest-wa').checked }, whatsappNumber: document.getElementById('wa-num').value, audienceId: document.getElementById('sel-audience').value, manualAudience: { depts: Array.from(document.querySelectorAll('.dept-check:checked')).map(c => c.value), ageMin: document.getElementById('ami').value, interests: document.getElementById('adsug').value }, platforms: { facebook: document.getElementById('plat-fb').checked, instagram: document.getElementById('plat-ig').checked, audience_network: document.getElementById('plat-an').checked, messenger: document.getElementById('plat-msg').checked }, adId: document.getElementById('sel-ad').value, adName: document.getElementById('ad-name').value, pageId: document.getElementById('pgs').value, instagramId: document.getElementById('sel-ig').value, format: document.getElementById('ad-format').value, templateId: document.getElementById('sel-template').value, newTemplate: { text: document.getElementById('tpl-text').value, response: document.getElementById('tpl-res').value }, primaryText:document.getElementById('pt').value, headline:finalHeadline, status:'PAUSED' };
        const r=await fetch('/api/create-advanced-ad',{ method:'POST', body:JSON.stringify({ ...getSession(), config }) }); const res=await r.json();
        if(res.success){ setLdr('¡ÉXITO! Operación completada.'); setTimeout(() => { ldr.classList.add('hidden'); alert('¡ÉXITO! Campaña/Anuncio listo. ID: ' + res.adId); tab('dash'); loadDash(); }, 1500); } else { setLdr('Error Meta: ' + res.error); setTimeout(() => ldr.classList.add('hidden'), 5000); alert('ERROR: ' + res.error); }
      } catch(e) { console.error("Error fatal en launchAd:", e); alert('Error fatal: ' + e.message); const ldr = document.getElementById('ldr'); if(ldr) ldr.classList.add('hidden'); }
    }

    window.tab = tab; window.toggleSidebar = toggleSidebar; window.loadAdSets = loadAdSets; window.loadAds = loadAds; window.loadAdDetails = loadAdDetails; window.updatePageDetails = updatePageDetails;
    window.fetchAccounts = fetchAccounts; window.fetchActiveCampaigns = fetchActiveCampaigns; window.fetchCustomAudiences = fetchCustomAudiences;
    window.suggestIA = suggestIA; window.launchAd = launchAd; window.checkPerms = checkPerms; window.loadDash = loadDash; window.toggleStatus = toggleStatus;
    window.initTemplateUI = initTemplateUI; window.preview = preview;
  </script>
</body>
</html>`;

  html = html.replace('[META_TOKEN]', meta_token);
  html = html.replace('[OPENAI_KEY]', openai_key);
  html = html.replace('[AD_ACC_ID]', ad_acc_id);
  html = html.replace('[WHATSAPP_1]', whatsapp_1);
  html = html.replace('[WHATSAPP_2]', whatsapp_2);
  html = html.replace('[WHATSAPP_3]', whatsapp_3);
  html = html.replace('[WHATSAPP_4]', whatsapp_4);
  html = html.replace('[WHATSAPP_5]', whatsapp_5);
  html = html.replace('<script>', `<script id="initial-data" type="application/json">${JSON.stringify(initialData || {})}</script>\n<script>`);

  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

// --- EXPORT FINAL ---

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const corsHeaders = {
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept",
      "Access-Control-Max-Age": "86400",
    };

    if (origin) {
      corsHeaders["Access-Control-Allow-Origin"] = origin;
      corsHeaders["Access-Control-Allow-Credentials"] = "true";
    } else {
      corsHeaders["Access-Control-Allow-Origin"] = "*";
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      let response;

      if (request.method === "GET") {
        response = generateHTML(env);
      }
      else if (request.method === "POST") {
        let b = {};
        try {
          const text = await request.text();
          if (text && text.trim()) {
            b = JSON.parse(text);
          }
        } catch (e) {
          b = {};
        }

        const path = url.pathname.replace(/\/$/, "");
        if (path === "/" || path === "" || path === "/api/facebook/launch") {
          response = generateHTML(env, b);
        } else {
          if (path === "/api/get-accounts") response = await handleGetAccounts(b, env, request.headers);
          else if (path === "/api/search") response = await handleMetaSearch(b, env, request.headers);
          else if (path === "/api/openai-generate") response = await handleOpenAIGenerate(b, env, request.headers);
          else if (path === "/api/get-insights") response = await handleGetInsights(b, env, request.headers);
          else if (path === "/api/get-active-campaigns") response = await handleGetActiveCampaigns(b, env, request.headers);
          else if (path === "/api/get-adsets") response = await handleGetAdSets(b, env, request.headers);
          else if (path === "/api/get-ads") response = await handleGetAds(b, env, request.headers);
          else if (path === "/api/debug-post") response = await handleDebugPost(b, env, request.headers);
          else if (path === "/api/get-custom-audiences") response = await handleGetCustomAudiences(b, env, request.headers);
          else if (path === "/api/get-instagram-accounts") response = await handleGetInstagramAccounts(b, env, request.headers);
          else if (path === "/api/get-message-templates") response = await handleGetMessageTemplates(b, env, request.headers);
          else if (path === "/api/get-whatsapp-numbers") response = await handleGetWhatsAppNumbers(b, env, request.headers);
          else if (path === "/api/check-permissions") response = await handleCheckPermissions(b, env, request.headers);
          else if (path === "/api/debug-token") response = await handleGetTokenInfo(b, env, request.headers);
          else if (path === "/api/update-status") response = await handleUpdateStatus(b, env, request.headers);
          else if (path === "/api/get-full-report") response = await handleGetFullReport(b, env, request.headers);
          else if (path === "/api/debug-adset") response = await handleDebugAdSet(b, env, request.headers);
          else if (path === "/api/get-ad-details") {
            const token = getToken(env, b, request.headers);
            const r = await fetch(`https://graph.facebook.com/${API_VERSION}/${b.adId}?fields=name,status,creative{id,name,object_story_spec}&access_token=${token}`);
            const d = await safeJson(r);
            response = new Response(JSON.stringify({ data: d }), { headers: { "Content-Type": "application/json" } });
          }
          else if (path === "/api/resolve-regions") response = await handleResolveRegions(b, env, request.headers);
          else if (path === "/api/upload-media") response = await handleUploadMedia(b, env, request.headers);
          else if (path === "/api/create-advanced-ad") response = await handleCreateAdvancedAd(b, env, request.headers);
        }
      }

      if (!response) {
        response = new Response("Not Found", { status: 404 });
      }

      // Añadir CORS a los headers existentes de forma segura
      const finalResponse = new Response(response.body, response);
      Object.entries(corsHeaders).forEach(([k, v]) => finalResponse.headers.set(k, v));
      finalResponse.headers.set("Vary", "Origin");

      return finalResponse;

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
  }
};
