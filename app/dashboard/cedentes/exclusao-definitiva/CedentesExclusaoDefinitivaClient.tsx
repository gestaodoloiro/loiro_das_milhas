"use client";

import { useEffect, useMemo, useState } from "react";

type Program = "LATAM" | "SMILES" | "LIVELO" | "ESFERA";
type ScopeMode = "ACCOUNT" | "PROGRAM";

type CedenteLite = {
  id: string;
  identificador: string;
  nomeCompleto: string;
  cpf: string;
};

type ExclusionRow = {
  id: string;
  cedenteId: string;
  cedenteIdentificador: string;
  cedenteNomeCompleto: string;
  cedenteCpf: string;
  scope: ScopeMode;
  program: Program | null;
  details: unknown;
  createdAt: string;
  deletedBy?: { id: string; name: string; login: string } | null;
};

type ListResponse<T> = {
  ok?: boolean;
  rows?: T[];
  error?: string;
};

type ActionResponse = {
  ok?: boolean;
  error?: string;
};

function fmtDateTime(v?: string | null) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("pt-BR");
}

function maskCpf(cpf?: string | null) {
  const v = String(cpf || "").replace(/\D+/g, "");
  if (v.length !== 11) return cpf || "-";
  return `***.***.${v.slice(6, 9)}-${v.slice(9, 11)}`;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

export default function CedentesExclusaoDefinitivaClient() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [cedentes, setCedentes] = useState<CedenteLite[]>([]);
  const [excluded, setExcluded] = useState<ExclusionRow[]>([]);

  const [cedenteId, setCedenteId] = useState("");
  const [mode, setMode] = useState<ScopeMode>("ACCOUNT");
  const [program, setProgram] = useState<Program>("LATAM");
  const [password, setPassword] = useState("");

  const [q, setQ] = useState("");

  async function loadAll() {
    setLoading(true);
    try {
      const [rCed, rExc] = await Promise.all([
        fetch("/api/cedentes/lite", { cache: "no-store", credentials: "include" }),
        fetch("/api/cedentes/exclusao-definitiva", {
          cache: "no-store",
          credentials: "include",
        }),
      ]);

      const jCed = (await rCed.json().catch(() => ({}))) as ListResponse<CedenteLite>;
      const jExc = (await rExc.json().catch(() => ({}))) as ListResponse<ExclusionRow>;

      if (!rCed.ok || jCed?.ok === false) {
        throw new Error(jCed?.error || "Falha ao carregar cedentes.");
      }
      if (!rExc.ok || jExc?.ok === false) {
        throw new Error(jExc?.error || "Falha ao carregar excluídos.");
      }

      setCedentes(Array.isArray(jCed?.rows) ? jCed.rows : []);
      setExcluded(Array.isArray(jExc?.rows) ? jExc.rows : []);
    } catch (error: unknown) {
      alert(getErrorMessage(error, "Falha ao carregar tela de exclusão."));
      setCedentes([]);
      setExcluded([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const cedentesFiltrados = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return cedentes;
    return cedentes.filter((c) => {
      const hay = `${c.nomeCompleto} ${c.identificador} ${c.cpf}`.toLowerCase();
      return hay.includes(s);
    });
  }, [cedentes, q]);

  const cedSel = useMemo(
    () => cedentes.find((c) => c.id === cedenteId) || null,
    [cedentes, cedenteId]
  );

  async function executarExclusao() {
    if (!cedenteId) return alert("Selecione um cedente.");
    if (!password.trim()) return alert("Informe sua senha para confirmar.");

    const alvo = mode === "ACCOUNT" ? "conta inteira" : `programa ${program}`;
    if (
      !confirm(
        `Confirma EXCLUSÃO DEFINITIVA do cedente ${cedSel?.nomeCompleto || ""} (${alvo})?\n\nAs vendas/compras e o histórico financeiro serão preservados.`
      )
    ) {
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/cedentes/exclusao-definitiva", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cedenteId,
          mode,
          program: mode === "PROGRAM" ? program : undefined,
          password: password.trim(),
        }),
      });

      const json = (await res.json().catch(() => ({}))) as ActionResponse;
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `Erro ${res.status}`);
      }

      setPassword("");
      await loadAll();
      alert("Exclusão definitiva concluída.");
    } catch (error: unknown) {
      alert(getErrorMessage(error, "Falha ao excluir definitivamente."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Cedentes • Exclusão definitiva</h1>
        <p className="text-sm text-slate-600">
          Inativa o cedente, limpa os dados de acesso e registra em Excluídos para auditoria.
          Histórico de vendas e compras é preservado.
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-5 space-y-4">
        <div className="font-medium">Excluir dados</div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 md:col-span-2">
            <div className="text-xs text-slate-600">Buscar cedente</div>
            <input
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nome, identificador ou CPF"
            />
          </label>

          <label className="space-y-1 md:col-span-2">
            <div className="text-xs text-slate-600">Cedente</div>
            <select
              className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
              value={cedenteId}
              onChange={(e) => setCedenteId(e.target.value)}
            >
              <option value="">Selecione...</option>
              {cedentesFiltrados.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nomeCompleto} ({c.identificador})
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <div className="text-xs text-slate-600">Escopo da exclusão</div>
            <select
              className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
              value={mode}
              onChange={(e) => setMode(e.target.value as ScopeMode)}
            >
              <option value="ACCOUNT">Conta inteira</option>
              <option value="PROGRAM">Programa específico</option>
            </select>
          </label>

          {mode === "PROGRAM" ? (
            <label className="space-y-1">
              <div className="text-xs text-slate-600">Programa</div>
              <select
                className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                value={program}
                onChange={(e) => setProgram(e.target.value as Program)}
              >
                <option value="LATAM">LATAM</option>
                <option value="SMILES">SMILES</option>
                <option value="LIVELO">LIVELO</option>
                <option value="ESFERA">ESFERA</option>
              </select>
            </label>
          ) : (
            <div />
          )}

          <label className="space-y-1 md:col-span-2">
            <div className="text-xs text-slate-600">Senha de confirmação</div>
            <input
              type="password"
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Digite sua senha"
            />
          </label>
        </div>

        {cedSel ? (
          <div className="text-xs text-slate-500">
            Selecionado: <b>{cedSel.nomeCompleto}</b> ({cedSel.identificador}) • CPF {maskCpf(cedSel.cpf)}
          </div>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={executarExclusao}
            disabled={saving || loading}
            className="rounded-xl bg-rose-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? "Excluindo..." : "Excluir definitivamente"}
          </button>
          <button
            type="button"
            onClick={loadAll}
            disabled={loading}
            className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50"
          >
            Atualizar
          </button>
        </div>
      </div>

      <div className="rounded-2xl border bg-white overflow-x-auto">
        <div className="px-5 py-3 border-b font-medium">Excluídos</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Data</th>
              <th className="px-3 py-2 text-left">Cedente</th>
              <th className="px-3 py-2 text-left">Escopo</th>
              <th className="px-3 py-2 text-left">Programa</th>
              <th className="px-3 py-2 text-left">Responsável</th>
            </tr>
          </thead>
          <tbody>
            {excluded.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-slate-500" colSpan={5}>
                  Nenhum registro em excluídos.
                </td>
              </tr>
            ) : (
              excluded.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">{fmtDateTime(r.createdAt)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.cedenteNomeCompleto}</div>
                    <div className="text-xs text-slate-500">
                      {r.cedenteIdentificador} • CPF {maskCpf(r.cedenteCpf)}
                    </div>
                  </td>
                  <td className="px-3 py-2">{r.scope === "ACCOUNT" ? "Conta inteira" : "Programa"}</td>
                  <td className="px-3 py-2">{r.program || "-"}</td>
                  <td className="px-3 py-2">
                    {r.deletedBy?.name || "-"}
                    {r.deletedBy?.login ? (
                      <span className="text-xs text-slate-500"> (@{r.deletedBy.login})</span>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
