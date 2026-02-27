"use client";

import { useEffect, useMemo, useState } from "react";

type Mode = "latam" | "smiles";
type ManualStatus = "CANCELADO" | "CONFIRMADO" | "ALTERADO";

type RowBase = {
  id: string;
  numero: string;
  locator: string | null;
  firstPassengerLastName: string | null;
  departureDate: string | null;
  returnDate: string | null;
  createdAt: string;
  cedente: { identificador: string; nomeCompleto: string };
  checkUrl?: string;
  latamLocatorCheckStatus?: string | null;
  latamLocatorCheckedAt?: string | null;
  latamLocatorCheckNote?: string | null;
};

type LatamRow = RowBase & {
  purchaseCode: string | null;
};

type SmilesRow = RowBase & {
  departureAirportIata: string | null;
};

function fmtDateBR(v?: string | null) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("pt-BR");
}

function nextFlightLabel(v1?: string | null, v2?: string | null) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const items = [
    { label: "Ida", v: v1 },
    { label: "Volta", v: v2 },
  ]
    .map((x) => {
      const dt = x.v ? new Date(x.v) : null;
      return dt && !Number.isNaN(dt.getTime()) ? { label: x.label, ms: dt.getTime() } : null;
    })
    .filter((x): x is { label: string; ms: number } => x != null);

  if (!items.length) return "-";

  const upcoming = items.filter((x) => x.ms >= todayMs);
  const chosen = upcoming.length
    ? upcoming.sort((a, b) => a.ms - b.ms)[0]
    : items.sort((a, b) => Math.abs(a.ms - todayMs) - Math.abs(b.ms - todayMs))[0];

  return `${chosen.label} (${new Date(chosen.ms).toLocaleDateString("pt-BR")})`;
}

function statusLabel(v?: string | null) {
  if (!v) return "Não definido";
  if (v === "CONFIRMADO") return "Confirmado";
  if (v === "CANCELADO") return "Cancelado";
  if (v === "ALTERADO") return "Alterado";
  return v;
}

function statusClass(v?: string | null) {
  if (v === "CONFIRMADO") return "text-emerald-700";
  if (v === "ALTERADO") return "text-amber-600";
  if (v === "CANCELADO") return "text-rose-700";
  return "text-slate-700";
}

export default function CheckLocalizadorClient({ mode }: { mode: Mode }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Array<LatamRow | SmilesRow>>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    fetch(`/api/check-localizador/${mode}`, {
      cache: "no-store",
      credentials: "include",
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j?.ok === false) throw new Error(j?.error || `Erro ${r.status}`);
        if (!active) return;
        setRows(Array.isArray(j?.rows) ? j.rows : []);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setRows([]);
        const msg =
          e instanceof Error && e.message ? e.message : "Erro ao carregar dados.";
        setError(msg);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [mode]);

  const title = useMemo(
    () => (mode === "latam" ? "Check Localizador - Latam" : "Check Localizador - Smiles"),
    [mode]
  );
  const totalCols = mode === "latam" ? 10 : 8;

  async function updateManualStatus(saleId: string, status: ManualStatus) {
    setSavingId(saleId);
    try {
      const res = await fetch("/api/check-localizador/latam", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saleId, status }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j?.ok === false) {
        throw new Error(j?.error || `Erro ${res.status}`);
      }

      const row = j?.row || null;
      if (row?.id) {
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id
              ? {
                  ...r,
                  latamLocatorCheckStatus: row.latamLocatorCheckStatus || null,
                  latamLocatorCheckedAt: row.latamLocatorCheckedAt || null,
                  latamLocatorCheckNote: row.latamLocatorCheckNote || null,
                }
              : r
          )
        );
      }
    } catch (e: unknown) {
      const msg =
        e instanceof Error && e.message ? e.message : "Falha ao atualizar status.";
      alert(msg);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-slate-500">
          Ordenado por proximidade do próximo voo (ida ou volta).
        </p>
      </div>

      {error ? <div className="text-sm text-rose-600">{error}</div> : null}

      <div className="rounded-2xl border bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Próximo voo</th>
              {mode === "latam" ? <th className="px-3 py-2 text-left">Código compra</th> : null}
              <th className="px-3 py-2 text-left">Localizador</th>
              <th className="px-3 py-2 text-left">Sobrenome</th>
              {mode === "smiles" ? <th className="px-3 py-2 text-left">Aeroporto ida</th> : null}
              <th className="px-3 py-2 text-left">Data ida</th>
              <th className="px-3 py-2 text-left">Data volta</th>
              <th className="px-3 py-2 text-left">Cedente</th>
              {mode === "latam" ? <th className="px-3 py-2 text-left">Status</th> : null}
              {mode === "latam" ? <th className="px-3 py-2 text-left">Ação</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-3 py-6 text-slate-500" colSpan={totalCols}>
                  Carregando...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-slate-500" colSpan={totalCols}>
                  Nenhum registro encontrado.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">{nextFlightLabel(r.departureDate, r.returnDate)}</td>
                  {mode === "latam" ? (
                    <td className="px-3 py-2 font-mono">{(r as LatamRow).purchaseCode || "-"}</td>
                  ) : null}
                  <td className="px-3 py-2 font-mono">{r.locator || "-"}</td>
                  <td className="px-3 py-2">{r.firstPassengerLastName || "-"}</td>
                  {mode === "smiles" ? (
                    <td className="px-3 py-2 font-mono">{(r as SmilesRow).departureAirportIata || "-"}</td>
                  ) : null}
                  <td className="px-3 py-2">{fmtDateBR(r.departureDate)}</td>
                  <td className="px-3 py-2">{fmtDateBR(r.returnDate)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.cedente?.nomeCompleto || "-"}</div>
                    <div className="text-xs text-slate-500">{r.cedente?.identificador || "-"}</div>
                  </td>
                  {mode === "latam" ? (
                    <td className="px-3 py-2">
                      <div className={`font-medium ${statusClass(r.latamLocatorCheckStatus)}`}>
                        {statusLabel(r.latamLocatorCheckStatus)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {fmtDateBR(r.latamLocatorCheckedAt)}
                      </div>
                      {r.latamLocatorCheckNote ? (
                        <div className="text-xs text-slate-500 mt-1 max-w-[280px] break-words">
                          {r.latamLocatorCheckNote}
                        </div>
                      ) : null}
                    </td>
                  ) : null}
                  {mode === "latam" ? (
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2 items-center">
                        <a
                          href={r.checkUrl || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-50"
                        >
                          Abrir LATAM
                        </a>
                        <select
                          className="rounded-lg border px-2 py-1 text-xs bg-white"
                          value={(r.latamLocatorCheckStatus || "") as string}
                          disabled={savingId === r.id}
                          onChange={(e) => {
                            const v = String(e.target.value || "") as ManualStatus;
                            if (!v) return;
                            updateManualStatus(r.id, v);
                          }}
                        >
                          <option value="">Selecionar...</option>
                          <option value="CANCELADO">Cancelado</option>
                          <option value="CONFIRMADO">Confirmado</option>
                          <option value="ALTERADO">Alterado</option>
                        </select>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
