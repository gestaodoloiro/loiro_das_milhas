"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, MessageCircle, Pencil, UserRound } from "lucide-react";

type BlockProgram = "LATAM" | "SMILES" | "LIVELO" | "ESFERA";
type ProgramKey =
  | "latam"
  | "smiles"
  | "livelo"
  | "esfera"
  | "azul"
  | "iberia"
  | "aa"
  | "tap"
  | "flyingblue";

type Row = {
  id: string;
  identificador: string;
  nomeCompleto: string;
  cpf: string;
  telefone?: string | null;
  pontosLatam: number;
  pontosSmiles: number;
  pontosLivelo: number;
  pontosEsfera: number;
  pontosAzul: number;
  pontosIberia: number;
  pontosAA: number;
  pontosTAP: number;
  pontosFlyingBlue: number;
  createdAt: string;
  owner: { id: string; name: string; login: string };
  blockedPrograms?: BlockProgram[];
};

type SortKey = "nome" | ProgramKey;
type SortDir = "asc" | "desc";

const PROGRAM_META: Record<
  ProgramKey,
  { label: string; blockedProgram?: BlockProgram }
> = {
  latam: { label: "LATAM", blockedProgram: "LATAM" },
  smiles: { label: "SMILES", blockedProgram: "SMILES" },
  livelo: { label: "LIVELO", blockedProgram: "LIVELO" },
  esfera: { label: "ESFERA", blockedProgram: "ESFERA" },
  azul: { label: "AZUL" },
  iberia: { label: "IBERIA" },
  aa: { label: "AA" },
  tap: { label: "TAP" },
  flyingblue: { label: "FLYINGBLUE" },
};

const BR_PROGRAMS: ProgramKey[] = ["latam", "smiles", "livelo", "esfera", "azul"];
const ALL_PROGRAMS = Object.keys(PROGRAM_META) as ProgramKey[];

function fmtInt(n: number) {
  return new Intl.NumberFormat("pt-BR").format(n || 0);
}

function maskCpf(cpf: string) {
  const v = String(cpf || "").replace(/\D+/g, "");
  if (v.length !== 11) return cpf || "-";
  return `***.***.${v.slice(6, 9)}-${v.slice(9, 11)}`;
}

function cn(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ");
}

function pointsOf(r: Row, key: ProgramKey): number {
  if (key === "latam") return r.pontosLatam || 0;
  if (key === "smiles") return r.pontosSmiles || 0;
  if (key === "livelo") return r.pontosLivelo || 0;
  if (key === "esfera") return r.pontosEsfera || 0;
  if (key === "azul") return r.pontosAzul || 0;
  if (key === "iberia") return r.pontosIberia || 0;
  if (key === "aa") return r.pontosAA || 0;
  if (key === "tap") return r.pontosTAP || 0;
  return r.pontosFlyingBlue || 0;
}

function isBlocked(r: Row, program: BlockProgram) {
  return (r.blockedPrograms || []).includes(program);
}

function whatsappHref(telefone?: string | null) {
  let d = String(telefone || "").replace(/\D+/g, "");
  if (!d) return null;
  while (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 12) return null;
  return `https://wa.me/${d}`;
}

