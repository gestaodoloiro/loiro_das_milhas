"use client";

import { useMemo, useState } from "react";

type Program = "LATAM" | "SMILES" | "LIVELO" | "ESFERA";
type Mode = "AVAILABILITY" | "CLUB" | "COMBINED" | "BIRTHDAY_TURBO";

type ClubStatus = "ACTIVE" | "PAUSED" | "CANCELED" | "NONE";

type Owner = { id: string; name: string; login: string };

type ResultRow = {
  cedenteId: string;
  cedenteNome: string;
  cedenteIdentificador?: string | null;

  cia: Program | null;     // LATAM/SMILES (ou null se não aplicável)
  bank: Program | null;    // LIVELO/ESFERA (ou null se não aplicável)

  ciaPoints: number;
  bankPoints: number;

  paxAvailable: number | null;
  cpfsAvailable: number | null;

  clubStatus: ClubStatus;
  clubPlan: string | null;

  score: number;
  notes?: string[];
};

type BirthdayTurboRow = {
  cedenteId: string;
  cedenteNome: string;
  cedenteIdentificador?: string | null;
  cpf: string;
  owner: Owner;
  birthDay: string | null; // DD/MM
  paxAvailable: number;
  turbo: {
    status: "PENDING" | "TRANSFERRED" | "SKIPPED" | "NONE";
    transferredPoints: number;
    remainingPoints: number;
    willInactivate: boolean;
    cancelAt: string | null;
  };
};

type StrategyRow = ResultRow | BirthdayTurboRow;

