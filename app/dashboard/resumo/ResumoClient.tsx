"use client";

import { useEffect, useMemo, useState } from "react";

type Points = { latam: number; smiles: number; livelo: number; esfera: number };

type Snapshot = {
  id: string;
  date: string;
  totalBruto: number;
  totalDividas: number;
  totalLiquido: number;
};

type ReceberStatus = "OPEN" | "PARTIAL" | "PAID" | "CANCELED";
type DividaAReceberRow = {
  id: string;
  status?: ReceberStatus | string | null;
  totalCents?: number | null;
  receivedCents?: number | null;
};

// ✅ shape do backend (igual ao Caixa Imediato)
type DARResponse = {
  ok: boolean;
  rows?: DividaAReceberRow[];
  totalsAll?: { totalCents: number; receivedCents: number; balanceCents: number };
  totalsOpen?: { totalCents: number; receivedCents: number; balanceCents: number }; // OPEN+PARTIAL
  error?: string;
};

function fmtMoneyBR(cents: number) {
  const v = (cents || 0) / 100;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtInt(n: number) {
  return new Intl.NumberFormat("pt-BR").format(n || 0);
}
function dateBR(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR");
}
function toCentsFromInput(s: string) {
  const cleaned = (s || "").trim();
  if (!cleaned) return 0;
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
function centsToRateInput(cents: number) {
  const v = (Number(cents || 0) / 100).toFixed(2);
  return v.replace(".", ",");
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="space-y-1">
      <div className="text-xs text-slate-600">{label}</div>
      <input
        className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger" | "dark";
}) {
  const base = "rounded-2xl border p-4";
  const cls =
    tone === "dark"
      ? `${base} bg-black text-white`
      : tone === "danger"
      ? `${base} bg-slate-50`
      : `${base} bg-slate-50`;

  return (
    <div className={cls}>
      <div className={tone === "dark" ? "text-xs opacity-80" : "text-xs text-slate-600"}>
        {label}
      </div>
      <div className={tone === "dark" ? "text-2xl font-bold" : "text-xl font-bold"}>
        {value}
      </div>
      {hint ? (
        <div className={tone === "dark" ? "text-xs opacity-70 mt-1" : "text-xs text-slate-500 mt-1"}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

// ✅ fallback (caso totalsOpen não venha)
function computeDividasAReceberOpenCents(list: DividaAReceberRow[]) {
  let sum = 0;

  for (const r of list || []) {
    const status = String(r?.status || "").toUpperCase();
    if (status === "CANCELED") continue; // ignora canceladas

    const total = Math.max(0, Number(r?.totalCents ?? 0) || 0);
    const received = Math.max(0, Number(r?.receivedCents ?? 0) || 0);
    const remaining = total - received;

    if (remaining > 0) sum += remaining;
  }

  return sum;
}

export default function CedentesResumoClient() {
  const [loading, setLoading] = useState(false);

  const [points, setPoints] = useState<Points>({
    latam: 0,
    smiles: 0,
    livelo: 0,
    esfera: 0,
  });

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [cashInput, setCashInput] = useState<string>("");

  const [debtsOpenCents, setDebtsOpenCents] = useState<number>(0);

  // ✅ comissões pendentes (cedentes)
  const [pendingCedenteCommissionsCents, setPendingCedenteCommissionsCents] = useState<number>(0);

  // ✅ recebimentos em aberto (A RECEBER - vendas)
  const [receivablesOpenCents, setReceivablesOpenCents] = useState<number>(0);

  // ✅ dívidas a receber (OPEN+PARTIAL pelo totalsOpen.balanceCents)
  const [dividasAReceberOpenCents, setDividasAReceberOpenCents] = useState<number>(0);

  // ✅ a pagar funcionários (pendente)
  const [employeePayoutsPendingCents, setEmployeePayoutsPendingCents] = useState<number>(0);

  // ✅ impostos pendentes (mês não pago)
  const [taxesPendingCents, setTaxesPendingCents] = useState<number>(0);

  // ✅ opcional: se o backend mandar pronto, usamos (senão calculamos)
  const [cashProjectedFromApiCents, setCashProjectedFromApiCents] = useState<number | null>(null);

  const [rateLatam, setRateLatam] = useState("20,00");
  const [rateSmiles, setRateSmiles] = useState("18,00");
  const [rateLivelo, setRateLivelo] = useState("22,00");
  const [rateEsfera, setRateEsfera] = useState("17,00");

  const [didLoad, setDidLoad] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [rResumo, rDAR] = await Promise.all([
        fetch("/api/resumo", { cache: "no-store" }),
        // ✅ se teu endpoint suportar, pode reduzir payload (totalsOpen continua vindo)
        fetch("/api/dividas-a-receber?take=1", { cache: "no-store" }),
      ]);

      const j = await rResumo.json();
      const jDAR = (await rDAR.json()) as DARResponse;

      if (!j?.ok) throw new Error(j?.error || "Erro ao carregar resumo");
      if (!jDAR?.ok) throw new Error(jDAR?.error || "Erro ao carregar dívidas a receber");

      setPoints(j.data.points);
      setSnapshots(j.data.snapshots);

      const latestCashCents = Number(j.data.latestCashCents ?? 0);
      setCashInput(String((latestCashCents / 100).toFixed(2)).replace(".", ","));

      const rates = j.data.ratesCents;
      if (rates) {
        setRateLatam(centsToRateInput(rates.latamRateCents));
        setRateSmiles(centsToRateInput(rates.smilesRateCents));
        setRateLivelo(centsToRateInput(rates.liveloRateCents));
        setRateEsfera(centsToRateInput(rates.esferaRateCents));
      }

      setDebtsOpenCents(Number(j.data.debtsOpenCents || 0));
      setPendingCedenteCommissionsCents(Number(j.data.pendingCedenteCommissionsCents || 0));
      setReceivablesOpenCents(Number(j.data.receivablesOpenCents || 0));

      setEmployeePayoutsPendingCents(Number(j.data.employeePayoutsPendingCents || 0));
      setTaxesPendingCents(Number(j.data.taxesPendingCents || 0));

      const apiProjected = j.data.cashProjectedCents;
      setCashProjectedFromApiCents(apiProjected == null ? null : Number(apiProjected || 0));

      /**
       * ✅ DÍVIDAS A RECEBER:
       * Igual ao Caixa Imediato:
       * usa totalsOpen.balanceCents (OPEN+PARTIAL).
       * Se não vier, faz fallback pelos rows.
       */
      const darOpen = Number(jDAR?.totalsOpen?.balanceCents ?? NaN);
      if (Number.isFinite(darOpen)) {
        setDividasAReceberOpenCents(darOpen);
      } else {
        const rows = Array.isArray(jDAR?.rows) ? jDAR.rows : [];
        setDividasAReceberOpenCents(computeDividasAReceberOpenCents(rows));
      }

      setDidLoad(true);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function salvarRates() {
    const res = await fetch("/api/resumo/rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latam: rateLatam,
        smiles: rateSmiles,
        livelo: rateLivelo,
        esfera: rateEsfera,
      }),
    });
    const j = await res.json();
    if (!j?.ok) throw new Error(j?.error || "Erro ao salvar milheiros");
  }

  useEffect(() => {
    if (!didLoad) return;
    const t = setTimeout(() => {
      salvarRates().catch(() => {});
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateLatam, rateSmiles, rateLivelo, rateEsfera, didLoad]);

  const calc = useMemo(() => {
    const milLatam = Math.floor((points.latam || 0) / 1000);
    const milSmiles = Math.floor((points.smiles || 0) / 1000);
    const milLivelo = Math.floor((points.livelo || 0) / 1000);
    const milEsfera = Math.floor((points.esfera || 0) / 1000);

    const rLatam = Number(String(rateLatam).replace(",", ".")) || 0;
    const rSmiles = Number(String(rateSmiles).replace(",", ".")) || 0;
    const rLivelo = Number(String(rateLivelo).replace(",", ".")) || 0;
    const rEsfera = Number(String(rateEsfera).replace(",", ".")) || 0;

    const vLatamCents = Math.round(milLatam * rLatam * 100);
    const vSmilesCents = Math.round(milSmiles * rSmiles * 100);
    const vLiveloCents = Math.round(milLivelo * rLivelo * 100);
    const vEsferaCents = Math.round(milEsfera * rEsfera * 100);

    const cashCents = toCentsFromInput(cashInput);

    const receivableSalesCents = Number(receivablesOpenCents || 0);
    const receivableDARcents = Number(dividasAReceberOpenCents || 0);

    const totalGrossCents =
      vLatamCents +
      vSmilesCents +
      vLiveloCents +
      vEsferaCents +
      cashCents +
      receivableSalesCents +
      receivableDARcents;

    const totalNetCents = totalGrossCents - (debtsOpenCents || 0);

    const totalAfterPendingsCents =
      totalNetCents -
      (pendingCedenteCommissionsCents || 0) -
      (employeePayoutsPendingCents || 0) -
      (taxesPendingCents || 0);

    const cashProjectedCalcCents =
      cashCents +
      receivableSalesCents +
      receivableDARcents -
      (employeePayoutsPendingCents || 0) -
      (taxesPendingCents || 0);

    const cashProjectedCents =
      cashProjectedFromApiCents != null ? cashProjectedFromApiCents : cashProjectedCalcCents;

    return {
      milLatam,
      milSmiles,
      milLivelo,
      milEsfera,
      vLatamCents,
      vSmilesCents,
      vLiveloCents,
      vEsferaCents,
      cashCents,

      receivableSalesCents,
      receivableDARcents,

      totalGrossCents,
      totalNetCents,
      totalAfterPendingsCents,
      cashProjectedCents,
    };
  }, [
    points,
    rateLatam,
    rateSmiles,
    rateLivelo,
    rateEsfera,
    cashInput,
    debtsOpenCents,
    pendingCedenteCommissionsCents,
    receivablesOpenCents,
    dividasAReceberOpenCents,
    employeePayoutsPendingCents,
    taxesPendingCents,
    cashProjectedFromApiCents,
  ]);

  async function salvarCaixaHoje() {
    try {
      const res = await fetch("/api/resumo/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cashCents: calc.cashCents,
          totalBrutoCents: calc.totalGrossCents, // ✅ bruto inclui DAR
          totalDividasCents: debtsOpenCents,
          totalLiquidoCents: calc.totalNetCents, // ✅ bruto − dívidas
        }),
      });

      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "Erro ao salvar snapshot");
      await load();
      alert("✅ Snapshot do dia salvo!");
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Resumo</h1>
          <p className="text-sm text-slate-600">
            Patrimônio estimado: milhas (por milheiro) + caixa + a receber (vendas) + dívidas a receber − dívidas −
            pendências (comissões/funcionários/impostos).
          </p>
        </div>

        <button
          onClick={load}
          className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      {/* Top cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Milhas */}
        <div className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Milhas atuais</div>
            <span className="text-[11px] rounded-full bg-slate-100 px-2 py-1 text-slate-600">
              somatório cedentes
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 text-sm">
            <div>
              LATAM: <b>{fmtInt(points.latam)}</b>
            </div>
            <div>
              Smiles: <b>{fmtInt(points.smiles)}</b>
            </div>
            <div>
              Livelo: <b>{fmtInt(points.livelo)}</b>
            </div>
            <div>
              Esfera: <b>{fmtInt(points.esfera)}</b>
            </div>
          </div>

          <div className="text-xs text-slate-600">
            * cálculo usa milheiros inteiros (pontos/1000 arredondado para baixo).
          </div>
        </div>

        {/* Caixa */}
        <div className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Caixa (Inter)</div>
            <span className="text-[11px] rounded-full bg-slate-100 px-2 py-1 text-slate-600">
              snapshot diário
            </span>
          </div>

          <Input label="Saldo atual (R$)" value={cashInput} onChange={setCashInput} placeholder="Ex: 12345,67" />

          <div className="rounded-xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Caixa projetado</div>
            <div className="text-xl font-bold">{fmtMoneyBR(calc.cashProjectedCents)}</div>
            <div className="text-xs text-slate-500 mt-1">
              caixa + a receber (vendas) + dívidas a receber − (a pagar funcionários + impostos)
            </div>
          </div>

          <button
            onClick={salvarCaixaHoje}
            className="w-full rounded-xl bg-black px-4 py-2 text-white text-sm hover:bg-gray-800"
          >
            Salvar caixa de hoje
          </button>

          <div className="text-xs text-slate-600">Grava/atualiza o snapshot do dia no histórico.</div>
        </div>

        {/* Pendências */}
        <div className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Pendências</div>
            <span className="text-[11px] rounded-full bg-slate-100 px-2 py-1 text-slate-600">
              a pagar
            </span>
          </div>

          <div className="grid gap-2">
            <div className="rounded-xl border bg-slate-50 p-3">
              <div className="text-xs text-slate-600">Comissões (cedentes)</div>
              <div className="text-xl font-bold">{fmtMoneyBR(pendingCedenteCommissionsCents)}</div>
              <div className="text-xs text-slate-500 mt-1">
                soma status <b>PENDING</b>
              </div>
            </div>

            <div className="rounded-xl border bg-slate-50 p-3">
              <div className="text-xs text-slate-600">A pagar (funcionários)</div>
              <div className="text-xl font-bold">{fmtMoneyBR(employeePayoutsPendingCents)}</div>
              <div className="text-xs text-slate-500 mt-1">
                netPay pendente + comissão de balcão pendente
              </div>
            </div>

            <div className="rounded-xl border bg-slate-50 p-3">
              <div className="text-xs text-slate-600">Impostos pendentes</div>
              <div className="text-xl font-bold">{fmtMoneyBR(taxesPendingCents)}</div>
              <div className="text-xs text-slate-500 mt-1">meses ainda não marcados como pagos</div>
            </div>
          </div>

          <div className="text-xs text-slate-600">Esses valores entram no “líquido (referência)”.</div>
        </div>
      </div>

      {/* Milheiro */}
      <div className="rounded-2xl border bg-white p-4 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold">Valor do milheiro</div>
            <div className="text-xs text-slate-600">R$/1000</div>
          </div>

          <button
            onClick={async () => {
              try {
                await salvarRates();
                alert("✅ Milheiros salvos!");
              } catch (e: any) {
                alert(e.message);
              }
            }}
            className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50"
          >
            Salvar milheiros
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="LATAM" value={rateLatam} onChange={setRateLatam} />
          <Input label="Smiles" value={rateSmiles} onChange={setRateSmiles} />
          <Input label="Livelo" value={rateLivelo} onChange={setRateLivelo} />
          <Input label="Esfera" value={rateEsfera} onChange={setRateEsfera} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border p-3">
            <div className="text-xs text-slate-600">LATAM</div>
            <div className="text-sm">
              Milheiros: <b>{fmtInt(calc.milLatam)}</b> • Valor: <b>{fmtMoneyBR(calc.vLatamCents)}</b>
            </div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-slate-600">Smiles</div>
            <div className="text-sm">
              Milheiros: <b>{fmtInt(calc.milSmiles)}</b> • Valor: <b>{fmtMoneyBR(calc.vSmilesCents)}</b>
            </div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-slate-600">Livelo</div>
            <div className="text-sm">
              Milheiros: <b>{fmtInt(calc.milLivelo)}</b> • Valor: <b>{fmtMoneyBR(calc.vLiveloCents)}</b>
            </div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-slate-600">Esfera</div>
            <div className="text-sm">
              Milheiros: <b>{fmtInt(calc.milEsfera)}</b> • Valor: <b>{fmtMoneyBR(calc.vEsferaCents)}</b>
            </div>
          </div>
        </div>

        {/* Totais */}
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="TOTAL BRUTO (milhas + caixa + a receber + dívidas a receber)" value={fmtMoneyBR(calc.totalGrossCents)} />
          <StatCard label="A RECEBER (Vendas)" value={`+${fmtMoneyBR(calc.receivableSalesCents)}`} hint="saldo total OPEN (vendas)" />
          <StatCard label="DÍVIDAS A RECEBER" value={`+${fmtMoneyBR(calc.receivableDARcents)}`} hint="totalsOpen.balanceCents (OPEN+PARTIAL)" />
          <StatCard label="DÍVIDAS EM ABERTO" value={`-${fmtMoneyBR(debtsOpenCents)}`} hint="saldo total OPEN" tone="danger" />
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="LÍQUIDO (snapshot)" value={fmtMoneyBR(calc.totalNetCents)} hint="bruto − dívidas (o que você salva)" />
          <StatCard
            label="COMISSÕES PENDENTES (cedentes)"
            value={`-${fmtMoneyBR(pendingCedenteCommissionsCents)}`}
            hint="status PENDING"
            tone="danger"
          />
          <StatCard
            label="A PAGAR (funcionários)"
            value={`-${fmtMoneyBR(employeePayoutsPendingCents)}`}
            hint="netPay pendente + comissão balcão"
            tone="danger"
          />
          <StatCard label="IMPOSTOS PENDENTES" value={`-${fmtMoneyBR(taxesPendingCents)}`} hint="meses não pagos" tone="danger" />
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <StatCard
            label="LÍQUIDO (referência)"
            value={fmtMoneyBR(calc.totalAfterPendingsCents)}
            hint="snapshot − comissões − func − impostos"
            tone="dark"
          />
        </div>

        <div className="text-xs text-slate-600">
          * O snapshot diário continua salvando <b>bruto − dívidas</b>. O “líquido (referência)” é um indicador operacional.
        </div>
      </div>

      {/* Histórico */}
      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="font-semibold">Histórico do caixa (por dia)</div>
          <div className="text-xs text-slate-500">últimos {Math.min(60, snapshots.length)} dias</div>
        </div>

        {snapshots.length === 0 ? (
          <div className="text-sm text-slate-600">Nenhum snapshot salvo ainda.</div>
        ) : (
          <div className="max-h-80 overflow-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Dia</th>
                  <th className="px-3 py-2 text-right">Total líquido (snapshot)</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="px-3 py-2">{dateBR(s.date)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoneyBR(s.totalLiquido)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="text-xs text-slate-600">
          Se quiser “automático no fim do dia”, dá pra colocar um Cron na Vercel chamando um endpoint.
        </div>
      </div>
    </div>
  );
}
