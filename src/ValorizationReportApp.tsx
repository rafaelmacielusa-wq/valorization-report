import React, { useMemo, useRef, useState } from "react";
import { PieChart, Pie, Tooltip, ResponsiveContainer, Cell } from "recharts";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";

/**
 * VERSÃO PREMIUM (foco PDF alto padrão)
 * - Logos fixas (sem upload), sem distorção.
 * - Tipografia Inter; hierarquia e espaçamentos caprichados.
 * - Cabeçalho em barra 4 colunas, como o PDF referência.
 * - Cards compactos em 3 colunas (com borda preta).
 * - Gráfico donut grande (azul Bicalho + laranja Diferencial); % central em laranja.
 * - Tabela de relatório com cabeçalho escuro e contorno preto; encolhida para caber 1 página.
 * - Editor (inputs) fica fora do PDF e com máscara BRL nos valores.
 * - Exportação PDF A4 retrato, margens laterais menores.
 */

// ===== Cores / marca =====
const BRAND_ORANGE = "#FF6A00"; // Diferencial
const BRAND_BLUE = "#2F7DC0";    // Bicalho
const INK = "#0F172A";
const MUTED = "#6B7280";

// ===== Logos fixas em /public/logos/ (diferencial.png e bicalho.png) =====
function BrandLogo({ kind, alt }: { kind: "dif" | "bic"; alt: string }) {
  const file = kind === "dif" ? "diferencial.png" : "bicalho.png";
  const srcs = [
    `/logos/${file}`,
    typeof window !== "undefined" ? `${window.location.origin}/logos/${file}` : ""
  ].filter(Boolean) as string[];
  const [idx, setIdx] = React.useState(0);
  const [failed, setFailed] = React.useState(false);

  if (failed) {
    return (
      <div style={{
        height: 70, minWidth: 140, display: "flex",
        alignItems: "center", justifyContent: "center",
        border: "1px dashed #E5E7EB", borderRadius: 8,
        color: MUTED, fontSize: 12
      }}>
        {alt}
      </div>
    );
  }

  return (
    <img
      className="logoImg"
      src={srcs[idx]}
      alt={alt}
      onError={() => (idx + 1 < srcs.length ? setIdx(idx + 1) : setFailed(true))}
    />
  );
}

// ===== Helpers =====
const currencyBR = (n: number) =>
  (isFinite(n) ? n : 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const percent2 = (n: number) => {
  if (!isFinite(n)) return "–";
  const s = (Math.round(n * 100) / 100).toFixed(2).replace(".", ",");
  return `${s}%`;
};

const formatDateBR = (d?: string) => {
  try {
    return new Date(d as string).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo"
    });
  } catch {
    return "";
  }
};

const ymd = (dt: Date | string) => {
  const d = new Date(dt);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const todayYMD = () => ymd(new Date());

// parse número em BRL (aceita 1.234,56 / 1234.56 / "R$ ...")
const toDecimal = (val: unknown) => {
  if (val === null || val === undefined) return NaN;
  const s = String(val).replace(/[^0-9,.-]/g, "");
  if (s.includes(",") && s.includes(".")) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      return parseFloat(s.replaceAll(".", "").replace(",", "."));
    }
    return parseFloat(s.replaceAll(",", ""));
  }
  return parseFloat(s.replace(",", "."));
};

// ===== máscara BRL para input textual =====
const maskBRL = (raw: string) => {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "R$ 0,00";
  const cents = (digits.slice(-2) || "00").padStart(2, "0");
  const intPart = digits.slice(0, -2) || "0";
  const thousands = Number(intPart).toLocaleString("pt-BR");
  return `R$ ${thousands},${cents}`;
};
const toMaskedBRL = (v: unknown) =>
  isFinite(toDecimal(v)) ? currencyBR(toDecimal(v)) : "R$ 0,00";
const ensureMasked = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s.startsWith("R$") ? s : toMaskedBRL(s);
};

// ===== Modelo de linha =====
const emptyRow = (id: number) => ({
  id,
  empreendimento: "",
  unidade: "",
  valorAquisicao: "",
  dataAquisicao: "",
  valorAtual: ""
});

// Opções fixas (ordem solicitada)
const EMP_OPTIONS = [
  "Start Residence",
  "Diamond Tower",
  "Benoît Batel",
  "Hol 1480",
  "Yacht Tower",
  "Legacy Tower",
  "Infinity Tower",
  "Vértice Barigui"
];