export default function CedentesVisualizarClient() {
  const router = useRouter();
  const search = useSearchParams();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("nome");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const programaRaw = (search?.get("programa") || "").toLowerCase();
  const programaSelecionado = ALL_PROGRAMS.includes(programaRaw as ProgramKey)
    ? (programaRaw as ProgramKey)
    : null;

  const visiblePrograms = programaSelecionado ? [programaSelecionado] : BR_PROGRAMS;
  const titleSuffix = programaSelecionado
    ? PROGRAM_META[programaSelecionado].label
    : "Todos-BR";

  useEffect(() => {
    if (programaSelecionado) {
      setSortKey(programaSelecionado);
      setSortDir("desc");
      return;
    }
    setSortKey("nome");
    setSortDir("asc");
  }, [programaSelecionado]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/cedentes/approved", { cache: "no-store" });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error);
      setRows(json.data);
      setSelected(new Set());
    } catch (e: any) {
      alert(e?.message || "Erro ao carregar.");
      setRows([]);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function toggleOne(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAll(ids: string[]) {
    setSelected((prev) => {
      if (ids.length === 0) return new Set();
      if (prev.size === ids.length) return new Set();
      return new Set(ids);
    });
  }

  async function askPassword(): Promise<string | null> {
    const password = prompt("Digite sua senha do login para confirmar:");
    const v = (password ?? "").trim();
    return v ? v : null;
  }

  async function deleteSelected() {
    if (!selected.size) return;
    if (!confirm(`Apagar ${selected.size} cedente(s) selecionado(s)?`)) return;

    const password = await askPassword();
    if (!password) return;

    const res = await fetch("/api/cedentes/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected), password }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      alert(json?.error || "Erro ao apagar selecionados.");
      return;
    }

    await load();
  }

  async function deleteAll() {
    if (!confirm("Isso vai apagar TODOS os cedentes. Continuar?")) return;

    const password = await askPassword();
    if (!password) return;

    const res = await fetch("/api/cedentes/delete-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      alert(json?.error || "Erro ao apagar todos.");
      return;
    }

    await load();
  }

  const owners = useMemo(() => {
    const map = new Map<string, { id: string; name: string; login: string }>();
    rows.forEach((r) => {
      if (!r.owner?.id) return;
      if (map.has(r.owner.id)) return;
      map.set(r.owner.id, {
        id: r.owner.id,
        name: r.owner.name || "",
        login: r.owner.login || "",
      });
    });
    return Array.from(map.values()).sort((a, b) =>
      a.login.localeCompare(b.login, "pt-BR")
    );
  }, [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();

    return rows
      .filter((r) => {
        if (ownerFilter && r.owner?.id !== ownerFilter) return false;
        if (programaSelecionado && pointsOf(r, programaSelecionado) <= 0) return false;
        if (!s) return true;

        return (
          r.nomeCompleto.toLowerCase().includes(s) ||
          r.identificador.toLowerCase().includes(s) ||
          String(r.cpf || "").includes(s) ||
          r.owner?.name?.toLowerCase().includes(s)
        );
      })
      .sort((a, b) => {
        if (sortKey === "nome") {
          const va = a.nomeCompleto.toLowerCase();
          const vb = b.nomeCompleto.toLowerCase();
          if (va < vb) return sortDir === "asc" ? -1 : 1;
          if (va > vb) return sortDir === "asc" ? 1 : -1;
          return 0;
        }

        const va = pointsOf(a, sortKey);
        const vb = pointsOf(b, sortKey);
        if (va < vb) return sortDir === "asc" ? -1 : 1;
        if (va > vb) return sortDir === "asc" ? 1 : -1;
        return a.nomeCompleto.localeCompare(b.nomeCompleto, "pt-BR");
      });
  }, [rows, q, ownerFilter, sortKey, sortDir, programaSelecionado]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "nome" ? "asc" : "desc");
  }

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <div className="max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Cedentes • {titleSuffix}</h1>
          <p className="text-sm text-slate-600">
            Cedentes aprovados com pontos e responsável
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {selected.size > 0 && (
            <button
              onClick={deleteSelected}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm text-white"
              disabled={loading}
              title="Apagar somente os marcados"
            >
              🗑️ Apagar selecionados ({selected.size})
            </button>
          )}

          <button
            onClick={deleteAll}
            className="rounded-xl border border-red-600 px-4 py-2 text-sm text-red-600"
            disabled={loading || rows.length === 0}
            title="Apagar todos os cedentes (perigoso)"
          >
            🧨 Apagar todos
          </button>

          <input
            className="rounded-xl border px-3 py-2 text-sm"
            placeholder="Buscar..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <select
            className="rounded-xl border px-3 py-2 text-sm"
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
          >
            <option value="">Todos responsáveis</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                @{o.login}
              </option>
            ))}
          </select>

          <button
            onClick={load}
            className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50"
            disabled={loading}
          >
            Atualizar
          </button>
        </div>
      </div>

      <div className="rounded-2xl border overflow-hidden">
        <table className="min-w-[1240px] w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={() => toggleAll(filtered.map((r) => r.id))}
                  disabled={filtered.length === 0}
                  title="Selecionar todos filtrados"
                />
              </th>

              <Th onClick={() => toggleSort("nome")}>Nome{arrow("nome")}</Th>
              <Th>Responsável</Th>

              {visiblePrograms.map((program) => (
                <ThRight key={program} onClick={() => toggleSort(program)}>
                  {PROGRAM_META[program].label}
                  {arrow(program)}
                </ThRight>
              ))}

              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600 text-right">
                Ações
              </th>
            </tr>
          </thead>

          <tbody>
            {!loading && filtered.length === 0 && (
              <tr>
                <td
                  colSpan={4 + visiblePrograms.length}
                  className="px-6 py-10 text-center text-sm text-slate-500"
                >
                  Nenhum cedente encontrado.
                </td>
              </tr>
            )}

            {filtered.map((r) => {
              const hasAnyBlock = (r.blockedPrograms || []).length > 0;
              const waHref = whatsappHref(r.telefone);
              const actionBtnBase =
                "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors";
              const neutralActionBtnCls = cn(
                actionBtnBase,
                "border-slate-300 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              );
              const whatsappActionBtnCls = cn(
                actionBtnBase,
                "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              );

              return (
                <tr key={r.id} className="border-t hover:bg-slate-50">
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                      title="Selecionar"
                    />
                  </td>

                  <td className="px-4 py-3">
                    <div
                      className={cn("font-medium", hasAnyBlock && "text-red-600")}
                      title={
                        hasAnyBlock
                          ? `Bloqueado: ${(r.blockedPrograms || []).join(", ")}`
                          : undefined
                      }
                    >
                      {r.nomeCompleto}
                    </div>

                    <div className="text-xs text-slate-500">
                      {r.identificador} • CPF: {maskCpf(r.cpf)}
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                      <UserRound size={14} />
                      <span>@{r.owner?.login}</span>
                    </div>
                  </td>

                  {visiblePrograms.map((program) => {
                    const blockedProgram = PROGRAM_META[program].blockedProgram;
                    const blocked = blockedProgram ? isBlocked(r, blockedProgram) : false;
                    return (
                      <TdRight
                        key={`${r.id}-${program}`}
                        className={blocked ? "text-red-600 font-semibold" : ""}
                      >
                        {fmtInt(pointsOf(r, program))}
                      </TdRight>
                    );
                  })}

                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      {waHref ? (
                        <a
                          href={waHref}
                          target="_blank"
                          rel="noreferrer"
                          className={whatsappActionBtnCls}
                          title="Abrir conversa no WhatsApp do cedente"
                        >
                          <MessageCircle size={15} />
                          <span className="sr-only">WhatsApp</span>
                        </a>
                      ) : (
                        <button
                          type="button"
                          className={cn(neutralActionBtnCls, "opacity-40 cursor-not-allowed")}
                          disabled
                          title="Sem WhatsApp cadastrado"
                        >
                          <MessageCircle size={15} />
                          <span className="sr-only">Sem WhatsApp</span>
                        </button>
                      )}

                      <button
                        type="button"
                        className={neutralActionBtnCls}
                        onClick={() => setOwnerFilter(r.owner?.id || "")}
                        title={`Filtrar responsável: @${r.owner?.login || "-"}`}
                      >
                        <UserRound size={15} />
                        <span className="sr-only">Responsável</span>
                      </button>

                      <button
                        type="button"
                        className={neutralActionBtnCls}
                        onClick={() => router.push(`/dashboard/cedentes/${r.id}`)}
                        title="Ver cedente"
                      >
                        <Eye size={15} />
                        <span className="sr-only">Ver</span>
                      </button>

                      <button
                        type="button"
                        className={neutralActionBtnCls}
                        onClick={() => router.push(`/dashboard/cedentes/${r.id}?edit=1`)}
                        title="Abrir detalhe em modo edição"
                      >
                        <Pencil size={15} />
                        <span className="sr-only">Editar</span>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {loading && <div className="mt-4 text-sm text-slate-500">Carregando…</div>}
    </div>
  );
}

function Th({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600 cursor-pointer select-none"
    >
      {children}
    </th>
  );
}

function ThRight({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600 text-right cursor-pointer select-none"
    >
      {children}
    </th>
  );
}

function TdRight({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={cn("px-4 py-3 text-right tabular-nums", className)}>{children}</td>;
}
