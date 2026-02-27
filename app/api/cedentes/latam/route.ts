// app/api/cedentes/latam/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const LATAM_ANUAL_PASSAGEIROS_LIMITE = 25;

function noCacheHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  };
}

function ok(json: any, status = 200) {
  return new NextResponse(JSON.stringify({ ok: true, ...json }), {
    status,
    headers: noCacheHeaders(),
  });
}

function bad(message: string, status = 400) {
  return new NextResponse(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: noCacheHeaders(),
  });
}

function safeInt(v: any, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fb;
}

function startOfMonthUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}
function addMonthsUTC(d: Date, m: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, 1, 0, 0, 0, 0));
}

/* =========================
   GET
========================= */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const ownerId = (url.searchParams.get("ownerId") || "").trim();

    const hideBlocked = ["1", "true", "yes", "on"].includes(
      (url.searchParams.get("hideBlocked") || "").toLowerCase()
    );

    const whereCedente: any = {
      status: "APPROVED",
      owner: { team: session.team },
      AND: [],
    };

    if (ownerId) whereCedente.AND.push({ ownerId });

    if (q) {
      whereCedente.AND.push({
        OR: [
          { nomeCompleto: { contains: q, mode: "insensitive" } },
          { identificador: { contains: q, mode: "insensitive" } },
          { cpf: { contains: q } },
        ],
      });
    }

    // "só LATAM": reduz lista para quem tem LATAM configurado/útil
    whereCedente.AND.push({
      OR: [{ pontosLatam: { gt: 0 } }, { senhaLatamPass: { not: null } }],
    });

    const cedentesRaw = await prisma.cedente.findMany({
      where: whereCedente,
      select: {
        id: true,
        identificador: true,
        nomeCompleto: true,
        cpf: true,
        telefone: true,
        emailCriado: true,
        senhaEmail: true,
        senhaLatamPass: true,
        pontosLatam: true,
        owner: { select: { id: true, name: true, login: true } },
      },
      orderBy: { nomeCompleto: "asc" },
      take: 2000,
    });

    const idsRaw = cedentesRaw.map((c) => c.id);
    if (idsRaw.length === 0) return ok({ rows: [] });

    // =========================
    // BLOQUEADOS LATAM (BlockedAccount OPEN)
    // =========================
    const blockedLatam = await prisma.blockedAccount.findMany({
      where: {
        cedenteId: { in: idsRaw },
        program: "LATAM",
        status: "OPEN",
      },
      select: { cedenteId: true },
    });

    const blockedSet = new Set(blockedLatam.map((b) => b.cedenteId));

    const cedentes = hideBlocked
      ? cedentesRaw.filter((c) => !blockedSet.has(c.id))
      : cedentesRaw;

    const ids = cedentes.map((c) => c.id);
    if (ids.length === 0) return ok({ rows: [] });

    // =========================
    // Pendentes LATAM (PurchaseItem PENDING)
    // =========================
    const pendingItems = await prisma.purchaseItem.findMany({
      where: {
        status: "PENDING",
        purchase: {
          cedenteId: { in: ids },
          status: { not: "CANCELED" },
        },
        OR: [{ programTo: "LATAM" }, { purchase: { ciaAerea: "LATAM" } }],
      },
      select: {
        pointsFinal: true,
        purchase: { select: { cedenteId: true } },
      },
    });

    const pendingMap = new Map<string, number>();
    for (const it of pendingItems) {
      const cid = it.purchase.cedenteId;
      pendingMap.set(cid, (pendingMap.get(cid) || 0) + (it.pointsFinal || 0));
    }

    // =========================
    // Emissões LATAM (janela 12 meses por mês) (EmissionEvent)
    // =========================
    const now = new Date();
    const m0 = startOfMonthUTC(now);
    const w0 = addMonthsUTC(m0, -12);
    const w1 = addMonthsUTC(m0, 1);

    const grouped = await prisma.emissionEvent.groupBy({
      by: ["cedenteId"],
      where: {
        program: "LATAM",
        cedenteId: { in: ids },
        issuedAt: { gte: w0, lt: w1 },
      },
      _sum: { passengersCount: true },
    });

    const usedMap = new Map<string, number>();
    for (const g of grouped) {
      usedMap.set(g.cedenteId, Number(g._sum.passengersCount || 0));
    }

    // =========================
    // Monta resposta
    // =========================
    const rows = cedentes.map((c: any) => {
      const pend = pendingMap.get(c.id) || 0;
      const used = usedMap.get(c.id) || 0;
      const available = Math.max(0, LATAM_ANUAL_PASSAGEIROS_LIMITE - used);

      const latamBloqueado = blockedSet.has(c.id);

      return {
        id: c.id,
        identificador: c.identificador,
        nomeCompleto: c.nomeCompleto,
        cpf: c.cpf,
        telefone: c.telefone || null,
        emailCriado: c.emailCriado || null,
        senhaEmail: c.senhaEmail || null,
        senhaLatamPass: c.senhaLatamPass || null,
        owner: c.owner,

        latamAprovado: c.pontosLatam || 0,
        latamPendente: pend,
        latamTotalEsperado: (c.pontosLatam || 0) + pend,

        passageirosUsadosAno: used,
        passageirosDisponiveisAno: available,

        latamBloqueado,
        blockedPrograms: latamBloqueado ? (["LATAM"] as const) : [],
      };
    });

    return ok({ rows });
  } catch (e: any) {
    console.error(e);
    return bad(e?.message || "Erro interno", 500);
  }
}

