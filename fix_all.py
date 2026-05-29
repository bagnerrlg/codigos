import re

with open('report_generator.py', 'r') as f:
    content = f.read()

# 1. Aplicar mapeo de vendedor en fetch_for_account
content = content.replace(
    'vendedor_raw, gnam, opp_id_val = u_map.get(op.get("assignedTo"), ""),',
    'vendedor_raw, gnam, opp_id_val = get_mapped_vendedor(u_map.get(op.get("assignedTo"), "")),'
)

# 2. Reemplazar generate_dashboard_html con una versión aún más robusta
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

            # Limpiar nombres de columnas para JS
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
            "ventas": prepare_json(res_v),
            "contactos": prepare_json(res_c),
            "facebook": prepare_json(res_fb),
            "metas": prepare_json(df_metas)
        }

        html_template = """<!DOCTYPE html>
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
        .kpi-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
    </style>
</head>
<body class="bg-slate-50 p-4 font-sans text-slate-900">
    <div class="max-w-7xl mx-auto">
        <header class="flex justify-between items-center mb-8 border-b pb-6 border-slate-200">
            <div>
                <h1 class="text-3xl font-black text-slate-800 tracking-tighter">📊 DUPAZA DASHBOARD</h1>
                <p class="text-slate-500 text-xs mt-1 font-medium">SISTEMA UNIFICADO DE RENDIMIENTO</p>
            </div>
            <div class="text-right">
                <div id="status-msg" class="text-xs text-blue-600 font-bold mb-1"></div>
                <div class="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Actualizado: TIMESTAMP_HERE</div>
            </div>
        </header>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8 bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <div>
                <label class="block text-[10px] font-black text-slate-400 uppercase mb-2">Gerente</label>
                <select id="filter-gerente" class="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-green-500 transition-all cursor-pointer">
                    <option value="ALL">TODOS LOS GERENTES</option>
                </select>
            </div>
            <div>
                <label class="block text-[10px] font-black text-slate-400 uppercase mb-2">Marca</label>
                <select id="filter-marca" class="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-green-500 transition-all cursor-pointer">
                    <option value="ALL">TODAS LAS MARCAS</option>
                </select>
            </div>
            <div>
                <label class="block text-[10px] font-black text-slate-400 uppercase mb-2">Mes</label>
                <select id="filter-mes" class="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-green-500 transition-all cursor-pointer">
                    <option value="ALL">TODOS LOS MESES</option>
                </select>
            </div>
             <div>
                <label class="block text-[10px] font-black text-slate-400 uppercase mb-2">Vendedor</label>
                <select id="filter-vendedor" class="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-green-500 transition-all cursor-pointer">
                    <option value="ALL">TODOS LOS ASESORES</option>
                </select>
            </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-5 gap-5 mb-8">
            <div class="card text-center"><div class="kpi-label">Inversión</div><div id="kpi-gasto" class="kpi-val">Q 0</div></div>
            <div class="card text-center"><div class="kpi-label">Leads</div><div id="kpi-leads" class="kpi-val">0</div></div>
            <div class="card text-center"><div class="kpi-label">Ventas</div><div id="kpi-venta" class="kpi-val">Q 0</div></div>
            <div class="card text-center"><div class="kpi-label">ROAS</div><div id="kpi-roas" class="kpi-val text-blue-600">0.0</div></div>
            <div class="card text-center"><div class="kpi-label">% Meta</div><div id="kpi-cumplimiento" class="kpi-val text-blue-600">0%</div></div>
            <div class="card text-center"><div class="kpi-label">CPL</div><div id="kpi-cpl" class="kpi-val">Q 0</div></div>
            <div class="card text-center"><div class="kpi-label">CPV</div><div id="kpi-cpa" class="kpi-val">Q 0</div></div>
            <div class="card text-center"><div class="kpi-label">% Conv.</div><div id="kpi-conversion" class="kpi-val">0%</div></div>
            <div class="card text-center"><div class="kpi-label">Asesores</div><div id="kpi-asesores" class="kpi-val">0</div></div>
            <div class="card text-center"><div class="kpi-label">Venta/Día</div><div id="kpi-prom-vt" class="kpi-val">Q 0</div></div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div class="card text-center bg-blue-50/50 border border-blue-100"><div class="kpi-label text-blue-600">Venta Digital</div><div id="kpi-venta-digital" class="kpi-val text-blue-700">Q 0</div></div>
            <div class="card text-center"><div class="kpi-label text-slate-400">Venta No Digital</div><div id="kpi-venta-nodigital" class="kpi-val text-slate-500">Q 0</div></div>
            <div class="card text-center bg-green-50/50 border border-green-100"><div class="kpi-label text-green-600">% Inversión/VT</div><div id="kpi-gto-vt" class="kpi-val text-green-700">0%</div></div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <div class="card h-[480px] flex flex-col"><h3 class="text-sm font-black mb-6 text-slate-400 uppercase tracking-widest border-b pb-2">Rendimiento Temporal</h3><div id="chart-leads-dia" class="flex-grow"></div></div>
            <div class="card h-[480px] flex flex-col"><h3 class="text-sm font-black mb-6 text-slate-400 uppercase tracking-widest border-b pb-2">Proyección de Metas</h3><div id="chart-ventas-meta" class="flex-grow"></div></div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
             <div class="card h-[480px] flex flex-col"><h3 class="text-sm font-black mb-6 text-slate-400 uppercase tracking-widest border-b pb-2">Distribución por Marca</h3><div id="chart-marcas-pie" class="flex-grow"></div></div>
            <div class="card h-[480px] flex flex-col"><h3 class="text-sm font-black mb-6 text-slate-400 uppercase tracking-widest border-b pb-2">Ranking de Ventas</h3><div id="chart-vendedores" class="flex-grow"></div></div>
        </div>

        <div class="bg-slate-900 p-6 rounded-3xl shadow-2xl border border-slate-800 mb-10">
            <h3 class="text-[10px] font-black text-slate-500 mb-4 tracking-[0.2em] uppercase">Métricas de Carga de Datos</h3>
            <div id="debug-panel" class="grid grid-cols-2 md:grid-cols-5 gap-4 text-[10px] font-mono"></div>
        </div>
    </div>

    <script>
        let rawData = null;
        try {
            rawData = JSON_DATA_HERE;
            const dp = document.getElementById("debug-panel");
            const metrics = [
                ["OPPORTUNITIES", rawData.oportunidades.length, "#4ade80"],
                ["ADS_SPEND", rawData.facebook.length, "#60a5fa"],
                ["GOALS", rawData.metas.length, "#c084fc"],
                ["UNNESTED_SALES", rawData.ventas.length, "#fbbf24"],
                ["CONTACTS", rawData.contactos.length, "#2dd4bf"]
            ];
            metrics.forEach(([l, c, col]) => {
                const d = document.createElement("div");
                d.className = "bg-slate-950 p-3 rounded-xl border border-slate-800";
                d.innerHTML = `<span style='color: ${col}' class='block font-bold'>${l}</span><span class='text-lg font-black text-white'>${c}</span>`;
                dp.appendChild(d);
            });
        } catch (e) {
            console.error("Critical JSON Error:", e);
            document.body.innerHTML = "<div class='p-20 text-red-500 font-black text-center text-2xl bg-white shadow-2xl rounded-3xl m-10'>ERROR: NO SE PUDO CARGAR EL JSON</div>";
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

            pop("filter-gerente", gers);
            pop("filter-marca", marcs);
            pop("filter-vendedor", vends);
            pop("filter-mes", meses);

            document.querySelectorAll("select").forEach(s => s.onchange = update);
            update();
        }

        function update() {
            if (!rawData) return;
            const g = document.getElementById("filter-gerente").value.toUpperCase();
            const m = document.getElementById("filter-marca").value.toUpperCase();
            const v = document.getElementById("filter-vendedor").value;
            const mes = document.getElementById("filter-mes").value;

            const seqMap = ms = (rawData.metas || []).reduce((acc, c) => {
                const s = (c.SUB_ANILLO || c.SUB_ANILLO_ || "").toString().toUpperCase().trim();
                if (!s) return acc;
                if (!acc[s]) acc[s] = { gers: new Set(), marcas: new Set() };
                if (c.GERENTE) acc[s].gers.add(c.GERENTE.toString().toUpperCase().trim());
                if (c.MARCA) acc[s].marcas.add(c.MARCA.toString().toUpperCase().trim());
                return acc;
            }, {});

            const f_o = rawData.oportunidades.filter(o => {
                const s = (o.secuencia || "").toString().toUpperCase().trim();
                const mG = (g === "ALL" || (seqMap[s] && seqMap[s].gers.has(g)));
                const mM = (m === "ALL" || (o.MARCA || "").toUpperCase() === m || (seqMap[s] && seqMap[s].marcas.has(m)));
                const mV = (v === "ALL" || o.asignado === v);
                const mMes = (mes === "ALL" || (o.Mes || o.MES) == mes);
                return mG && mM && mV && mMes;
            });

            const f_fb = rawData.facebook.filter(f => {
                const s = (f.SECUENCIA || "").toString().toUpperCase().trim();
                const mG = (g === "ALL" || (seqMap[s] && seqMap[s].gers.has(g)));
                const mM = (m === "ALL" || (seqMap[s] && seqMap[s].marcas.has(m)));
                const d = f.Dia || f["Día"] || "";
                const mMes = (mes === "ALL" || (d && parseInt(d.split("-")[1]) == mes));
                return mG && mM && mMes;
            });

            const f_metas = rawData.metas.filter(met =>
                (g === "ALL" || (met.GERENTE || "").toUpperCase() === g) &&
                (m === "ALL" || (met.MARCA || "").toUpperCase() === m) &&
                (mes === "ALL" || (met.MES || met.Mes) == mes)
            );

            const totGto = f_fb.reduce((a, c) => a + Number(c.Importe_gastado || 0), 0);
            const totLeads = f_fb.reduce((a, c) => a + Number(c.Contactos_mensajes_nuevos || 0), 0);
            const totVta = f_o.reduce((a, c) => a + Number(c.Valor_del_cliente_potencial || 0), 0);
            const totMeta = f_metas.reduce((a, c) => a + Number(c.META || 0), 0);

            document.getElementById("kpi-gasto").innerText = "Q " + totGto.toLocaleString(undefined, {maximumFractionDigits: 0});
            document.getElementById("kpi-leads").innerText = totLeads.toLocaleString();
            document.getElementById("kpi-venta").innerText = "Q " + totVta.toLocaleString(undefined, {maximumFractionDigits: 0});
            document.getElementById("kpi-roas").innerText = totGto > 0 ? (totVta / totGto).toFixed(1) : "0.0";
            document.getElementById("kpi-cumplimiento").innerText = totMeta > 0 ? ((totVta / totMeta) * 100).toFixed(0) + "%" : "0%";
            document.getElementById("kpi-cpl").innerText = "Q " + (totLeads > 0 ? (totGto / totLeads).toFixed(2) : "0.00");
            document.getElementById("kpi-cpa").innerText = "Q " + (f_o.length > 0 ? (totGto / f_o.length).toFixed(0) : "0");
            document.getElementById("kpi-conversion").innerText = totLeads > 0 ? ((f_o.length / totLeads) * 100).toFixed(1) + "%" : "0%";
            document.getElementById("kpi-asesores").innerText = new Set(f_o.map(o => o.asignado)).size;

            const days = new Set(f_fb.map(f => f.Dia || f["Día"])).size || 1;
            document.getElementById("kpi-prom-vt").innerText = "Q " + (totVta / days).toLocaleString(undefined, {maximumFractionDigits: 0});

            const vDig = f_o.filter(o => {
                const s = (o.secuencia || "").toString().toUpperCase();
                return s.startsWith("A") || s.startsWith("R") || (seqMap[s] && Array.from(seqMap[s].gers).some(gr => gr === "DIEGO SANTA CRUZ" || gr === "NOHEMI MACHA"));
            }).reduce((a, c) => a + Number(c.Valor_del_cliente_potencial || 0), 0);

            document.getElementById("kpi-venta-digital").innerText = "Q " + vDig.toLocaleString(undefined, {maximumFractionDigits: 0});
            document.getElementById("kpi-venta-nodigital").innerText = "Q " + (totVta - vDig).toLocaleString(undefined, {maximumFractionDigits: 0});
            document.getElementById("kpi-gto-vt").innerText = totVta > 0 ? ((totGto / totVta) * 100).toFixed(1) + "%" : "0%";

            render(f_o, f_fb, totVta, totMeta, seqMap);
        }

        function render(f_o, f_fb, tv, tm, seqMap) {
            Plotly.newPlot("chart-ventas-meta", [{
                x: ["Real", "Meta"], y: [tv, tm], type: "bar", marker: {color: ["#76933C", "#e2e8f0"]},
                text: [tv.toLocaleString(), tm.toLocaleString()], textposition: "auto"
            }], {margin: {t: 20, b: 40, l: 60, r: 20}, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)"});

            const lbd = f_fb.reduce((acc, c) => { const d = c.Dia || c["Día"]; acc[d] = (acc[d] || 0) + Number(c.Contactos_mensajes_nuevos || 0); return acc; }, {});
            const dx = Object.keys(lbd).sort();
            Plotly.newPlot("chart-leads-dia", [{
                x: dx, y: dx.map(k => lbd[k]), type: "scatter", mode: "lines+markers", line: {color: "#1890ff", width: 4, shape: "spline"}, fill: "tozeroy"
            }], {margin: {t: 20, b: 40, l: 40, r: 20}, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)"});

            const mPie = f_o.reduce((acc, c) => {
                let n = (c.MARCA || "").toString().trim();
                if (!n && seqMap[c.secuencia.toUpperCase()]) n = Array.from(seqMap[c.secuencia.toUpperCase()].marcas)[0];
                if (n) acc[n] = (acc[n] || 0) + Number(c.Valor_del_cliente_potencial || 0);
                return acc;
            }, {});
            Plotly.newPlot("chart-marcas-pie", [{
                labels: Object.keys(mPie), values: Object.values(mPie), type: "pie", hole: .6,
                marker: {colors: ["#76933C", "#1890ff", "#722ed1", "#fa8c16", "#eb2f96", "#faad14"]}
            }], {margin: {t: 10, b: 10, l: 10, r: 10}, paper_bgcolor: "rgba(0,0,0,0)"});

            const vMap = f_o.reduce((acc, c) => { acc[c.asignado] = (acc[c.asignado] || 0) + Number(c.Valor_del_cliente_potencial || 0); return acc; }, {});
            const vS = Object.entries(vMap).sort((a,b) => a[1] - b[1]);
            Plotly.newPlot("chart-vendedores", [{
                y: vS.map(x => x[0]), x: vS.map(x => x[1]), type: "bar", orientation: "h", marker: {color: "#76933C"}
            }], {margin: {t: 20, b: 40, l: 140, r: 20}, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)"});
        }
        init();
    </script>
</body>
</html>"""

        html_final = html_template.replace("JSON_DATA_HERE", json.dumps(data_json))
        html_final = html_final.replace("TIMESTAMP_HERE", datetime.now().strftime("%d/%m/%Y %H:%M"))

        fn = f"dashboard_Dupaza_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html"
        with open(fn, "w", encoding="utf-8") as f: f.write(html_final)
        with open("index.html", "w", encoding="utf-8") as f: f.write(html_final)
        self.log(f"Dashboard unificado generado: {fn}")
'''

lines = content.split('\n')
start, end = -1, -1
for i, line in enumerate(lines):
    if 'def generate_dashboard_html' in line: start = i
    if 'def process_contact_costs' in line: end = i; break

if start != -1 and end != -1:
    with open('report_generator.py', 'w') as f:
        f.write('\n'.join(lines[:start]) + new_function + '\n' + '\n'.join(lines[end:]))
    print("Success: Final Dashboard overhaul applied.")
else:
    print("Error: Could not find function boundaries.")