// sigla p/ cabeçalho (Hol 1480 => Hol; Vértice Barigui => VB etc.)
const acronymFromEmp = (emp: string) => {
  if (!emp) return "";
  if (emp.toLowerCase() === "hol 1480") return "Hol";
  return emp
    .trim()
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
};

export default function ValorizationReportApp() {
  const [cliente, setCliente] = useState("");
  const [reportDate, setReportDate] = useState(todayYMD());
  const [rows, setRows] = useState([emptyRow(1)]);
  const [isExporting, setIsExporting] = useState(false);
  const [showEditor, setShowEditor] = useState(true);
  const nextIdRef = useRef(2);
  const reportRef = useRef<HTMLDivElement | null>(null);

  // ações editor
  const addRow = () => setRows((r) => [...r, emptyRow(nextIdRef.current++)]);
  const removeRow = (id: number) =>
    setRows((r) => (r.length === 1 ? r : r.filter((x) => x.id !== id)));
  const clearAll = () => {
    setRows([emptyRow(1)]);
    nextIdRef.current = 2;
  };
  const handleRowChange = (id: number, field: string, value: string) =>
    setRows((p) => p.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

  // exemplos rápidos (mantém seus testes)
  const addSamples = () => {
    const s = [
      {
        empreendimento: "Vértice Barigui",
        unidade: "1205",
        valorAquisicao: toMaskedBRL("170000"),
        dataAquisicao: "2024-06-15",
        valorAtual: toMaskedBRL("210000")
      },
      {
        empreendimento: "Legacy Tower",
        unidade: "803",
        valorAquisicao: toMaskedBRL("220000"),
        dataAquisicao: "2023-11-01",
        valorAtual: toMaskedBRL("260000")
      },
      {
        empreendimento: "Yacht Tower",
        unidade: "1907",
        valorAquisicao: toMaskedBRL("150000"),
        dataAquisicao: "2024-12-10",
        valorAtual: toMaskedBRL("165000")
      },
      {
        empreendimento: "Infinity Tower",
        unidade: "305",
        valorAquisicao: toMaskedBRL("300000"),
        dataAquisicao: "2025-03-01",
        valorAtual: toMaskedBRL("315000")
      }
    ];
    setRows(s.map((x, i) => ({ id: i + 1, ...x })));
    nextIdRef.current = s.length + 1;
  };

  const addEdgeCases = () => {
    const repDate = reportDate;
    const extras = [
      {
        empreendimento: "Teste Aquisição Zero",
        unidade: "AZ-01",
        valorAquisicao: ensureMasked("0"),
        dataAquisicao: repDate,
        valorAtual: ensureMasked("1000")
      },
      {
        empreendimento: "Teste Data Futura",
        unidade: "DF-01",
        valorAquisicao: ensureMasked("1000"),
        dataAquisicao: ymd(new Date(new Date(repDate).getTime() + 5 * 864e5)),
        valorAtual: ensureMasked("1200")
      },
      {
        empreendimento: "Teste Desvalorização",
        unidade: "DV-01",
        valorAquisicao: ensureMasked("200000"),
        dataAquisicao: "2024-01-10",
        valorAtual: ensureMasked("180000")
      },
      {
        empreendimento: "Teste Data Igual",
        unidade: "DI-01",
        valorAquisicao: ensureMasked("50000"),
        dataAquisicao: repDate,
        valorAtual: ensureMasked("52000")
      },
      {
        empreendimento: "Teste Vírgula Decimal",
        unidade: "VD-01",
        valorAquisicao: ensureMasked("150000,50"),
        dataAquisicao: "2024-02-20",
        valorAtual: ensureMasked("160100,75")
      },
      {
        empreendimento: "Teste Texto Inválido",
        unidade: "TX-01",
        valorAquisicao: ensureMasked("200000"),
        dataAquisicao: "2024-03-10",
        valorAtual: ensureMasked("200000")
      }
    ];
    setRows((prev) => {
      const base =
        prev.length === 1 && !prev[0].empreendimento && !prev[0].unidade
          ? []
          : prev;
      const mapped = extras.map((s, i) => ({ id: nextIdRef.current + i, ...s }));
      nextIdRef.current += mapped.length;
      return [...base, ...mapped];
    });
  };

  // parse linhas => cálculos
  const parsedRows = useMemo(() => {
    const repDate = new Date(reportDate);
    return rows.map((r) => {
      const errors: Record<string, string> = {};
      const filled =
        r.empreendimento &&
        r.unidade &&
        r.valorAquisicao !== "" &&
        r.dataAquisicao &&
        r.valorAtual !== "";

      const va = toDecimal(r.valorAquisicao);
      const vc = toDecimal(r.valorAtual);
      const dAq = r.dataAquisicao ? new Date(r.dataAquisicao) : null;

      if (!r.empreendimento) errors.empreendimento = "Obrigatório";
      if (!r.unidade) errors.unidade = "Obrigatório";
      if (r.valorAquisicao === "") errors.valorAquisicao = "Obrigatório";
      if (r.valorAtual === "") errors.valorAtual = "Obrigatório";
      if (!r.dataAquisicao) errors.dataAquisicao = "Obrigatório";

      if (filled) {
        if (!isFinite(va) || va < 0) errors.valorAquisicao = "Valor inválido";
        if (!isFinite(vc) || vc < 0) errors.valorAtual = "Valor inválido";
      }

      let ignore = false;
      if (filled) {
        if (va === 0) {
          errors.valorAquisicao = "Informe o valor de aquisição (>0)";
          ignore = true;
        }
        if (dAq && dAq > repDate) {
          errors.dataAquisicao = "Data > Relatório";
          ignore = true;
        }
      }

      let dias = 1;
      if (dAq && dAq <= repDate) {
        dias = Math.max(1, Math.floor((repDate as any - dAq as any) / 86400000));
      }

      const valorizacaoPct = va > 0 && isFinite(vc / va) ? (vc / va - 1) * 100 : NaN;
      const lucroMes = isFinite(vc - va) ? (vc - va) / (dias / 30) : NaN;
      const lucroPctMes = va > 0 && isFinite(lucroMes / va) ? (lucroMes / va) * 100 : NaN;

      const validForTotals = !!(filled && !ignore && isFinite(va) && isFinite(vc) && va > 0);

      return {
        id: r.id,
        empreendimento: r.empreendimento,
        unidade: r.unidade,
        valorAquisicao: va,
        dataAquisicao: r.dataAquisicao,
        valorAtual: vc,
        dias,
        valorizacaoPct,
        lucroMes,
        lucroPctMes,
        validForTotals,
        errors
      };
    });
  }, [rows, reportDate]);

  const totals = useMemo(() => {
    const valid = parsedRows.filter((r) => r.validForTotals);
    const totalUnidades = valid.length;
    const listaSiglas = valid
      .map((r) => `${acronymFromEmp(r.empreendimento)}${r.unidade}`)
      .join(", ");

    const valorTotalContratos = valid.reduce((s, r) => s + r.valorAquisicao, 0);
    const valorAtualImoveis = valid.reduce((s, r) => s + r.valorAtual, 0);
    const lucroValorizacao = valorAtualImoveis - valorTotalContratos;
    const valorizacaoAtualPct =
      valorTotalContratos > 0
        ? (valorAtualImoveis / valorTotalContratos - 1) * 100
        : 0;

    return {
      totalUnidades,
      listaSiglas,
      valorTotalContratos,
      valorAtualImoveis,
      lucroValorizacao,
      valorizacaoAtualPct
    };
  }, [parsedRows]);

  const pieData = useMemo(() => {
    const pos = Math.max(0, totals.lucroValorizacao);
    return [
      { name: "Valor Total de Contratos (R$)", value: totals.valorTotalContratos },
      { name: "Lucro na Valorização (R$)", value: pos }
    ];
  }, [totals]);

  // exportações
  const exportCSV = () => {
    const header = [
      "Empreendimento",
      "Unidade",
      "Valor do imóvel na aquisição (R$)",
      "Aquisição (Data de aquisição)",
      "Valor atual (R$)",
      "% de valorização",
      "Lucro líquido ao mês (R$/mês)",
      "% Lucro líquido"
    ];
    const lines = parsedRows.map((r) => [
      r.empreendimento,
      r.unidade,
      currencyBR(r.valorAquisicao),
      r.dataAquisicao ? formatDateBR(r.dataAquisicao) : "",
      currencyBR(r.valorAtual),
      percent2(r.valorizacaoPct),
      currencyBR(r.lucroMes),
      percent2(r.lucroPctMes)
    ]);
    const sep = ";";
    const csv =
      [header.join(sep)]
        .concat(lines.map((l) => l.map((s) => `"${String(s).replaceAll('"', '""')}"`).join(sep)))
        .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tabela_relatorio_valorizacao_${(cliente || "cliente")
      .replaceAll(" ", "_")}_${reportDate}.csv`;
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
      "% Lucro líquido": percent2(r.lucroPctMes)
    }));
    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tabela");
    XLSX.writeFile(
      wb,
      `tabela_relatorio_valorizacao_${(cliente || "cliente").replaceAll(" ", "_")}_${reportDate}.xlsx`
    );
  };

  const exportPDF = async () => {
    try {
      setIsExporting(true);
      const el = reportRef.current;
      if (!el) return;
      if ((document as any).fonts?.ready) await (document as any).fonts.ready;
      await new Promise((r) => setTimeout(r, 250));

      const canvas = await html2canvas(el, {
        backgroundColor: "#FFFFFF",
        scale: window.devicePixelRatio > 1 ? 2.5 : 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        scrollX: -window.scrollX,
        scrollY: -window.scrollY,
        windowWidth: el.scrollWidth,
        windowHeight: el.scrollHeight
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
      const imgWidth = canvas.width * ratio;
      const imgHeight = canvas.height * ratio;
      const x = (pageWidth - imgWidth) / 2;
      const y = (pageHeight - imgHeight) / 2;

      pdf.addImage(imgData, "PNG", x, y, imgWidth, imgHeight, undefined, "FAST");
      pdf.save(`relatorio_valorizacao_${(cliente || "cliente").replaceAll(" ", "_")}_${reportDate}.pdf`);
    } catch (e) {
      console.error(e);
      alert("Não foi possível gerar o PDF agora. Tente recarregar a página.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
        :root { --accent1:${BRAND_ORANGE}; --accent2:${BRAND_BLUE}; --ink:${INK}; --muted:${MUTED}; }
        .app { min-height:100vh; width:100%; background:#FAFAFA; color:var(--ink); padding:24px;
               font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans", "Helvetica Neue"; }
        .container { max-width: 820px; margin: 0 auto; }
        .grid { display:grid; gap:16px; }
        .grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .row { display:flex; gap:8px; align-items:center; }
        .mt-6 { margin-top:24px; } .mb-6 { margin-bottom:24px; } .ml-auto { margin-left:auto; }
        .muted { color:var(--muted); } .danger { color:#DC2626; }
        .brandbar { height:6px; background: linear-gradient(90deg, var(--accent1), var(--accent2)); border-radius:6px; }
        .title { font-weight:800; letter-spacing:0.05em; font-size:36px; }
        .klabel { display:block; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px; }
        .input { width:100%; height:36px; padding:0 10px; border:1px solid #E5E7EB; border-radius:10px; background:#FFFFFF; color:var(--ink); }
        .btn { height:36px; padding:0 12px; border-radius:9999px; border:1px solid transparent; background: var(--accent1); color:#fff; font-weight:700; cursor:pointer; }
        .btn.secondary { background:#F3F4F6; color:var(--ink); border-color:#E5E7EB; }
        .btn.ghost { background:transparent; color:var(--ink); border:1px solid #E5E7EB; }
        .btn.small { height:30px; padding:0 10px; font-weight:600; }
        .card { background:#fff; border:2px solid #000; border-radius:16px; padding:16px; }
        .report { background:#fff; border-radius:16px; box-shadow: 0 1px 2px rgba(0,0,0,.05); padding:24px; }
        .a4 { width: 794px; }
        .logoImg { height:96px; width:auto; object-fit:contain; }

        /* Editor (inputs) */
        .editor { border:1px solid #E5E7EB; border-radius:16px; padding:12px; background:#fff; }

        /* Tabela RELATÓRIO (dark header + borda preta) */
        .tableWrap { overflow:auto; border:1px solid #E5E7EB; border-radius:16px; }
        table { width:100%; border-collapse:separate; border-spacing:0; font-size:13px; }
        thead { background:#F3F6FA; color:var(--muted); }
        th, td { padding:12px; text-align:left; border-top:1px solid #E5E7EB; vertical-align:top; }
        thead th { border-top:none; font-weight:600; }
        tbody tr:nth-child(even){ background:#FCFCFD; }
        .num { text-align:right; font-variant-numeric: tabular-nums; }
        .chip-warn { display:inline-block; padding:2px 6px; border-radius:9999px; background:#FFF1F2; color:#DC2626; font-size:11px; }

        /* Versão da tabela dentro do relatório (mais escura e com contorno preto) */
        .reportTable .tableWrap { border:1px solid #000; overflow:hidden; }
        .reportTable thead { background:#0F172A; color:#fff; }
        .reportTable table, .reportTable th, .reportTable td { border-color:#000 !important; }
        .reportTable th, .reportTable td { border-top:1px solid #000; }
        .reportTable tbody tr:nth-child(even){ background:#F9FAFB; }
        .reportTable.shrink { transform:scale(.9); transform-origin: top left; width:111.12%; }

        /* Gráfico */
        .chart { position:relative; width:100%; height:620px; }
        .value { font-size:26px; font-weight:800; }

        /* Oculta editor no momento de gerar PDF */
        ${isExporting ? `.editor{display:none}` : ``}

        /* PRINT: margens menores laterais para ocupar mais área */
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          body { margin: 0; }
        }
      `}</style>

      {/* Controles */}
      <div className="container mb-6">
        <div className="grid grid-4" style={{ alignItems: "end" }}>
          <div style={{ gridColumn: "span 2" }}>
            <label className="klabel">Cliente</label>
            <input
              className="input"
              placeholder="Nome do cliente"
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
            />
          </div>
          <div>
            <label className="klabel">Relatório do dia</label>
            <input
              type="date"
              className="input"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
            />
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn small secondary" onClick={() => setShowEditor((v) => !v)}>
              {showEditor ? "Ocultar editor" : "Mostrar editor"}
            </button>
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
            <div className="klabel" style={{ marginBottom: 8 }}>
              Editor de unidades (não aparece no PDF)
            </div>
            <div className="tableWrap" style={{ borderRadius: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Empreendimento</th>
                    <th>Unidade</th>
                    <th>Valor do imóvel na aquisição (R$)</th>
                    <th>Aquisição (Data de aquisição)</th>
                    <th>Valor atual (R$)</th>
                    <th style={{ width: 60 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <select
                          className="input"
                          value={row.empreendimento}
                          onChange={(e) => handleRowChange(row.id, "empreendimento", e.target.value)}
                        >
                          <option value="">Selecione...</option>
                          {EMP_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="input"
                          value={row.unidade}
                          onChange={(e) => handleRowChange(row.id, "unidade", e.target.value)}
                          placeholder="Ex.: 1205"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="input"
                          value={row.valorAquisicao || "R$ 0,00"}
                          onChange={(e) =>
                            handleRowChange(row.id, "valorAquisicao", maskBRL(e.target.value))
                          }
                          placeholder="R$ 0,00"
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          className="input"
                          value={row.dataAquisicao}
                          onChange={(e) => handleRowChange(row.id, "dataAquisicao", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="input"
                          value={row.valorAtual || "R$ 0,00"}
                          onChange={(e) => handleRowChange(row.id, "valorAtual", maskBRL(e.target.value))}
                          placeholder="R$ 0,00"
                        />
                      </td>
                      <td>
                        <button className="btn ghost" title="Remover linha" onClick={() => removeRow(row.id)}>
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* RELATÓRIO */}
      <div ref={reportRef} className="container report a4">
        <div className="brandbar" />

        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
          <BrandLogo kind="dif" alt="Diferencial" />
          <h1 className="title">VALORIZAÇÃO</h1>
          <BrandLogo kind="bic" alt="Bicalho" />
        </div>

        <div style={{ textAlign: "center", marginTop: 12 }}>
          <div className="klabel" style={{ marginBottom: 4 }}>Cliente</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{cliente || "–"}</div>
        </div>

        <div className="headerStats" style={{ marginTop: 8 }}>
          <div>
            <div className="klabel">Valor Total de Contratos (R$)</div>
            <div style={{ fontWeight: 800 }}>{currencyBR(totals.valorTotalContratos)}</div>
          </div>
          <div>
            <div className="klabel">Total de Unidades</div>
            <div style={{ fontWeight: 800 }}>{String(totals.totalUnidades).padStart(2, "0")}</div>
          </div>
          <div>
            <div className="klabel">Nº das Unidades</div>
            <div style={{ fontWeight: 800 }}>{totals.listaSiglas || "–"}</div>
          </div>
          <div>
            <div className="klabel">Relatório do dia</div>
            <div style={{ fontWeight: 800 }}>{formatDateBR(reportDate)}</div>
          </div>
        </div>

        {/* três cards em linha com borda preta */}
        <div className="grid grid-3 mt-6">
          <div className="card">
            <div className="klabel">Valor Atual Imóveis (R$)</div>
            <div className="value">{currencyBR(totals.valorAtualImoveis)}</div>
          </div>
          <div className="card">
            <div className="klabel">Lucro na Valorização (R$)</div>
            <div className={`value ${totals.lucroValorizacao < 0 ? "danger" : ""}`}>
              {currencyBR(totals.lucroValorizacao)}
            </div>
          </div>
          <div className="card">
            <div className="klabel">Valorização Atual (%)</div>
            <div className={`value ${totals.valorizacaoAtualPct < 0 ? "danger" : ""}`}>
              {percent2(totals.valorizacaoAtualPct)}
            </div>
          </div>
        </div>

        {/* gráfico donut grande */}
        <div className="mt-6">
          <div className="klabel" style={{ marginBottom: 8 }}>Representação gráfica:</div>
          <div className="chart">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={150}
                  outerRadius={240}
                  startAngle={90}
                  endAngle={450}
                  paddingAngle={0}
                  isAnimationActive={!isExporting}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? BRAND_BLUE : BRAND_ORANGE} />
                  ))}
                </Pie>
                {!isExporting && <Tooltip formatter={(v: number) => currencyBR(v)} />}
              </PieChart>
            </ResponsiveContainer>
            <div style={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center", pointerEvents: "none"
            }}>
              <div style={{ fontWeight: 800, fontSize: 54, color: BRAND_ORANGE }}>
                {percent2(totals.valorizacaoAtualPct)}
              </div>
            </div>
          </div>
        </div>

        {/* tabela (versão relatório) */}
        <div className="mt-6 reportTable shrink">
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
                {rows.map((row, i) => {
                  const pr = parsedRows[i];
                  const e = pr?.errors || {};
                  const ok = !!pr?.validForTotals;
                  const warn = (t: string) => <span className="chip-warn">{t}</span>;

                  return (
                    <tr key={row.id}>
                      <td>{row.empreendimento || warn("Obrigatório")}</td>
                      <td>{row.unidade || warn("Obrigatório")}</td>
                      <td className="num">
                        {ok || isFinite(pr?.valorAquisicao as number)
                          ? currencyBR(pr?.valorAquisicao as number)
                          : warn((e as any).valorAquisicao || "Obrigatório")}
                      </td>
                      <td>{row.dataAquisicao ? formatDateBR(row.dataAquisicao) : warn((e as any).dataAquisicao || "Obrigatório")}</td>
                      <td className="num">
                        {ok || isFinite(pr?.valorAtual as number)
                          ? currencyBR(pr?.valorAtual as number)
                          : warn((e as any).valorAtual || "Obrigatório")}
                      </td>
                      <td className="num">
                        {ok ? <span className={(pr!.valorizacaoPct as number) < 0 ? "danger" : ""}>{percent2(pr!.valorizacaoPct as number)}</span> : <span className="muted">–</span>}
                      </td>
                      <td className="num">
                        {ok ? <span className={(pr!.lucroMes as number) < 0 ? "danger" : ""}>{currencyBR(pr!.lucroMes as number)}</span> : <span className="muted">–</span>}
                      </td>
                      <td className="num">
                        {ok ? <span className={(pr!.lucroPctMes as number) < 0 ? "danger" : ""}>{percent2(pr!.lucroPctMes as number)}</span> : <span className="muted">–</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Nº das unidades: <strong style={{ color: INK }}>{totals.listaSiglas || "–"}</strong>
          </div>
        </div>
      </div>

      <div className="container" style={{ color: MUTED, fontSize: 11, marginTop: 8 }}>
        Regras: linhas incompletas não entram nos totais; aquisição deve ser &gt; 0; data de aquisição
        futura é inválida; dias = máx(1, diferença em dias); moedas e percentuais com 2 casas.
      </div>
    </div>
  );
}