/* =========================
   PATCH (inline edit pontosLatam)
========================= */
export async function PATCH(req: NextRequest) {
  try {
    // ✅ Tenta com req (se requireSession precisar), senão segue.
    const session = await (requireSession as any)(req);

    const body = await req.json().catch(() => null);
    const id = String(body?.id || "").trim();
    const pontosLatam = safeInt(body?.pontosLatam, NaN as any);

    if (!id) return bad("id é obrigatório");
    if (!Number.isFinite(pontosLatam) || pontosLatam < 0) {
      return bad("pontosLatam inválido");
    }

    const ced = await prisma.cedente.findUnique({
      where: { id },
      select: { id: true, ownerId: true },
    });

    if (!ced) return bad("Cedente não encontrado", 404);

    // ✅ extrai campos da sessão com fallbacks
    const s = session as any;

    const sessionLogin: string = String(
      s?.login ?? s?.user?.login ?? s?.username ?? s?.user?.username ?? ""
    );

    let sessionUserId: string = String(
      s?.userId ?? s?.user_id ?? s?.uid ?? s?.user?.id ?? s?.id ?? ""
    );

    let role: string = String(
      s?.role ?? s?.userRole ?? s?.user?.role ?? s?.perfil ?? s?.user?.perfil ?? ""
    );

    // ✅ se role não veio pela sessão, busca no DB (isso resolve “sou admin mas veio sem role”)
    if ((!role || role === "undefined") && (sessionUserId || sessionLogin)) {
      const u = await prisma.user.findFirst({
        where: sessionUserId ? { id: sessionUserId } : { login: sessionLogin },
        select: { id: true, role: true },
      });

      if (!sessionUserId && u?.id) sessionUserId = u.id;
      if (!role && u?.role) role = String(u.role);
    }

    const roleUp = String(role || "").toUpperCase();

    // ✅ admins/gestores podem editar qualquer cedente
    const isAdmin = ["ADMIN", "SUPERADMIN", "ROOT", "OWNER"].includes(roleUp);

    // ✅ fallback: se não tem role por algum motivo, ainda permite dono do cedente
    const isOwner = Boolean(sessionUserId) && ced.ownerId === sessionUserId;

    if (!isAdmin && !isOwner) return bad("Sem permissão", 403);

    await prisma.cedente.update({
      where: { id },
      data: { pontosLatam },
    });

    return ok({}); // { ok: true }
  } catch (e: any) {
    console.error(e);
    return bad(e?.message || "Erro interno", 500);
  }
}
