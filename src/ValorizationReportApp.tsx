import React, { useMemo, useRef, useState } from "react";
import { PieChart, Pie, Tooltip, ResponsiveContainer, Cell } from "recharts";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";

/**
 * VERSÃO PREMIUM (foco PDF alto padrão)
 * - Logos fixas (sem upload), sem distorção.
 * - Tipografia Inter com hierarquia forte, muito respiro e alinhamentos precisos.
 * - Informações do cabeçalho em grade 2x2 (como o PDF referência), com títulos pequenos em caps.
 * - Cards robustos, gráfico donut elegante (azul Bicalho + laranja Diferencial), centro destacado.
 * - Tabela de RELATÓRIO (somente leitura) separada do EDITOR (inputs). Editor some no PDF.
 * - Exportação PDF A4 retrato, alta nitidez (scale 2.5) e sem tooltips.
 * - Mantidos os testes: “Adicionar 4 unidades de exemplo” e “Adicionar casos (edge)”.
 */

// ===== Marca e assets fixos =====
const BRAND_ORANGE = "#FF6A00"; // Diferencial
const BRAND_BLUE = "#2F7DC0"; // Bicalho
const INK = "#0F172A"; // Navy escuro
const MUTED = "#6B7280";

function BrandLogo({ kind, alt }) {
  // Caminhos estáveis (sem new URL / import)
  const [idx, setIdx] = React.useState(0);
  const [failed, setFailed] = React.useState(false);
  const file = kind === "dif" ? "diferencial.png" : "bicalho.png";
  const origin = (typeof window !== "undefined" && window.location && window.location.origin) || "";
  const srcs = [
    `/logos/${file}`,
    origin ? `${origin}/logos/${file}` : null,
  ].filter(Boolean);
  const src = srcs[idx];

  if (failed || !src) {
    return (
      <div style={{height:48,minWidth:120,display:"flex",alignItems:"center",justifyContent:"center",border:"1px dashed #E5E7EB",borderRadius:8,color:MUTED,fontSize:12}}>
        {alt}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="logoImg"
      onError={() => { if (idx + 1 < srcs.length) setIdx(idx + 1); else setFailed(true); }}
    />
  );
}

// ===== Helpers =====
const currencyBR = (n) => (isFinite(n) ? n : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent2 = (n) => { if (!isFinite(n)) return "–"; const str = (Math.round(n * 100) / 100).toFixed(2).replace(".", ","); return `${str}%`; };
const formatDateBR = (d) => { try { return new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }); } catch { return ""; } };
const ymd = (date) => { const pad = (x) => String(x).padStart(2, "0"); const d = new Date(date); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const todayYMD = () => ymd(new Date());
const toDecimal = (val) => { if (val === null || val === undefined) return NaN; const s = String(val).replace(/[^0-9,.-]/g, ""); if (s.includes(",") && s.includes(".")) { const lastComma = s.lastIndexOf(","); const lastDot = s.lastIndexOf("."); if (lastComma > lastDot) return parseFloat(s.replaceAll(".", "").replace(",", ".")); return parseFloat(s.replaceAll(",", "")); } return parseFloat(s.replace(",", ".")); };

// ===== Row model =====
const emptyRow = (id) => ({ id, empreendimento: "", unidade: "", valorAquisicao: "", dataAquisicao: "", valorAtual: "" });

// Opções fixas de empreendimentos (ordem solicitada)
const EMP_OPTIONS = [
  "Start Residence",
  "Diamond Tower",
  "Benoît Batel",
  "Hol 1480",
  "Yacht Tower",
  "Legacy Tower",
  "Infinity Tower",
  "Vértice Barigui",
];

// Sigla das unidades no cabeçalho (Hol 1480 => "Hol")
function acronymFromEmp(empreendimento) {
  if (!empreendimento) return "";
  const emp = empreendimento.trim();
  if (emp.toLowerCase() === "hol 1480") return "Hol";
  const parts = emp.split(' ').filter(Boolean);
  return parts.map((w) => (w[0] ? w[0].toUpperCase() : '')).join('');
}

export default function ValorizationReportApp() {
  const [cliente, setCliente] = useState("");
  const [reportDate, setReportDate] = useState(todayYMD());
  const [rows, setRows] = useState([emptyRow(1)]);
  const [isExporting, setIsExporting] = useState(false);
  const [showEditor, setShowEditor] = useState(true);

  const nextIdRef = useRef(2);
  const reportRef = useRef(null);

  // ===== Handlers =====
  const addRow = () => setRows((r) => [...r, emptyRow(nextIdRef.current++)]);
  const removeRow = (id) => setRows((r) => (r.length === 1 ? r : r.filter((x) => x.id !== id)));
  const clearAll = () => { setRows([emptyRow(1)]); nextIdRef.current = 2; };
  const handleRowChange = (id, field, value) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

  const addSamples = () => {
    const samples = [
      { empreendimento: "Vértice Barigui", unidade: "1205", valorAquisicao: "170000", dataAquisicao: "2024-06-15", valorAtual: "210000" },
      { empreendimento: "Legacy Tower", unidade: "803", valorAquisicao: "220000", dataAquisicao: "2023-11-01", valorAtual: "260000" },
      { empreendimento: "Yacht Tower", unidade: "1907", valorAquisicao: "150000", dataAquisicao: "2024-12-10", valorAtual: "165000" },
      { empreendimento: "Infinity Tower", unidade: "305", valorAquisicao: "300000", dataAquisicao: "2025-03-01", valorAtual: "315000" },
    ];
    setRows(samples.map((s, idx) => ({ id: idx + 1, ...s })));
    nextIdRef.current = samples.length + 1;
  };

  const addEdgeCases = () => {
    const repDate = reportDate;
    const extras = [
      { empreendimento: "Teste Aquisição Zero", unidade: "AZ-01", valorAquisicao: "0", dataAquisicao: repDate, valorAtual: "1000" },
      { empreendimento: "Teste Data Futura", unidade: "DF-01", valorAquisicao: "1000", dataAquisicao: ymd(new Date(new Date(repDate).getTime() + 5*24*3600*1000)), valorAtual: "1200" },
      { empreendimento: "Teste Desvalorização", unidade: "DV-01", valorAquisicao: "200000", dataAquisicao: "2024-01-10", valorAtual: "180000" },
      { empreendimento: "Teste Data Igual", unidade: "DI-01", valorAquisicao: "50000", dataAquisicao: repDate, valorAtual: "52000" },
      { empreendimento: "Teste Vírgula Decimal", unidade: "VD-01", valorAquisicao: "150.000,50", dataAquisicao: "2024-02-20", valorAtual: "160.100,75" },
      { empreendimento: "Teste Texto Inválido", unidade: "TX-01", valorAquisicao: "um valor", dataAquisicao: "2024-03-10", valorAtual: "200k" },
    ];
    setRows((prev) => {
      const base = prev.length === 1 && !prev[0].empreendimento && !prev[0].unidade ? [] : prev;
      const mapped = extras.map((s, i) => ({ id: nextIdRef.current + i, ...s }));
      nextIdRef.current += mapped.length;
      return [...base, ...mapped];
    });
  };

  // ===== Calculations =====
  const parsedRows = useMemo(() => {
    const repDate = new Date(reportDate);
    return rows.map((r) => {
      const errors = {};
      const hasAllRequired = r.empreendimento && r.unidade && r.valorAquisicao !== "" && r.dataAquisicao && r.valorAtual !== "";
      const va = toDecimal(r.valorAquisicao);
      const vc = toDecimal(r.valorAtual);
      const dAq = r.dataAquisicao ? new Date(r.dataAquisicao) : null;

      if (!r.empreendimento) errors.empreendimento = "Obrigatório";
      if (!r.unidade) errors.unidade = "Obrigatório";
      if (r.valorAquisicao === "") errors.valorAquisicao = "Obrigatório";
      if (r.valorAtual === "") errors.valorAtual = "Obrigatório";
      if (!r.dataAquisicao) errors.dataAquisicao = "Obrigatório";

      if (hasAllRequired) {
        if (!isFinite(va) || va < 0) errors.valorAquisicao = "Valor inválido";
        if (!isFinite(vc) || vc < 0) errors.valorAtual = "Valor inválido";
      }

      let ignore = false;
      if (hasAllRequired) {
        if (va === 0) { errors.valorAquisicao = "Informe o valor de aquisição (>0)"; ignore = true; }
        if (dAq && repDate && dAq > repDate) { errors.dataAquisicao = "Data > Relatório. Corrija."; ignore = true; }
      }

      let dias = 1;
      if (dAq && repDate && dAq <= repDate) dias = Math.max(1, Math.floor((repDate - dAq) / (1000*60*60*24)));

      const valorizacaoPct = va > 0 && isFinite(vc/va) ? (vc/va - 1) * 100 : NaN;
      const lucroMes = isFinite(vc - va) ? (vc - va) / (dias/30) : NaN;
      const lucroPctMes = va > 0 && isFinite(lucroMes/va) ? (lucroMes/va) * 100 : NaN;
      const validForTotals = hasAllRequired && !ignore && isFinite(va) && isFinite(vc) && va > 0;

      return { id: r.id, empreendimento: r.empreendimento, unidade: r.unidade, valorAquisicao: va, dataAquisicao: r.dataAquisicao, valorAtual: vc, dias, valorizacaoPct, lucroMes, lucroPctMes, validForTotals, errors };
    });
  }, [rows, reportDate]);

  const totals = useMemo(() => {
    const valid = parsedRows.filter((r) => r.validForTotals);
    const totalUnidades = valid.length;
    const listaUnidades = valid.map((r) => r.unidade).join(", ");
    const valorTotalContratos = valid.reduce((s, r) => s + r.valorAquisicao, 0);
    const valorAtualImoveis = valid.reduce((s, r) => s + r.valorAtual, 0);
    const lucroValorizacao = valorAtualImoveis - valorTotalContratos;
    const valorizacaoAtualPct = valorTotalContratos > 0 ? (valorAtualImoveis/valorTotalContratos - 1) * 100 : 0;
    const listaSiglas = valid.map((r) => `${acronymFromEmp(r.empreendimento)}${r.unidade}`).join(", ");
    return { totalUnidades, listaUnidades, listaSiglas, valorTotalContratos, valorAtualImoveis, lucroValorizacao, valorizacaoAtualPct };
  }, [parsedRows]);

  const pieData = useMemo(() => {
    const lucroPositivo = Math.max(0, totals.lucroValorizacao);
    return [
      { name: "Valor Total de Contratos (R$)", value: totals.valorTotalContratos },
      { name: "Lucro na Valorização (R$)", value: lucroPositivo },
    ];
  }, [totals]);

  // ===== Exports =====
  const exportCSV = () => {
    const header = ["Empreendimento","Unidade","Valor do imóvel na aquisição (R$)","Aquisição (Data de aquisição)","Valor atual (R$)","% de valorização","Lucro líquido ao mês (R$/mês)","% Lucro líquido"];
    const lines = parsedRows.map((r) => [r.empreendimento, r.unidade, currencyBR(r.valorAquisicao), r.dataAquisicao ? formatDateBR(r.dataAquisicao) : "", currencyBR(r.valorAtual), percent2(r.valorizacaoPct), currencyBR(r.lucroMes), percent2(r.lucroPctMes)]);
    const sep = ";";
    const csv = [header.join(sep), ...lines.map((l) => l.map((s) => `"${String(s).replaceAll('"','""')}"`).join(sep))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tabela_relatorio_valorizacao_${(cliente || "cliente").replaceAll(" ", "_")}_${reportDate}.csv`;
    a.click();
  };

  const exportXLSX = () => {
    const sheetData = parsedRows.map((r) => ({
      Empreendimento: r.empreendimento,
      Unidade: r.unidade,
      "Valor do imóvel na aquisição (R$)": currencyBR(r.valorAquisicao),
      "Aquisição (Data de aquisição)": r.dataAquisicao ? formatDateBR(r.dataAquisicao) : "",
      "Valor atual (R$)": currencyBR(r.valorAtual),
      "% de valorização": percent2(r.valorizacaoPct),
      "Lucro líquido ao mês (R$/mês)": currencyBR(r.lucroMes),
      "% Lucro líquido": percent2(r.lucroPctMes),
    }));
    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tabela");
    XLSX.writeFile(wb, `tabela_relatorio_valorizacao_${(cliente || "cliente").replaceAll(" ", "_")}_${reportDate}.xlsx`);
  };

  const exportPDF = async () => {
    try {
      setIsExporting(true); // esconde editor/tooltip
      const el = reportRef.current;
      if (!el) return;
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 300));
      const canvas = await html2canvas(el, { backgroundColor: "#FFFFFF", scale: window.devicePixelRatio > 1 ? 2.5 : 2, useCORS: true, allowTaint: true, logging: false, scrollX: -window.scrollX, scrollY: -window.scrollY, windowWidth: el.scrollWidth, windowHeight: el.scrollHeight });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
      const imgWidth = canvas.width * ratio, imgHeight = canvas.height * ratio;
      const x = (pageWidth - imgWidth) / 2, y = (pageHeight - imgHeight) / 2;
      pdf.addImage(imgData, "PNG", x, y, imgWidth, imgHeight, undefined, "FAST");
      pdf.save(`relatorio_valorizacao_${(cliente || "cliente").replaceAll(" ", "_")}_${reportDate}.pdf`);
    } catch (err) {
      console.error("PDF export error (primary)", err);
      try {
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
        await pdf.html(reportRef.current, { html2canvas: { backgroundColor: "#FFFFFF", scale: 2, useCORS: true, allowTaint: true }, callback: (doc) => doc.save(`relatorio_valorizacao_${(cliente || "cliente").replaceAll(" ", "_")}_${reportDate}.pdf`) });
      } catch (err2) {
        console.error("PDF export error (fallback)", err2);
        alert("Não foi possível gerar o PDF. Recarregue a página e tente novamente.");
      }
    } finally { setIsExporting(false); }
  };

  // ===== UI =====
  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
        :root { --accent1:${BRAND_ORANGE}; --accent2:${BRAND_BLUE}; --ink:${INK}; --muted:${MUTED}; }
        .app { min-height:100vh; width:100%; background:#FAFAFA; color:var(--ink); padding:24px; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans", "Helvetica Neue"; }
        .container { max-width: 820px; margin: 0 auto; }
        .grid { display:grid; gap:16px; }
        .grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .row { display:flex; gap:8px; align-items:center; }
        .mt-6 { margin-top:24px; }
        .mb-6 { margin-bottom:24px; }
        .ml-auto { margin-left:auto; }
        .muted { color:var(--muted); }
        .danger { color:#DC2626; }
        .title { font-weight:800; letter-spacing:0.05em; font-size:36px; }
        .text-sm { font-size:12px; }
        .value { font-size:26px; font-weight:800; }
        .brandbar { height:6px; background: linear-gradient(90deg, var(--accent1), var(--accent2)); border-radius:6px; }
        .klabel { display:block; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px; }
        .input { width:100%; height:36px; padding:0 10px; border:1px solid #E5E7EB; border-radius:10px; background:#FFFFFF; color:var(--ink); }
        .input:focus { outline:2px solid rgba(47,125,192,0.2); border-color:#93C5FD; }
        .input.invalid { border-color:#FCA5A5; background:#FFF1F2; }
        .btn { height:36px; padding:0 12px; border-radius:9999px; border:1px solid transparent; background: var(--accent1); color:#FFFFFF; cursor:pointer; font-weight:700; }
        .btn.secondary { background:#F3F4F6; color:var(--ink); border-color:#E5E7EB; }
        .btn.ghost { background:transparent; color:var(--ink); border:1px solid #E5E7EB; }
        .btn.small { height:30px; padding:0 10px; font-weight:600; }
        .card { background:#FFFFFF; border:1px solid #E5E7EB; border-radius:16px; padding:16px; box-shadow:0 0 0 1px rgba(0,0,0,0.01); }
        .report { background:#FFFFFF; border-radius:16px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); padding:24px; }
        .a4 { width: 794px; }
        .logoImg { height:46px; width:auto; object-fit:contain; image-rendering:auto; }

        /* Editor (inputs) */
        .editor { border:1px solid #E5E7EB; border-radius:16px; padding:12px; background:#FFFFFF; }

        /* Tabela do RELATÓRIO (read-only elegante) */
        .tableWrap { overflow:auto; border:1px solid #E5E7EB; border-radius:16px; }
        table { width:100%; border-collapse:separate; border-spacing:0; font-size:13px; }
        thead { background:#F3F6FA; color:var(--muted); }
        th, td { padding:12px; text-align:left; border-top:1px solid #E5E7EB; vertical-align:top; }
        thead th { border-top:none; font-weight:600; }
        tbody tr:nth-child(even){ background:#FCFCFD; }
        tr:hover { background:#F8FAFC; }
        .num { text-align:right; font-variant-numeric: tabular-nums; }
        .chip-warn { display:inline-block; padding:2px 6px; border-radius:9999px; background:#FFF1F2; color:#DC2626; font-size:11px; }

        .chart { position:relative; width:100%; height:420px; }
        .helper { color:var(--muted); font-size:11px; margin-top:8px; }
        @media (max-width: 960px) { .grid-4, .grid-3, .grid-2 { grid-template-columns: 1fr; } }
        /* Some editor on PDF */
        ${isExporting ? `.editor{display:none}` : ``}
      `}</style>

      {/* Controles essenciais */}
      <div className="container mb-6">
        <div className="grid grid-4" style={{ alignItems: "end" }}>
          <div style={{ gridColumn: "span 2" }}>
            <label className="klabel">Cliente</label>
            <input className="input" placeholder="Nome do cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} />
          </div>
          <div>
            <label className="klabel">Relatório do dia</label>
            <input type="date" className="input" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
          </div>
          <div className="row" style={{justifyContent:"flex-end"}}>
            <button className="btn small secondary" onClick={() => setShowEditor((v) => !v)}>{showEditor ? "Ocultar editor" : "Mostrar editor"}</button>
          </div>
        </div>

        <div className="row mt-6" style={{ flexWrap: "wrap", gap: 8 }}>
          <button onClick={addRow} className="btn">Adicionar unidade</button>
          <button onClick={addSamples} className="btn secondary">Adicionar 4 unidades de exemplo</button>
          <button onClick={addEdgeCases} className="btn secondary">Adicionar casos de teste (edge)</button>
          <button onClick={clearAll} className="btn ghost">Limpar tudo</button>
          <div className="ml-auto row" style={{ gap: 8 }}>
            <button onClick={exportPDF} className="btn">Exportar PDF</button>
            <button onClick={exportCSV} className="btn secondary">Exportar CSV</button>
            <button onClick={exportXLSX} className="btn secondary">Exportar XLSX</button>
          </div>
        </div>

        {showEditor && (
          <div className="editor mt-6">
            <div className="klabel" style={{marginBottom:8}}>Editor de unidades (não aparece no PDF)</div>
            <div className="tableWrap" style={{borderRadius:12}}>
              <table>
                <thead>
                  <tr>
                    <th>Empreendimento</th>
                    <th>Unidade</th>
                    <th>Valor do imóvel na aquisição (R$)</th>
                    <th>Aquisição (Data de aquisição)</th>
                    <th>Valor atual (R$)</th>
                    <th style={{width:60}}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <select className="input" value={row.empreendimento} onChange={(ev) => handleRowChange(row.id, "empreendimento", ev.target.value)}>
                          <option value="">Selecione...</option>
                          {EMP_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </td>
                      <td><input className="input" value={row.unidade} onChange={(ev) => handleRowChange(row.id, "unidade", ev.target.value)} placeholder="Ex.: 1205" /></td>
                      <td><input type="text" inputMode="decimal" className="input" value={row.valorAquisicao} onChange={(ev) => handleRowChange(row.id, "valorAquisicao", ev.target.value)} placeholder="0,00" /></td>
                      <td><input type="date" className="input" value={row.dataAquisicao} onChange={(ev) => handleRowChange(row.id, "dataAquisicao", ev.target.value)} /></td>
                      <td><input type="text" inputMode="decimal" className="input" value={row.valorAtual} onChange={(ev) => handleRowChange(row.id, "valorAtual", ev.target.value)} placeholder="0,00" /></td>
                      <td><button className="btn ghost" title="Remover linha" onClick={() => removeRow(row.id)}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ÁREA DE RELATÓRIO (somente leitura) */}
      <div ref={reportRef} className="container report a4">
        <div className="brandbar" />
        {/* Cabeçalho elegante */}
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
          <BrandLogo kind="dif" alt="Diferencial" />
          <h1 className="title">VALORIZAÇÃO</h1>
          <BrandLogo kind="bic" alt="Bicalho" />
        </div>

        {/* Valor total de contratos destacado logo abaixo do título */}
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <div className="klabel" style={{ marginBottom: 4 }}>Valor Total de Contratos (R$)</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{currencyBR(totals.valorTotalContratos)}</div>
        </div>

        {/* Quadro 2x2 com tipografia premium */}
        <div className="grid grid-2" style={{ gap: 12, marginTop: 18 }}>
          <div><div className="klabel">Cliente</div><div title={cliente || ""}>{cliente || "–"}</div></div>
          <div><div className="klabel">Total de Unidades</div><div>{totals.totalUnidades} <span className="muted" style={{ fontSize: 12 }}>— {totals.listaSiglas || "–"}</span></div></div>
          <div><div className="klabel">Relatório do dia</div><div>{formatDateBR(reportDate)}</div></div>
        </div>

        {/* Cards resumo fortes */}
        <div className="grid grid-3 mt-6">
          <div className="card"><div className="klabel">Valor Atual Imóveis (R$)</div><div className="value">{currencyBR(totals.valorAtualImoveis)}</div></div>
          <div className="card"><div className="klabel">Lucro na Valorização (R$)</div><div className={`value ${totals.lucroValorizacao < 0 ? "danger" : ""}`}>{currencyBR(totals.lucroValorizacao)}</div></div>
          <div className="card"><div className="klabel">Valorização Atual (%)</div><div className={`value ${totals.valorizacaoAtualPct < 0 ? "danger" : ""}`}>{percent2(totals.valorizacaoAtualPct)}</div></div>
        </div>

        {/* Gráfico donut refinado */}
        <div className="mt-6">
          <div className="klabel" style={{ marginBottom: 8 }}>Representação gráfica:</div>
          <div className="chart">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={100} outerRadius={155} paddingAngle={0} startAngle={90} endAngle={450} isAnimationActive={!isExporting}>
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index === 0 ? BRAND_BLUE : BRAND_ORANGE} />
                  ))}
                </Pie>
                {!isExporting && <Tooltip formatter={(v) => currencyBR(v)} />}
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{ fontWeight: 800, fontSize: 34, color: BRAND_BLUE }} className={totals.valorizacaoAtualPct < 0 ? "danger" : ""}>{percent2(totals.valorizacaoAtualPct)}</div>
            </div>
          </div>
        </div>

        {/* Tabela RELATÓRIO (somente leitura) */}
        <div className="mt-6">
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 280 }}>Empreendimento</th>
                  <th style={{ width: 120 }}>Unidade</th>
                  <th className="num" style={{ width: 220 }}>Valor do imóvel na aquisição (R$)</th>
                  <th style={{ width: 180 }}>Aquisição (Data de aquisição)</th>
                  <th className="num" style={{ width: 180 }}>Valor atual (R$)</th>
                  <th className="num" style={{ width: 160 }}>% de valorização</th>
                  <th className="num" style={{ width: 220 }}>Lucro líquido ao mês (R$/mês)</th>
                  <th className="num" style={{ width: 160 }}>% Lucro líquido</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const pr = parsedRows[idx];
                  const e = pr?.errors || {};
                  const isValid = pr?.validForTotals;
                  const warn = (txt) => <span className="chip-warn">{txt}</span>;

                  return (
                    <tr key={row.id}>
                      <td>{row.empreendimento || warn("Obrigatório")}</td>
                      <td>{row.unidade || warn("Obrigatório")}</td>
                      <td className="num">{isValid || isFinite(pr?.valorAquisicao) ? currencyBR(pr?.valorAquisicao) : warn(e.valorAquisicao || "Obrigatório")}</td>
                      <td>{row.dataAquisicao ? formatDateBR(row.dataAquisicao) : warn(e.dataAquisicao || "Obrigatório")}</td>
                      <td className="num">{isValid || isFinite(pr?.valorAtual) ? currencyBR(pr?.valorAtual) : warn(e.valorAtual || "Obrigatório")}</td>
                      <td className="num">{isValid ? (<span className={pr.valorizacaoPct < 0 ? "danger" : ""}>{percent2(pr.valorizacaoPct)}</span>) : <span className="muted">–</span>}</td>
                      <td className="num">{isValid ? (<span className={pr.lucroMes < 0 ? "danger" : ""}>{currencyBR(pr.lucroMes)}</span>) : <span className="muted">–</span>}</td>
                      <td className="num">{isValid ? (<span className={pr.lucroPctMes < 0 ? "danger" : ""}>{percent2(pr.lucroPctMes)}</span>) : <span className="muted">–</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="muted text-sm" style={{ marginTop: 12 }}>
            Nº das unidades: <span style={{ color: INK, fontWeight: 600 }}>{totals.listaSiglas || "–"}</span>
          </div>
        </div>
      </div>

      {/* Rodapé explicativo */}
      <div className="container helper">
        Regras aplicadas: ignora linhas incompletas, valor de aquisição precisa ser &gt; 0, datas de aquisição futuras são invalidadas. Dias corridos = max(1, data do relatório - data de aquisição). Percentuais e moedas com 2 casas.
      </div>
    </div>
  );
}
