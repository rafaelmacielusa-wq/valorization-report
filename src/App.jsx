import React, { useMemo, useRef, useState } from "react";
import {
  PieChart,
  Pie,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from "recharts";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";

/**
 * FIX & UPGRADE
 * - Resolve PDF export flakiness: espera fontes, timeout curto e captura com bg branco; try/catch.
 * - Removidos estilos potencialmente incompatíveis (ex.: oklch). Só HEX/RGB.
 * - Substituídos <input type="number"> por <input type="text" inputMode="decimal"> para evitar erro JSX no sandbox.
 * - Suporte a DOIS LOGOS (ex.: Diferencial + Bicalho) + paleta de cores configurável.
 * - Mantidos os 4 exemplos originais e os 6 casos de teste (edge). 
 */

// ===== Helpers =====
const currencyBR = (n) =>
  (isFinite(n) ? n : 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const percent2 = (n) => {
  if (!isFinite(n)) return "–";
  const str = (Math.round(n * 100) / 100).toFixed(2).replace(".", ",");
  return `${str}%`;
};

const formatDateBR = (d) => {
  try {
    return new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch {
    return "";
  }
};

const ymd = (date) => {
  const pad = (x) => String(x).padStart(2, "0");
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const todayYMD = () => ymd(new Date());

// Sanitize decimal using comma or dot
const toDecimal = (val) => {
  if (val === null || val === undefined) return NaN;
  const s = String(val).replace(/[^0-9,.-]/g, "");
  if (s.includes(",") && s.includes(".")) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) return parseFloat(s.replaceAll(".", "").replace(",", "."));
    return parseFloat(s.replaceAll(",", ""));
  }
  return parseFloat(s.replace(",", "."));
};

// ===== Row model =====
const emptyRow = (id) => ({
  id,
  empreendimento: "",
  unidade: "",
  valorAquisicao: "",
  dataAquisicao: "",
  valorAtual: "",
});

export default function ValorizationReportApp() {
  const [cliente, setCliente] = useState("");
  const [reportDate, setReportDate] = useState(todayYMD());
  const [rows, setRows] = useState([emptyRow(1)]);
  const [logoLeft, setLogoLeft] = useState(null);  // Diferencial
  const [logoRight, setLogoRight] = useState(null); // Bicalho
  const [accent1, setAccent1] = useState("#FF6A00"); // laranja Diferencial (aprox)
  const [accent2, setAccent2] = useState("#2F7DC0"); // azul Bicalho (aprox)

  const nextIdRef = useRef(2);
  const reportRef = useRef(null);

  // ===== Handlers =====
  const addRow = () => setRows((r) => [...r, emptyRow(nextIdRef.current++)]);
  const removeRow = (id) => setRows((r) => (r.length === 1 ? r : r.filter((x) => x.id !== id)));
  const clearAll = () => {
    setRows([emptyRow(1)]);
    nextIdRef.current = 2;
  };

  const handleRowChange = (id, field, value) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const onLogoUpload = (side, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => (side === "left" ? setLogoLeft(e.target.result) : setLogoRight(e.target.result));
    reader.readAsDataURL(file);
  };

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
      { empreendimento: "Teste Data Futura", unidade: "DF-01", valorAquisicao: "1000", dataAquisicao: ymd(new Date(new Date(repDate).getTime() + 5 * 24 * 3600 * 1000)), valorAtual: "1200" },
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

    return rows.map((r, index) => {
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
      if (dAq && repDate && dAq <= repDate) dias = Math.max(1, Math.floor((repDate - dAq) / (1000 * 60 * 60 * 24)));

      const valorizacaoPct = va > 0 && isFinite(vc / va) ? (vc / va - 1) * 100 : NaN;
      const lucroMes = isFinite(vc - va) ? (vc - va) / (dias / 30) : NaN;
      const lucroPctMes = va > 0 && isFinite(lucroMes / va) ? (lucroMes / va) * 100 : NaN;

      const validForTotals = hasAllRequired && !ignore && isFinite(va) && isFinite(vc) && va > 0;

      return { id: r.id, index, empreendimento: r.empreendimento, unidade: r.unidade, valorAquisicao: va, dataAquisicao: r.dataAquisicao, valorAtual: vc, dias, valorizacaoPct, lucroMes, lucroPctMes, validForTotals, errors };
    });
  }, [rows, reportDate]);

  const totals = useMemo(() => {
    const valid = parsedRows.filter((r) => r.validForTotals);
    const totalUnidades = valid.length;
    const listaUnidades = valid.map((r) => r.unidade).join(", ");
    const valorTotalContratos = valid.reduce((s, r) => s + r.valorAquisicao, 0);
    const valorAtualImoveis = valid.reduce((s, r) => s + r.valorAtual, 0);
    const lucroValorizacao = valorAtualImoveis - valorTotalContratos;
    const valorizacaoAtualPct = valorTotalContratos > 0 ? (valorAtualImoveis / valorTotalContratos - 1) * 100 : 0;
    return { totalUnidades, listaUnidades, valorTotalContratos, valorAtualImoveis, lucroValorizacao, valorizacaoAtualPct };
  }, [parsedRows]);

  const pieData = useMemo(() => {
    // lucro negativo vira 0 na rosca, conforme alinhado
    const lucroPositivo = Math.max(0, totals.lucroValorizacao);
    return [
      { name: "Valor Total de Contratos (R$)", value: totals.valorTotalContratos },
      { name: "Lucro na Valorização (R$)", value: lucroPositivo },
    ];
  }, [totals]);

  // ===== Exports =====
  const exportCSV = () => {
    const header = ["Empreendimento", "Unidade", "Valor do imóvel na aquisição (R$)", "Aquisição (Data de aquisição)", "Valor atual (R$)", "% de valorização", "Lucro líquido ao mês (R$/mês)", "% Lucro líquido"];
    const lines = parsedRows.map((r) => [r.empreendimento, r.unidade, currencyBR(r.valorAquisicao), r.dataAquisicao ? formatDateBR(r.dataAquisicao) : "", currencyBR(r.valorAtual), percent2(r.valorizacaoPct), currencyBR(r.lucroMes), percent2(r.lucroPctMes)]);
    const sep = ";";
    const csv = [header.join(sep), ...lines.map((l) => l.map((s) => `"${String(s).replaceAll('"', '""')}"`).join(sep))].join("\n");
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
      const el = reportRef.current;
      if (!el) return;

      // Espera fontes e render do Recharts
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 300));

      // Captura estável do container completo (A4 retrato)
      const canvas = await html2canvas(el, {
        backgroundColor: "#FFFFFF",
        scale: window.devicePixelRatio > 1 ? 2 : 1.5,
        useCORS: true,
        allowTaint: true,
        logging: false,
        scrollX: -window.scrollX,
        scrollY: -window.scrollY,
        windowWidth: el.scrollWidth,
        windowHeight: el.scrollHeight,
        onclone: (doc) => {
          // garante que inputs renderizem os valores
          doc.querySelectorAll('input').forEach((inp) => {
            try { inp.setAttribute('value', inp.value); } catch {}
          });
        },
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const y = Math.max(0, (pageHeight - imgHeight) / 2);
      pdf.addImage(imgData, "PNG", 0, y, imgWidth, imgHeight, undefined, 'FAST');
      pdf.save(`relatorio_valorizacao_${(cliente || "cliente").replaceAll(" ", "_")}_${reportDate}.pdf`);
    } catch (err) {
      console.error("PDF export error (primary)", err);
      try {
        // Fallback usando jsPDF.html
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
        await pdf.html(reportRef.current, {
          html2canvas: {
            backgroundColor: "#FFFFFF",
            scale: 2,
            useCORS: true,
            allowTaint: true,
            scrollX: -window.scrollX,
            scrollY: -window.scrollY,
          },
          callback: (doc) => {
            doc.save(`relatorio_valorizacao_${(cliente || "cliente").replaceAll(" ", "_")}_${reportDate}.pdf`);
          },
          x: 0,
          y: 0,
        });
      } catch (err2) {
        console.error("PDF export error (fallback)", err2);
        alert("Não foi possível gerar o PDF. Tente recarregar a página e exportar novamente. Se persistir, me avise para eu aplicar outro método de exportação.");
      }
    }
  };

  // ===== UI =====
  return (
    <div className="app" style={{ ['--accent1']: accent1, ['--accent2']: accent2 }}>
      <style>{`
        .app { min-height:100vh; width:100%; background:#FAFAFA; color:#0F172A; padding:24px; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans", "Helvetica Neue"; }
        .container { max-width: 1152px; margin: 0 auto; }
        .grid { display:grid; gap:16px; }
        .grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .row { display:flex; gap:8px; align-items:center; }
        .mt-6 { margin-top:24px; }
        .mb-6 { margin-bottom:24px; }
        .ml-auto { margin-left:auto; }
        .p-4 { padding:16px; }
        .rounded-xl { border-radius:16px; }
        .bordered { border:1px solid #E5E7EB; }
        .muted { color:#6B7280; }
        .danger { color:#DC2626; }
        .title { font-weight:800; letter-spacing:0.04em; }
        .text-3xl { font-size:30px; }
        .text-sm { font-size:12px; }
        .value { font-size:24px; font-weight:700; }
        .brandbar { height:6px; background: linear-gradient(90deg, var(--accent1), var(--accent2)); border-radius:6px; }

        .label { display:block; font-size:12px; color:#6B7280; margin-bottom:6px; }
        .input { width:100%; height:36px; padding:0 10px; border:1px solid #E5E7EB; border-radius:10px; background:#FFFFFF; color:#0F172A; }
        .input[type="file"] { height:auto; padding:8px; }
        .input:focus { outline:2px solid rgba(37,99,235,0.15); border-color:#93C5FD; }
        .input.invalid { border-color:#FCA5A5; background:#FFF1F2; }

        .btn { height:36px; padding:0 12px; border-radius:9999px; border:1px solid transparent; background: var(--accent1); color:#FFFFFF; cursor:pointer; font-weight:600; }
        .btn:hover { filter:brightness(0.95); }
        .btn.secondary { background:#F3F4F6; color:#0F172A; border-color:#E5E7EB; }
        .btn.ghost { background:transparent; color:#0F172A; border:1px solid #E5E7EB; }

        .card { background:#FFFFFF; border:1px solid #E5E7EB; border-radius:16px; padding:16px; }
        .report { background:#FFFFFF; border-radius:16px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); padding:24px; }
        .a4 { width: 794px; }
        .logoBox { height:48px; width:48px; border-radius:10px; border:1px solid #E5E7EB; background:#F5F5F5; display:grid; place-items:center; color:#9CA3AF; font-size:10px; }
        .logoImg { height:48px; width:110px; object-fit:contain; }

        .tableWrap { overflow:auto; border:1px solid #E5E7EB; border-radius:16px; }
        table { width:100%; border-collapse:separate; border-spacing:0; font-size:13px; }
        thead { background:#F9FAFB; color:#6B7280; }
        th, td { padding:12px; text-align:left; border-top:1px solid #E5E7EB; vertical-align:top; }
        thead th { border-top:none; }
        tr:hover { background:#F9FAFB; }
        .chart { position:relative; width:100%; height:320px; }
        .helper { color:#6B7280; font-size:11px; margin-top:8px; }

        @media (max-width: 960px) { .grid-4, .grid-3, .grid-2 { grid-template-columns: 1fr; } }
      `}</style>

      {/* Controls */}
      <div className="container mb-6">
        <div className="grid grid-4" style={{ alignItems: "end" }}>
          <div style={{ gridColumn: "span 2" }}>
            <label className="label">Cliente</label>
            <input className="input" placeholder="Nome do cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} />
          </div>
          <div>
            <label className="label">Relatório do dia</label>
            <input type="date" className="input" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
          </div>
          <div></div>

          <div>
            <label className="label">Logo esquerda (Diferencial)</label>
            <input type="file" className="input" accept="image/*" onChange={(e) => onLogoUpload("left", e.target.files?.[0])} />
          </div>
          <div>
            <label className="label">Logo direita (Bicalho)</label>
            <input type="file" className="input" accept="image/*" onChange={(e) => onLogoUpload("right", e.target.files?.[0])} />
          </div>
          <div>
            <label className="label">Cor primária (laranja)</label>
            <input className="input" type="color" value={accent1} onChange={(e)=>setAccent1(e.target.value)} />
          </div>
          <div>
            <label className="label">Cor secundária (azul)</label>
            <input className="input" type="color" value={accent2} onChange={(e)=>setAccent2(e.target.value)} />
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
      </div>

      {/* Report Area */}
      <div ref={reportRef} className="container report a4">
        <div className="brandbar" />
        {/* Header */}
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            {logoLeft ? <img src={logoLeft} alt="logo-left" className="logoImg"/> : <div className="logoBox">LOGO</div>}
            <h1 className="title text-3xl">VALORIZAÇÃO</h1>
            {logoRight ? <img src={logoRight} alt="logo-right" className="logoImg"/> : <div className="logoBox">LOGO</div>}
          </div>
          <div className="grid grid-2" style={{ gap: 12, minWidth: 320 }}>
            <div><div className="muted text-sm">Cliente</div><div className="fw-medium" title={cliente || ""}>{cliente || "–"}</div></div>
            <div><div className="muted text-sm">Total de Unidades</div><div className="fw-semibold">{totals.totalUnidades}</div></div>
            <div><div className="muted text-sm">Valor Total de Contratos (R$)</div><div className="fw-semibold">{currencyBR(totals.valorTotalContratos)}</div></div>
            <div><div className="muted text-sm">Relatório do dia</div><div className="fw-medium">{formatDateBR(reportDate)}</div></div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-3 mt-6">
          <div className="card"><div className="muted text-sm">Valor Atual Imóveis (R$)</div><div className="value">{currencyBR(totals.valorAtualImoveis)}</div></div>
          <div className="card"><div className="muted text-sm">Lucro na Valorização (R$)</div><div className={`value ${totals.lucroValorizacao < 0 ? "danger" : ""}`}>{currencyBR(totals.lucroValorizacao)}</div></div>
          <div className="card"><div className="muted text-sm">Valorização Atual (%)</div><div className={`value ${totals.valorizacaoAtualPct < 0 ? "danger" : ""}`}>{percent2(totals.valorizacaoAtualPct)}</div></div>
        </div>

        {/* Donut Chart */}
        <div className="chart mt-6">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={80} outerRadius={110} paddingAngle={2}>
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index === 0 ? accent2 : accent1} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => currencyBR(v)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <div className={`text-xl fw-semibold ${totals.valorizacaoAtualPct < 0 ? "danger" : ""}`}>{percent2(totals.valorizacaoAtualPct)}</div>
          </div>
        </div>

        {/* Table Inputs */}
        <div className="mt-6">
          <div className="tableWrap rounded-xl">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 280 }}>Empreendimento</th>
                  <th style={{ width: 120 }}>Unidade</th>
                  <th style={{ width: 220 }}>Valor do imóvel na aquisição (R$)</th>
                  <th style={{ width: 180 }}>Aquisição (Data de aquisição)</th>
                  <th style={{ width: 180 }}>Valor atual (R$)</th>
                  <th style={{ width: 160 }}>% de valorização</th>
                  <th style={{ width: 220 }}>Lucro líquido ao mês (R$/mês)</th>
                  <th style={{ width: 160 }}>% Lucro líquido</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const pr = parsedRows[idx];
                  const e = pr?.errors || {};
                  const isValid = pr?.validForTotals;

                  return (
                    <tr key={row.id}>
                      <td>
                        <input className={`input ${e.empreendimento ? "invalid" : ""}`} value={row.empreendimento} onChange={(ev) => handleRowChange(row.id, "empreendimento", ev.target.value)} placeholder="Ex.: Vértice Barigui" />
                        {e.empreendimento && <div className="text-sm danger" style={{ marginTop: 4 }}>{e.empreendimento}</div>}
                      </td>
                      <td>
                        <input className={`input ${e.unidade ? "invalid" : ""}`} value={row.unidade} onChange={(ev) => handleRowChange(row.id, "unidade", ev.target.value)} placeholder="Ex.: 1205" />
                        {e.unidade && <div className="text-sm danger" style={{ marginTop: 4 }}>{e.unidade}</div>}
                      </td>
                      <td>
                        <input type="text" inputMode="decimal" className={`input ${e.valorAquisicao ? "invalid" : ""}`} value={row.valorAquisicao} onChange={(ev) => handleRowChange(row.id, "valorAquisicao", ev.target.value)} placeholder="0,00" />
                        {e.valorAquisicao && <div className="text-sm danger" style={{ marginTop: 4 }}>{e.valorAquisicao}</div>}
                      </td>
                      <td>
                        <input type="date" className={`input ${e.dataAquisicao ? "invalid" : ""}`} value={row.dataAquisicao} onChange={(ev) => handleRowChange(row.id, "dataAquisicao", ev.target.value)} />
                        {e.dataAquisicao && <div className="text-sm danger" style={{ marginTop: 4 }}>{e.dataAquisicao}</div>}
                      </td>
                      <td>
                        <input type="text" inputMode="decimal" className={`input ${e.valorAtual ? "invalid" : ""}`} value={row.valorAtual} onChange={(ev) => handleRowChange(row.id, "valorAtual", ev.target.value)} placeholder="0,00" />
                        {e.valorAtual && <div className="text-sm danger" style={{ marginTop: 4 }}>{e.valorAtual}</div>}
                      </td>
                      <td>{isValid ? (<span className={pr.valorizacaoPct < 0 ? "danger" : ""}>{percent2(pr.valorizacaoPct)}</span>) : (<span className="muted">–</span>)}</td>
                      <td>{isValid ? (<span className={pr.lucroMes < 0 ? "danger" : ""}>{currencyBR(pr.lucroMes)}</span>) : (<span className="muted">–</span>)}</td>
                      <td>{isValid ? (<span className={pr.lucroPctMes < 0 ? "danger" : ""}>{percent2(pr.lucroPctMes)}</span>) : (<span className="muted">–</span>)}</td>
                      <td><button className="btn ghost" title="Remover linha" onClick={() => removeRow(row.id)}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="muted text-sm" style={{ marginTop: 12 }}>
            Nº das unidades: <span className="fw-medium" style={{ color: "#0F172A" }}>{totals.listaUnidades || "–"}</span>
          </div>
        </div>
      </div>

      {/* Tiny helper text */}
      <div className="container helper">
        Regras aplicadas: ignora linhas incompletas, valor de aquisição precisa ser &gt; 0, datas de aquisição futuras são invalidadas. Dias corridos = max(1, data do relatório - data de aquisição). Percentuais e moedas com 2 casas.
      </div>
    </div>
  );
}
