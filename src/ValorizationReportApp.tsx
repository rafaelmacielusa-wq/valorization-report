import React, { useMemo, useRef, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

/* =====================  Cores / marcas  ===================== */
const COLOR_NAVY = "#0F1B2D";
const COLOR_BORDER = "#E8ECF1";
const COLOR_ORANGE = "#F56A00"; // Diferencial
const COLOR_BICALHO = "#2F78B7"; // azul Bicalho
const COLOR_BG = "#FFFFFF";

/* =====================  Opções de empreendimentos  ===================== */
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

/* =====================  Tipos  ===================== */
type Row = {
  id: number;
  empreendimento: string;
  unidade: string;
  valorAquisicao: string; // guardado com máscara "R$ 0,00"
  dataAquisicao: string; // yyyy-mm-dd
  valorAtual: string; // guardado com máscara "R$ 0,00"
};

type ParsedRow = {
  id: number;
  empreendimento: string;
  unidade: string;
  valorAquisicao: number;
  dataAquisicao: string;
  valorAtual: number;
  dias: number;
  valorizacaoPct: number;
  lucroMes: number;
  lucroPctMes: number;
  validForTotals: boolean;
  errors: Record<string, string>;
};

/* =====================  Helpers  ===================== */
const emptyRow = (id: number): Row => ({
  id,
  empreendimento: "",
  unidade: "",
  valorAquisicao: "R$ 0,00",
  dataAquisicao: "",
  valorAtual: "R$ 0,00",
});

function toDecimal(val: string | number): number {
  if (typeof val === "number") return val;
  if (!val) return NaN;
  // remove tudo que não seja dígito, ponto, vírgula ou sinal
  const cleaned = String(val).replace(/[^\d,.-]/g, "");
  // remove pontos de milhar
  const noThousands = cleaned.replace(/\./g, "");
  // troca vírgula por ponto (decimal)
  const normalized = noThousands.replace(/,/g, ".");
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function maskCurrencyInput(raw: string): string {
  // mantém apenas dígitos
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 0) return "R$ 0,00";
  const int = digits.slice(0, -2);
  const cents = digits.slice(-2).padStart(2, "0");
  const intFmt = (int || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${intFmt},${cents}`;
}

function formatCurrencyBR(n: number): string {
  if (!Number.isFinite(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateBR(yyyyMMdd: string): string {
  if (!yyyyMMdd) return "";
  const [y, m, d] = yyyyMMdd.split("-");
  if (!y || !m || !d) return yyyyMMdd;
  return `${d}/${m}/${y}`;
}

function initialsFromEmp(empreendimento: string): string {
  if (!empreendimento) return "";
  if (/^hol\s*1480/i.test(empreendimento) || /hol\s*1480/i.test(empreendimento)) {
    return "Hol";
  }
  const words = empreendimento
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() || "");
  return words.join("");
}

/* =====================  Componente  ===================== */
export default function ValorizationReportApp() {
  // Cabeçalho
  const [cliente, setCliente] = useState<string>("Pedro");
  const [reportDate, setReportDate] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });

  // Linhas
  const [rows, setRows] = useState<Row[]>([
    emptyRow(1),
    emptyRow(2),
    emptyRow(3),
    emptyRow(4),
  ]);

  const nextId = useMemo(
    () => (rows.length ? Math.max(...rows.map((r) => r.id)) + 1 : 1),
    [rows]
  );

  /* --------- Cálculos por linha (SEM erros TS) --------- */
  const parsedRows = useMemo<ParsedRow[]>(() => {
    const repDate = new Date(reportDate);

    return rows.map((r) => {
      const errors: Record<string, string> = {};
      const hasAllRequired =
        r.empreendimento &&
        r.unidade &&
        r.valorAquisicao !== "" &&
        r.dataAquisicao &&
        r.valorAtual !== "";

      const va = Number(toDecimal(r.valorAquisicao)); // aquisição
      const vc = Number(toDecimal(r.valorAtual)); // atual
      const dAq = r.dataAquisicao ? new Date(r.dataAquisicao) : null;

      if (!r.empreendimento) errors.empreendimento = "Obrigatório";
      if (!r.unidade) errors.unidade = "Obrigatório";
      if (r.valorAquisicao === "") errors.valorAquisicao = "Obrigatório";
      if (r.valorAtual === "") errors.valorAtual = "Obrigatório";
      if (!r.dataAquisicao) errors.dataAquisicao = "Obrigatório";

      let ignore = false;
      if (hasAllRequired) {
        if (!Number.isFinite(va) || va < 0)
          errors.valorAquisicao = "Valor inválido";
        if (!Number.isFinite(vc) || vc < 0) errors.valorAtual = "Valor inválido";
        if (va === 0) {
          errors.valorAquisicao = "Informe o valor de aquisição (>0)";
          ignore = true;
        }
        if (dAq && repDate && dAq > repDate) {
          errors.dataAquisicao = "Data > Relatório. Corrija.";
          ignore = true;
        }
      }

      // DIAS (sempre número)
      let dias = 1;
      if (dAq && repDate && dAq <= repDate) {
        const diffMs = repDate.getTime() - dAq.getTime();
        dias = Math.max(1, Math.floor(diffMs / 86_400_000));
      }

      // CÁLCULOS
      const valorizacaoPct =
        va > 0 && Number.isFinite(vc / va) ? (vc / va - 1) * 100 : NaN;

      const lucroMes =
        Number.isFinite(vc - va) ? (vc - va) / (dias / 30) : NaN;

      const lucroPctMes =
        va > 0 && Number.isFinite(lucroMes / va) ? (lucroMes / va) * 100 : NaN;

      const validForTotals = !!(
        hasAllRequired &&
        !ignore &&
        Number.isFinite(va) &&
        Number.isFinite(vc) &&
        va > 0
      );

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
        errors,
      };
    });
  }, [rows, reportDate]);

  /* --------- Agregados --------- */
  const valid = parsedRows.filter((r) => r.validForTotals);
  const totalUnidades = valid.length;
  const valorContratos = valid.reduce((s, r) => s + r.valorAquisicao, 0);
  const valorAtualImoveis = valid.reduce((s, r) => s + r.valorAtual, 0);
  const lucroValorizacao = valorAtualImoveis - valorContratos;
  const valorizacaoAtualPct =
    valorContratos > 0
      ? ((valorAtualImoveis / valorContratos - 1) * 100)
      : 0;

  // lista ex.: VB1205, LT803 ...
  const listaUnidades = valid
    .map((r) => `${initialsFromEmp(r.empreendimento)}${r.unidade}`)
    .join(", ");

  /* --------- Handlers --------- */
  function handleRowChange(
    id: number,
    field: keyof Row,
    value: string
  ) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, [field]: value } : r
      )
    );
  }

  function removeRow(id: number) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow(nextId)]);
  }

  function addExamples() {
    const today = new Date();
    const y = today.getFullYear();
    const pad = (n: number) => String(n).padStart(2, "0");

    const mkDate = (yyyy: number, mm: number, dd: number) =>
      `${yyyy}-${pad(mm)}-${pad(dd)}`;

    setRows([
      {
        id: 1,
        empreendimento: "Vértice Barigui",
        unidade: "1205",
        valorAquisicao: maskCurrencyInput("17000000"),
        dataAquisicao: mkDate(y - 1, 6, 15),
        valorAtual: maskCurrencyInput("21000000"),
      },
      {
        id: 2,
        empreendimento: "Legacy Tower",
        unidade: "803",
        valorAquisicao: maskCurrencyInput("22000000"),
        dataAquisicao: mkDate(y - 1, 11, 1),
        valorAtual: maskCurrencyInput("26000000"),
      },
      {
        id: 3,
        empreendimento: "Yacht Tower",
        unidade: "1907",
        valorAquisicao: maskCurrencyInput("15000000"),
        dataAquisicao: mkDate(y, 12, 10),
        valorAtual: maskCurrencyInput("16500000"),
      },
      {
        id: 4,
        empreendimento: "Infinity Tower",
        unidade: "305",
        valorAquisicao: maskCurrencyInput("30000000"),
        dataAquisicao: mkDate(y, 3, 1),
        valorAtual: maskCurrencyInput("31500000"),
      },
    ]);
  }

  /* --------- Exportar PDF --------- */
  const pdfRef = useRef<HTMLDivElement>(null);

  async function exportPDF() {
    if (!pdfRef.current) return;
    const node = pdfRef.current;

    const canvas = await html2canvas(node, {
      backgroundColor: COLOR_BG,
      scale: 2,
      useCORS: true,
    });

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // dimensiona mantendo proporção
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let y = 0;
    if (imgHeight <= pageHeight) {
      pdf.addImage(imgData, "PNG", 0, y, imgWidth, imgHeight);
    } else {
      // paginar se for mais alto
      let remaining = imgHeight;
      let position = 0;
      while (remaining > 0) {
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        remaining -= pageHeight;
        if (remaining > 0) {
          pdf.addPage();
          position -= pageHeight;
        }
      }
    }

    pdf.save("relatorio_valorizacao.pdf");
  }

  /* --------- Gráfico (rosca) --------- */
  const donutData = [
    { name: "Valor Total de Contratos (R$)", value: Math.max(valorContratos, 0) },
    { name: "Lucro na Valorização (R$)", value: Math.max(lucroValorizacao, 0) },
  ];
  const donutColors = [COLOR_BICALHO, COLOR_ORANGE];

  /* =====================  UI  ===================== */
  return (
    <div
      style={{
        fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial",
        color: COLOR_NAVY,
        background: COLOR_BG,
        minHeight: "100vh",
      }}
    >
      <style>{`
        .container { max-width: 980px; margin: 0 auto; padding: 24px; }
        .card { border: 1px solid ${COLOR_BORDER}; background: #fff; border-radius: 12px; padding: 18px 20px; }
        .h-label { font-size: 12px; letter-spacing: .08em; color: #5F6B7A; margin-bottom: 8px; text-transform: uppercase; }
        .h-value { font-weight: 800; font-size: 22px; }
        .big-value { font-weight: 900; font-size: 34px; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
        .line { height: 8px; border-radius: 8px; background: linear-gradient(90deg, ${COLOR_ORANGE}, ${COLOR_NAVY}, ${COLOR_BICALHO}); opacity: .9; }
        table { width: 100%; border-collapse: separate; border-spacing: 0 10px; }
        th { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #5F6B7A; text-align: left; padding: 6px 10px; }
        td { padding: 6px 10px; }
        .row { background: #F9FAFB; border: 1px solid ${COLOR_BORDER}; border-radius: 10px; }
        .invalid { outline: 2px solid #E74C3C; outline-offset: -2px; border-radius: 6px; }
        .money-input { width: 100%; border: 1px solid ${COLOR_BORDER}; border-radius: 8px; padding: 10px 12px; font-weight: 600; }
        .text-input  { width: 100%; border: 1px solid ${COLOR_BORDER}; border-radius: 8px; padding: 10px 12px; }
        .select-input{ width: 100%; border: 1px solid ${COLOR_BORDER}; border-radius: 8px; padding: 10px 12px; background: #fff; }
        .actions { display: flex; gap: 10px; flex-wrap: wrap; }
        .btn { border: none; border-radius: 10px; padding: 10px 14px; font-weight: 700; cursor: pointer; }
        .btn-primary { background: ${COLOR_BICALHO}; color: #fff; }
        .btn-secondary { background: #EDF2F7; color: ${COLOR_NAVY}; }
        .logos { display:flex; align-items:center; justify-content:space-between; margin-top: 16px; }
        .logos img { height: 68px; object-fit: contain; }
        .divider { border-bottom: 3px solid ${COLOR_NAVY}; opacity: .7; margin: 8px 0 16px; }
        .footer-note { margin-top: 10px; font-size: 12px; color:#5F6B7A; }
        .pdf-table { border: 1px solid #000; border-radius: 10px; overflow: hidden; }
        .pdf-table table { border-collapse: collapse; border-spacing: 0; }
        .pdf-table th { background: #253246; color: #fff; padding: 10px; }
        .pdf-table td { border-top: 1px solid #000; border-left: 1px solid #000; padding: 10px; }
        .pdf-table tr td:first-child { border-left: none; }
      `}</style>

      <div className="container" ref={pdfRef}>
        {/* linha topo */}
        <div className="line" />

        {/* cabeçalho com logos e título */}
        <div className="logos">
          <img src="/logos/diferencial.png" alt="Diferencial" />
          <h1 style={{ fontSize: 36, letterSpacing: ".04em" }}>VALORIZAÇÃO</h1>
          <img src="/logos/bicalho.png" alt="Bicalho" />
        </div>

        {/* Valor total destacado */}
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <div className="h-label">Valor Total de Contratos (R$)</div>
          <div className="big-value">{formatCurrencyBR(valorContratos)}</div>
        </div>

        {/* linha separadora */}
        <div className="divider" />

        {/* Infos cliente / unidades / data */}
        <div className="grid-3" style={{ marginBottom: 16 }}>
          <div>
            <div className="h-label">Cliente</div>
            <div className="h-value">{cliente || "—"}</div>
          </div>

          <div>
            <div className="h-label">Total de Unidades</div>
            <div className="h-value">
              {String(totalUnidades).padStart(2, "0")}{" "}
              {listaUnidades ? ` — ${listaUnidades}` : ""}
            </div>
          </div>

          <div>
            <div className="h-label">Relatório do dia</div>
            <div className="h-value">{formatDateBR(reportDate)}</div>
          </div>
        </div>

        {/* Cards resumo */}
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="h-label">Valor Atual Imóveis (R$)</div>
          <div className="h-value">{formatCurrencyBR(valorAtualImoveis)}</div>
        </div>
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="h-label">Lucro na Valorização (R$)</div>
          <div className="h-value">{formatCurrencyBR(lucroValorizacao)}</div>
        </div>
        <div className="card" style={{ marginBottom: 28 }}>
          <div className="h-label">Valorização Atual (%)</div>
          <div className="h-value">
            {Number.isFinite(valorizacaoAtualPct)
              ? `${valorizacaoAtualPct.toFixed(2)}%`
              : "—"}
          </div>
        </div>

        {/* Gráfico (rosca grande) */}
        <div className="card" style={{ padding: 24, marginBottom: 24 }}>
          <div style={{ width: "100%", height: 360 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="60%"
                  outerRadius="85%"
                  paddingAngle={2}
                  stroke="#fff"
                  strokeWidth={2}
                >
                  {donutData.map((entry, idx) => (
                    <Cell key={idx} fill={donutColors[idx % donutColors.length]} />
                  ))}
                </Pie>
                {/* % central em laranja */}
                <text
                  x="50%"
                  y="50%"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={28}
                  fontWeight={900}
                  fill={COLOR_ORANGE}
                >
                  {Number.isFinite(valorizacaoAtualPct)
                    ? `${valorizacaoAtualPct.toFixed(2)}%`
                    : "—"}
                </text>
                <Legend verticalAlign="bottom" />
                <Tooltip
                  formatter={(v: number) => formatCurrencyBR(v)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Editor (não sai no PDF) */}
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="h-label">Editor de unidades (não aparece no PDF)</div>
          <table>
            <thead>
              <tr>
                <th>Empreendimento</th>
                <th>Unidade</th>
                <th>Valor do imóvel na aquisição (R$)</th>
                <th>Aquisição (Data de aquisição)</th>
                <th>Valor atual (R$)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pr = parsedRows.find((p) => p.id === r.id);
                const e = pr?.errors || {};
                return (
                  <tr key={r.id} className="row">
                    <td>
                      <select
                        className={`select-input ${e.empreendimento ? "invalid" : ""}`}
                        value={r.empreendimento}
                        onChange={(ev) =>
                          handleRowChange(r.id, "empreendimento", ev.target.value)
                        }
                      >
                        <option value="">Selecione...</option>
                        {EMP_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className={`text-input ${e.unidade ? "invalid" : ""}`}
                        placeholder="Ex.: 1205"
                        value={r.unidade}
                        onChange={(ev) => handleRowChange(r.id, "unidade", ev.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className={`money-input ${e.valorAquisicao ? "invalid" : ""}`}
                        inputMode="numeric"
                        value={r.valorAquisicao}
                        onChange={(ev) =>
                          handleRowChange(
                            r.id,
                            "valorAquisicao",
                            maskCurrencyInput(ev.target.value)
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        className={`text-input ${e.dataAquisicao ? "invalid" : ""}`}
                        type="date"
                        value={r.dataAquisicao}
                        onChange={(ev) =>
                          handleRowChange(r.id, "dataAquisicao", ev.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        className={`money-input ${e.valorAtual ? "invalid" : ""}`}
                        inputMode="numeric"
                        value={r.valorAtual}
                        onChange={(ev) =>
                          handleRowChange(
                            r.id,
                            "valorAtual",
                            maskCurrencyInput(ev.target.value)
                          )
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="btn btn-secondary"
                        onClick={() => removeRow(r.id)}
                        title="Remover linha"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={addRow}>
              + Adicionar linha
            </button>
            <button className="btn btn-secondary" onClick={addExamples}>
              Adicionar 4 unidades de exemplo
            </button>
          </div>
        </div>

        {/* Tabela final para PDF (contornos pretos e cabeçalho escuro) */}
        <div className="pdf-table">
          <table>
            <thead>
              <tr>
                <th>Empreendimento</th>
                <th>Unidade</th>
                <th>Valor do imóvel na aquisição (R$)</th>
                <th>Aquisição (Data de aquisição)</th>
                <th>Valor atual (R$)</th>
                <th>% de valorização</th>
                <th>Lucro líquido ao mês (R$/mês)</th>
                <th>% Lucro líquido</th>
              </tr>
            </thead>
            <tbody>
              {parsedRows.map((r) => {
                const na = (x: number) =>
                  Number.isFinite(x) ? x : NaN;

                const pct = na(r.valorizacaoPct);
                const luc = na(r.lucroMes);
                const pctMes = na(r.lucroPctMes);

                return (
                  <tr key={r.id}>
                    <td>{r.empreendimento || "—"}</td>
                    <td>{r.unidade || "—"}</td>
                    <td>{formatCurrencyBR(r.valorAquisicao)}</td>
                    <td>{formatDateBR(r.dataAquisicao)}</td>
                    <td>{formatCurrencyBR(r.valorAtual)}</td>
                    <td>{Number.isFinite(pct) ? `${pct.toFixed(2)}%` : "—"}</td>
                    <td>{Number.isFinite(luc) ? formatCurrencyBR(luc) : "—"}</td>
                    <td>{Number.isFinite(pctMes) ? `${pctMes.toFixed(2)}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Rodapé com lista de unidades */}
        <div className="footer-note">
          Nº das unidades: {listaUnidades || "—"}
        </div>

        {/* Ações */}
        <div className="actions" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" onClick={exportPDF}>
            Exportar PDF
          </button>
        </div>
      </div>
    </div>
  );
}