function n(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function fmtInt(n: number) {
  return new Intl.NumberFormat("pt-BR").format(n || 0);
}

function fmtBirthDay(d: string | null | undefined) {
  if (!d) return "-";
  return d;
}

function fmtDateBR(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("pt-BR");
}

export default function StrategyCompraClient() {
  const [mode, setMode] = useState<Mode>("BIRTHDAY_TURBO");

  // Disponibilidade
  const [cia, setCia] = useState<Program>("LATAM");
  const [bank, setBank] = useState<Program>("ESFERA");
  const [requirePax, setRequirePax] = useState(true);
  const [requireCpfs, setRequireCpfs] = useState(false);
  const [preferBankRemainder, setPreferBankRemainder] = useState(true);
  const [minBankPoints, setMinBankPoints] = useState<number>(0);

  // Clube
  const [clubOnlyActive, setClubOnlyActive] = useState(true);
  const [clubProgram, setClubProgram] = useState<Program>("LIVELO");
  const [clubPlan, setClubPlan] = useState<string>("");

  // Combinado (checkboxes simples)
  const [rulePreferBank, setRulePreferBank] = useState(true);
  const [ruleRequirePax, setRuleRequirePax] = useState(true);
  const [ruleRequireCpfs, setRuleRequireCpfs] = useState(false);
  const [ruleClubRequired, setRuleClubRequired] = useState(false);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<StrategyRow[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const payload = useMemo(() => {
    if (mode === "BIRTHDAY_TURBO") {
      return { mode };
    }
    if (mode === "AVAILABILITY") {
      return {
        mode,
        cia,
        bank,
        requirePax,
        requireCpfs,
        preferBankRemainder,
        minBankPoints: n(minBankPoints),
      };
    }
    if (mode === "CLUB") {
      return {
        mode,
        club: {
          program: clubProgram,
          onlyActive: clubOnlyActive,
          plan: clubPlan.trim() ? clubPlan.trim() : null,
        },
      };
    }
    return {
      mode,
      combined: {
        cia,
        bank,
        preferBankRemainder: rulePreferBank,
        requirePax: ruleRequirePax,
        requireCpfs: ruleRequireCpfs,
        clubRequired: ruleClubRequired,
        club: {
          program: clubProgram,
          onlyActive: clubOnlyActive,
          plan: clubPlan.trim() ? clubPlan.trim() : null,
        },
        minBankPoints: n(minBankPoints),
      },
    };
  }, [
    mode,
    cia,
    bank,
    requirePax,
    requireCpfs,
    preferBankRemainder,
    minBankPoints,
    clubOnlyActive,
    clubProgram,
    clubPlan,
    rulePreferBank,
    ruleRequirePax,
    ruleRequireCpfs,
    ruleClubRequired,
  ]);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/estrategia-compra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Falha ao buscar");
      setRows(data.rows || []);
      setMeta(data.meta || null);
    } catch (e: any) {
      setError(e?.message || "Erro");
      setRows([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }

  const birthdayRows = useMemo(() => {
    if (mode !== "BIRTHDAY_TURBO") return [];
    return rows as BirthdayTurboRow[];
  }, [rows, mode]);

  const totalBirthdayRemaining = useMemo(() => {
    return birthdayRows.reduce((acc, r) => acc + (r.turbo?.remainingPoints || 0), 0);
  }, [birthdayRows]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Estratégia de Compra</h1>
          <p className="text-sm text-neutral-500">
            Selecione regras para priorizar quais contas usar primeiro (pontos remanescentes, pax/CPF, clube, etc.).
          </p>
        </div>

        <button
          onClick={run}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-50"
        >
          {loading ? "Buscando..." : "Buscar"}
        </button>
      </div>

      {/* MODO */}
      <div className="rounded-xl border p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[240px]">
            <label className="text-xs text-neutral-500">Modo</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="mt-1 w-full border rounded-lg px-3 py-2"
            >
              <option value="BIRTHDAY_TURBO">Aniversário Livelo + Latam Turbo</option>
              <option value="AVAILABILITY">Estratégia por disponibilidade</option>
              <option value="CLUB">Estratégia por clube</option>
              <option value="COMBINED">Combinada (várias regras)</option>
            </select>
          </div>

          {(mode === "AVAILABILITY" || mode === "COMBINED") && (
            <>
              <div className="min-w-[180px]">
                <label className="text-xs text-neutral-500">CIA</label>
                <select
                  value={cia}
                  onChange={(e) => setCia(e.target.value as Program)}
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                >
                  <option value="LATAM">LATAM</option>
                  <option value="SMILES">SMILES</option>
                </select>
              </div>

              <div className="min-w-[180px]">
                <label className="text-xs text-neutral-500">Banco</label>
                <select
                  value={bank}
                  onChange={(e) => setBank(e.target.value as Program)}
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                >
                  <option value="ESFERA">ESFERA</option>
                  <option value="LIVELO">LIVELO</option>
                </select>
              </div>

              <div className="min-w-[180px]">
                <label className="text-xs text-neutral-500">Mín. pontos no banco</label>
                <input
                  value={minBankPoints}
                  onChange={(e) => setMinBankPoints(Number(e.target.value || 0))}
                  type="number"
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                />
              </div>
            </>
          )}
        </div>

        {mode === "BIRTHDAY_TURBO" && (
          <div className="rounded-lg border bg-slate-50 p-3 text-sm text-slate-700">
            <div className="font-medium">Regras deste modo</div>
            <div>1) Aniversário Livelo no mês corrente</div>
            <div>2) Latam Turbo ativo no mês (se inativar, mostra a data de cancelamento)</div>
            <div>3) Transferido no mês &lt; 85.000</div>
            <div>Limite Latam Turbo: 100.000 por mês (1º ao último dia)</div>
          </div>
        )}

        {/* filtros por modo */}
        {mode === "AVAILABILITY" && (
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={preferBankRemainder} onChange={(e) => setPreferBankRemainder(e.target.checked)} />
              Priorizar contas com pontos remanescentes no banco
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={requirePax} onChange={(e) => setRequirePax(e.target.checked)} />
              Exigir pax disponível
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={requireCpfs} onChange={(e) => setRequireCpfs(e.target.checked)} />
              Exigir CPF disponível
            </label>
          </div>
        )}

        {mode === "CLUB" && (
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[200px]">
              <label className="text-xs text-neutral-500">Programa do clube</label>
              <select
                value={clubProgram}
                onChange={(e) => setClubProgram(e.target.value as Program)}
                className="mt-1 w-full border rounded-lg px-3 py-2"
              >
                <option value="LIVELO">LIVELO</option>
                <option value="ESFERA">ESFERA</option>
                <option value="SMILES">SMILES</option>
                <option value="LATAM">LATAM</option>
              </select>
            </div>

            <div className="min-w-[260px]">
              <label className="text-xs text-neutral-500">Plano (opcional)</label>
              <input
                value={clubPlan}
                onChange={(e) => setClubPlan(e.target.value)}
                placeholder='Ex.: "Livelo 20k" / "Smiles 10k"'
                className="mt-1 w-full border rounded-lg px-3 py-2"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={clubOnlyActive} onChange={(e) => setClubOnlyActive(e.target.checked)} />
              Apenas clube ativo
            </label>
          </div>
        )}

        {mode === "COMBINED" && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={rulePreferBank} onChange={(e) => setRulePreferBank(e.target.checked)} />
                Priorizar pontos remanescentes no banco
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ruleRequirePax} onChange={(e) => setRuleRequirePax(e.target.checked)} />
                Exigir pax disponível
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ruleRequireCpfs} onChange={(e) => setRuleRequireCpfs(e.target.checked)} />
                Exigir CPF disponível
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ruleClubRequired} onChange={(e) => setRuleClubRequired(e.target.checked)} />
                Clube obrigatório (ativo ou pausado)
              </label>
            </div>

            {ruleClubRequired && (
              <div className="flex flex-wrap items-end gap-4 pt-2">
                <div className="min-w-[200px]">
                  <label className="text-xs text-neutral-500">Programa do clube</label>
                  <select
                    value={clubProgram}
                    onChange={(e) => setClubProgram(e.target.value as Program)}
                    className="mt-1 w-full border rounded-lg px-3 py-2"
                  >
                    <option value="LIVELO">LIVELO</option>
                    <option value="ESFERA">ESFERA</option>
                    <option value="SMILES">SMILES</option>
                    <option value="LATAM">LATAM</option>
                  </select>
                </div>

                <div className="min-w-[260px]">
                  <label className="text-xs text-neutral-500">Plano (opcional)</label>
                  <input
                    value={clubPlan}
                    onChange={(e) => setClubPlan(e.target.value)}
                    placeholder='Ex.: "Livelo 20k"'
                    className="mt-1 w-full border rounded-lg px-3 py-2"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={clubOnlyActive} onChange={(e) => setClubOnlyActive(e.target.checked)} />
                  Apenas ativo (senão: ativo ou pausado)
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ERRO */}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* RESULTADOS */}
      <div className="rounded-xl border overflow-hidden">
        <div className="p-4 border-b">
          {mode === "BIRTHDAY_TURBO" ? (
            <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-600">
              <div>
                Resultados:{" "}
                <span className="font-semibold text-neutral-900">{birthdayRows.length}</span>
              </div>
              <div>
                Total pode transferir:{" "}
                <span className="font-semibold text-neutral-900">
                  {fmtInt(totalBirthdayRemaining)}
                </span>
              </div>
              {meta?.monthKey && <div>Mês: {meta.monthKey}</div>}
            </div>
          ) : (
            <div className="text-sm text-neutral-600">
              Resultados: <span className="font-semibold text-neutral-900">{rows.length}</span>
            </div>
          )}
        </div>

        <div className="overflow-auto">
          {mode === "BIRTHDAY_TURBO" ? (
            <table className="min-w-[980px] w-full text-sm">
              <thead className="bg-neutral-50">
                <tr className="text-left">
                  <th className="p-3">Cedente</th>
                  <th className="p-3">Responsável</th>
                  <th className="p-3">Aniversário</th>
                  <th className="p-3">Turbo (mês)</th>
                  <th className="p-3">Cancela em</th>
                  <th className="p-3">Transferido</th>
                  <th className="p-3">Pode transferir</th>
                  <th className="p-3">Pax restantes</th>
                </tr>
              </thead>
              <tbody>
                {birthdayRows.map((r) => (
                  <tr key={r.cedenteId} className="border-t">
                    <td className="p-3">
                      <div className="font-medium">{r.cedenteNome}</div>
                      {r.cedenteIdentificador ? (
                        <div className="text-xs text-neutral-500">{r.cedenteIdentificador}</div>
                      ) : null}
                    </td>
                    <td className="p-3">
                      <div className="font-medium">{r.owner?.name || "-"}</div>
                      <div className="text-xs text-neutral-500">@{r.owner?.login || "-"}</div>
                    </td>
                    <td className="p-3">{fmtBirthDay(r.birthDay)}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border px-2 py-0.5 text-xs">
                          {r.turbo?.status || "NONE"}
                        </span>
                        {r.turbo?.willInactivate ? (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                            inativa no mês
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-3">
                      {r.turbo?.willInactivate ? fmtDateBR(r.turbo?.cancelAt) : "-"}
                    </td>
                    <td className="p-3">{fmtInt(r.turbo?.transferredPoints || 0)}</td>
                    <td className="p-3 font-semibold">{fmtInt(r.turbo?.remainingPoints || 0)}</td>
                    <td className="p-3">{fmtInt(r.paxAvailable || 0)}</td>
                  </tr>
                ))}

                {!birthdayRows.length && (
                  <tr>
                    <td className="p-6 text-neutral-500" colSpan={8}>
                      Nenhum resultado ainda. Clique em <b>Buscar</b>.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="min-w-[980px] w-full text-sm">
              <thead className="bg-neutral-50">
                <tr className="text-left">
                  <th className="p-3">Cedente</th>
                  <th className="p-3">CIA</th>
                  <th className="p-3">Banco</th>
                  <th className="p-3">Pts CIA</th>
                  <th className="p-3">Pts Banco</th>
                  <th className="p-3">Pax</th>
                  <th className="p-3">CPF</th>
                  <th className="p-3">Clube</th>
                  <th className="p-3">Score</th>
                  <th className="p-3">Notas</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${(r as ResultRow).cedenteId}-${(r as ResultRow).cia}-${(r as ResultRow).bank}`} className="border-t">
                    <td className="p-3">
                      <div className="font-medium">{(r as ResultRow).cedenteNome}</div>
                      {(r as ResultRow).cedenteIdentificador ? (
                        <div className="text-xs text-neutral-500">{(r as ResultRow).cedenteIdentificador}</div>
                      ) : null}
                    </td>
                    <td className="p-3">{(r as ResultRow).cia ?? "-"}</td>
                    <td className="p-3">{(r as ResultRow).bank ?? "-"}</td>
                    <td className="p-3">{(r as ResultRow).ciaPoints.toLocaleString("pt-BR")}</td>
                    <td className="p-3">{(r as ResultRow).bankPoints.toLocaleString("pt-BR")}</td>
                    <td className="p-3">{(r as ResultRow).paxAvailable ?? "-"}</td>
                    <td className="p-3">{(r as ResultRow).cpfsAvailable ?? "-"}</td>
                    <td className="p-3">
                      {(r as ResultRow).clubStatus === "NONE" ? "-" : (
                        <div>
                          <div className="font-medium">{(r as ResultRow).clubStatus}</div>
                          <div className="text-xs text-neutral-500">{(r as ResultRow).clubPlan || ""}</div>
                        </div>
                      )}
                    </td>
                    <td className="p-3 font-semibold">{Math.round((r as ResultRow).score)}</td>
                    <td className="p-3 text-xs text-neutral-600">
                      {((r as ResultRow).notes || []).slice(0, 3).join(" · ")}
                    </td>
                  </tr>
                ))}

                {!rows.length && (
                  <tr>
                    <td className="p-6 text-neutral-500" colSpan={10}>
                      Nenhum resultado ainda. Ajuste os filtros e clique em <b>Buscar</b>.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="text-xs text-neutral-500">
        Dica: depois que ligar isso no banco, dá pra reaproveitar o mesmo endpoint para sugerir automaticamente “top 5 contas”
        dentro do fluxo de emissão.
      </div>
    </div>
  );
}
