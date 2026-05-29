import json
import re
import os

with open('report_generator.py', 'r') as f:
    content = f.read()

# 1. Asegurar que get_mapped_vendedor se use en todas partes
content = content.replace(
    'vendedor_raw, gnam, opp_id_val = u_map.get(op.get("assignedTo"), ""),',
    'vendedor_raw, gnam, opp_id_val = get_mapped_vendedor(u_map.get(op.get("assignedTo"), "")),'
)

# 2. Nueva función generate_dashboard_html usando la técnica de script JSON (la más robusta)
new_function = r'''
    def generate_dashboard_html(self, res_o, res_v, res_c, res_fb, df_metas):
        self.log("Generando Dashboard HTML...")
        import json

        def prepare_json(df_in):
            if df_in is None: return []
            if isinstance(df_in, list):
                if not df_in: return []
                df_in = pd.DataFrame(df_in)
            if df_in.empty: return []

            d = df_in.copy()
            d = d.loc[:, ~d.columns.duplicated()]

            def clean_col(c):
                return str(c).replace(" ", "_").replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u").replace("ñ", "n").replace(".", "")

            d.columns = [clean_col(c) for c in d.columns]

            for col in d.columns:
                if pd.api.types.is_numeric_dtype(d[col]):
                    d[col] = pd.to_numeric(d[col], errors="coerce").fillna(0)
                elif pd.api.types.is_datetime64_any_dtype(d[col]):
                    d[col] = d[col].apply(lambda x: x.isoformat() if hasattr(x, "isoformat") else str(x))
                else:
                    d[col] = d[col].fillna("").astype(str)
            return d.to_dict(orient="records")

        data_json = {
            "oportunidades": prepare_json(res_o),
            "facebook": prepare_json(res_fb),
            "metas": prepare_json(df_metas)
        }

        html_base = """<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard DUPAZA PRO</title>
    <script src="https://cdn.plot.ly/plotly-2.32.0.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        .card { background: white; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); padding: 20px; }
        .kpi-val { font-size: 28px; font-weight: 800; color: #76933C; line-height: 1.2; }
        .kpi-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; }
    </style>
</head>
<body class="bg-slate-50 p-4 font-sans text-slate-900">
    <div class="max-w-7xl mx-auto">
        <header class="flex justify-between items-center mb-8 border-b pb-6 border-slate-200">
            <div><h1 class="text-3xl font-black text-slate-800">📊 DUPAZA DASHBOARD</h1></div>
            <div class="text-right">
                <div id="status-msg" class="text-xs text-blue-600 font-bold mb-1"></div>
                <div class="text-[10px] text-slate-400 font-bold uppercase">Actualizado: TIMESTAMP_HERE</div>
            </div>
        </header>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8 bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <div><label class="block text-[10px] font-black text-slate-400 mb-1">GERENTE</label><select id="f-ger" class="w-full border rounded-lg p-2 text-xs font-bold outline-none focus:ring-2 focus:ring-green-500"><option value="ALL">TODOS</option></select></div>
            <div><label class="block text-[10px] font-black text-slate-400 mb-1">MARCA</label><select id="f-mar" class="w-full border rounded-lg p-2 text-xs font-bold outline-none focus:ring-2 focus:ring-green-500"><option value="ALL">TODAS</option></select></div>
            <div><label class="block text-[10px] font-black text-slate-400 mb-1">MES</label><select id="f-mes" class="w-full border rounded-lg p-2 text-xs font-bold outline-none focus:ring-2 focus:ring-green-500"><option value="ALL">TODOS</option></select></div>
            <div><label class="block text-[10px] font-black text-slate-400 mb-1">ASESOR</label><select id="f-ven" class="w-full border rounded-lg p-2 text-xs font-bold outline-none focus:ring-2 focus:ring-green-500"><option value="ALL">TODOS</option></select></div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-5 gap-5 mb-8">
            <div class="card text-center"><div class="kpi-label">Inversión</div><div id="kpi-gasto" class="kpi-val">Q 0</div></div>
            <div class="card text-center"><div class="kpi-label">Leads</div><div id="kpi-leads" class="kpi-val">0</div></div>
            <div class="card text-center"><div class="kpi-label">Ventas</div><div id="kpi-venta" class="kpi-val">Q 0</div></div>
            <div class="card text-center"><div class="kpi-label">ROAS</div><div id="kpi-roas" class="kpi-val text-blue-600">0.0</div></div>
            <div class="card text-center"><div class="kpi-label">% Meta</div><div id="kpi-meta" class="kpi-val text-blue-600">0%</div></div>
            <div class="card text-center"><div class="kpi-label">CPL</div><div id="kpi-cpl" class="kpi-val">Q 0</div></div>
            <div class="card text-center"><div class="kpi-label">CPV</div><div id="kpi-cpa" class="kpi-val">Q 0</div></div>
            <div class="card text-center"><div class="kpi-label">% Conv.</div><div id="kpi-conv" class="kpi-val">0%</div></div>
            <div class="card text-center"><div class="kpi-label">Asesores</div><div id="kpi-asesores" class="kpi-val">0</div></div>
            <div class="card text-center"><div class="kpi-label">Venta/Día</div><div id="kpi-vday" class="kpi-val">Q 0</div></div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <div class="card"><h3 class="text-sm font-black mb-6 text-slate-400 uppercase tracking-widest">Leads Diarios</h3><div id="ch-leads" style="height: 350px;"></div></div>
            <div class="card"><h3 class="text-sm font-black mb-6 text-slate-400 uppercase tracking-widest">Ventas vs Meta</h3><div id="ch-meta" style="height: 350px;"></div></div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <div class="card"><h3 class="text-sm font-black mb-6 text-slate-400 uppercase tracking-widest">Ventas por Marca</h3><div id="ch-marca" style="height: 350px;"></div></div>
            <div class="card"><h3 class="text-sm font-black mb-6 text-slate-400 uppercase tracking-widest">Ventas por Asesor</h3><div id="ch-asesor" style="height: 350px;"></div></div>
        </div>
    </div>

    <script id="data-block" type="application/json">JSON_DATA_HERE</script>
    <script>
        let rawData = null;
        try {
            rawData = JSON.parse(document.getElementById('data-block').textContent);
            console.log("Data Loaded:", rawData);
        } catch (e) {
            console.error("JSON Parse Error:", e);
            document.body.innerHTML = "<div class='p-20 text-center font-bold text-red-500'>ERROR CRÍTICO: LOS DATOS NO SE PUDIERON LEER.</div>";
        }

        function init() {
            if (!rawData) return;
            const ms = rawData.metas || [];
            const os = rawData.oportunidades || [];

            const gers = [...new Set(ms.map(x => x.GERENTE))].filter(Boolean).sort();
            const marcs = [...new Set(ms.map(x => x.MARCA))].filter(Boolean).sort();
            const vends = [...new Set(os.map(x => x.asignado))].filter(Boolean).sort();
            const meses = [...new Set(os.map(x => x.Mes || x.MES))].filter(Boolean).sort((a,b) => a-b);

            const pop = (id, list) => {
                const el = document.getElementById(id);
                list.forEach(i => { const o = document.createElement("option"); o.value = i; o.textContent = i; el.appendChild(o); });
            };

            pop("f-ger", gers); pop("f-mar", marcs); pop("f-ven", vends); pop("f-mes", meses);

            document.querySelectorAll("select").forEach(s => s.onchange = update);
            update();
        }

        function update() {
            if (!rawData) return;
            const g = document.getElementById("f-ger").value.toUpperCase();
            const m = document.getElementById("f-mar").value.toUpperCase();
            const v = document.getElementById("f-ven").value;
            const mes = document.getElementById("f-mes").value;

            const seqMap = (rawData.metas || []).reduce((acc, c) => {
                const s = (c.SUB_ANILLO || c.SUB_ANILLO_ || "").toString().toUpperCase().trim();
                if (!s) return acc;
                if (!acc[s]) acc[s] = { gers: new Set(), marcs: new Set() };
                if (c.GERENTE) acc[s].gers.add(c.GERENTE.toString().toUpperCase().trim());
                if (c.MARCA) acc[s].marcs.add(c.MARCA.toString().toUpperCase().trim());
                return acc;
            }, {});

            const f_o = rawData.oportunidades.filter(o => {
                const s = (o.secuencia || "").toString().toUpperCase().trim();
                const mG = (g === "ALL" || (seqMap[s] && seqMap[s].gers.has(g)));
                const mM = (m === "ALL" || (o.MARCA || "").toUpperCase() === m || (seqMap[s] && seqMap[s].marcs.has(m)));
                const mV = (v === "ALL" || o.asignado === v);
                const mMes = (mes === "ALL" || (o.Mes || o.MES) == mes);
                return mG && mM && mV && mMes;
            });

            const f_fb = (rawData.facebook || []).filter(f => {
                const s = (f.SECUENCIA || "").toString().toUpperCase().trim();
                const mG = (g === "ALL" || (seqMap[s] && seqMap[s].gers.has(g)));
                const mM = (m === "ALL" || (seqMap[s] && seqMap[s].marcs.has(m)));
                const d = f.Dia || f["Día"] || "";
                const mMes = (mes === "ALL" || (d && parseInt(d.split("-")[1]) == mes));
                return mG && mM && mMes;
            });

            const f_ms = (rawData.metas || []).filter(mt =>
                (g === "ALL" || (mt.GERENTE || "").toUpperCase() === g) &&
                (m === "ALL" || (mt.MARCA || "").toUpperCase() === m) &&
                (mes === "ALL" || (mt.MES || mt.Mes) == mes)
            );

            const tGto = f_fb.reduce((a, c) => a + Number(c.Importe_gastado || 0), 0);
            const tLds = f_fb.reduce((a, c) => a + Number(c.Contactos_mensajes_nuevos || 0), 0);
            const tVta = f_o.reduce((a, c) => a + Number(c.Valor_del_cliente_potencial || 0), 0);
            const tMet = f_ms.reduce((a, c) => a + Number(c.META || 0), 0);

            document.getElementById("kpi-gasto").innerText = "Q " + tGto.toLocaleString(undefined, {maximumFractionDigits: 0});
            document.getElementById("kpi-leads").innerText = tLds.toLocaleString();
            document.getElementById("kpi-venta").innerText = "Q " + tVta.toLocaleString(undefined, {maximumFractionDigits: 0});
            document.getElementById("kpi-roas").innerText = tGto > 0 ? (tVta / tGto).toFixed(1) : "0.0";
            document.getElementById("kpi-meta").innerText = tMet > 0 ? ((tVta / tMet) * 100).toFixed(0) + "%" : "0%";
            document.getElementById("kpi-cpl").innerText = "Q " + (tLds > 0 ? (tGto / tLds).toFixed(2) : "0.00");
            document.getElementById("kpi-cpa").innerText = "Q " + (f_o.length > 0 ? (tGto / f_o.length).toFixed(0) : "0");
            document.getElementById("kpi-conv").innerText = tLds > 0 ? ((f_o.length / tLds) * 100).toFixed(1) + "%" : "0%";
            document.getElementById("kpi-asesores").innerText = new Set(f_o.map(o => o.asignado)).size;

            const days = new Set(f_fb.map(f => f.Dia || f["Día"])).size || 1;
            document.getElementById("kpi-vday").innerText = "Q " + (tVta / days).toLocaleString(undefined, {maximumFractionDigits: 0});

            render(f_o, f_fb, tVta, tMet, seqMap);
        }

        function render(f_o, f_fb, tv, tm, seqMap) {
            Plotly.newPlot("ch-meta", [{
                x: ["REAL", "META"], y: [tv, tm], type: "bar", marker: {color: ["#76933C", "#e2e8f0"]},
                text: [tv.toLocaleString(), tm.toLocaleString()], textposition: "auto"
            }], {margin: {t: 20, b: 40, l: 60, r: 20}, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)"});

            const lbd = f_fb.reduce((acc, c) => { const d = c.Dia || c["Día"]; acc[d] = (acc[d] || 0) + Number(c.Contactos_mensajes_nuevos || 0); return acc; }, {});
            const dx = Object.keys(lbd).sort();
            Plotly.newPlot("ch-leads", [{
                x: dx, y: dx.map(k => lbd[k]), type: "scatter", mode: "lines+markers", line: {color: "#1890ff", width: 3}, fill: "tozeroy"
            }], {margin: {t: 20, b: 40, l: 40, r: 20}, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)"});

            const mPie = f_o.reduce((acc, c) => {
                let n = (c.MARCA || "").toString().trim();
                if (!n && seqMap[c.secuencia.toUpperCase()]) n = Array.from(seqMap[c.secuencia.toUpperCase()].marcs)[0];
                if (n) acc[n] = (acc[n] || 0) + Number(c.Valor_del_cliente_potencial || 0);
                return acc;
            }, {});
            Plotly.newPlot("ch-marca", [{
                labels: Object.keys(mPie), values: Object.values(mPie), type: "pie", hole: .6,
                marker: {colors: ["#76933C", "#1890ff", "#722ed1", "#fa8c16", "#eb2f96"]}
            }], {margin: {t: 10, b: 10, l: 10, r: 10}, paper_bgcolor: "rgba(0,0,0,0)"});

            const vMap = f_o.reduce((acc, c) => { acc[c.asignado] = (acc[c.asignado] || 0) + Number(c.Valor_del_cliente_potencial || 0); return acc; }, {});
            const vS = Object.entries(vMap).sort((a,b) => a[1] - b[1]);
            Plotly.newPlot("ch-asesor", [{
                y: vS.map(x => x[0]), x: vS.map(x => x[1]), type: "bar", orientation: "h", marker: {color: "#76933C"}
            }], {margin: {t: 20, b: 40, l: 140, r: 20}, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)"});
        }
        init();
    </script>
</body>
</html>"""

        # Reemplazos limpios y seguros
        html_final = html_base.replace("JSON_DATA_HERE", json.dumps(data_json))
        html_final = html_final.replace("TIMESTAMP_HERE", datetime.now().strftime("%d/%m/%Y %H:%M"))

        fn = f"dashboard_Dupaza_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html"
        with open(fn, "w", encoding="utf-8") as f: f.write(html_final)
        with open("index.html", "w", encoding="utf-8") as f: f.write(html_final)
        self.log(f"Dashboard final generado: {fn}")
'''

lines = content.split('\n')
start, end = -1, -1
for i, line in enumerate(lines):
    if 'def generate_dashboard_html' in line: start = i
    if 'def process_contact_costs' in line: end = i; break

if start != -1 and end != -1:
    with open('report_generator.py', 'w') as f:
        f.write('\n'.join(lines[:start]) + new_function + '\n' + '\n'.join(lines[end:]))
    print("Dashboard rewritten with application/json script block.")
else:
    print("Error locating boundaries.")
