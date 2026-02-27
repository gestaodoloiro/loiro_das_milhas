// app/api/contas-selecionadas/smiles/renovacao-clube/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionServer } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: Request) {
  const session = await getSessionServer();
  if (!session) return bad("Não autenticado", 401);

  try {
    /**
     * ✅ Por padrão, incluímos CANCELADOS também.
     * Opcional: /api/.../renovacao-clube?includeCanceled=0
     */
    const url = new URL(req.url);
    const includeCanceled = url.searchParams.get("includeCanceled") !== "0";

    const statusIn = includeCanceled
      ? (["ACTIVE", "PAUSED", "CANCELED"] as const)
      : (["ACTIVE", "PAUSED"] as const);

    /**
     * ✅ Deduplicação correta no Postgres (DISTINCT ON):
     * - orderBy PRECISA começar pelo(s) campo(s) do distinct (cedenteId)
     * - depois vem o critério do "mais recente" (updatedAt desc)
     * - tie-break por id desc para ficar determinístico
     */
    const latestPerCedente = await prisma.clubSubscription.findMany({
      where: {
        program: "SMILES",
        status: { in: statusIn as any },
        smilesBonusEligibleAt: { not: null },

        // ✅ segurança: só devolve cedentes do mesmo time do usuário logado
        cedente: { owner: { team: session.team } },
      },
      distinct: ["cedenteId"],
      orderBy: [
        { cedenteId: "asc" }, // ✅ obrigatório com distinct no Postgres
        { updatedAt: "desc" }, // ✅ pega o mais recente por cedente
        { id: "desc" }, // ✅ desempate
      ],
      select: {
        id: true,
        cedenteId: true,
        tierK: true,
        status: true,
        subscribedAt: true,
        lastRenewedAt: true,
        renewalDay: true,
        smilesBonusEligibleAt: true,
        updatedAt: true,
        cedente: {
          select: {
            id: true,
            identificador: true,
            nomeCompleto: true,
            cpf: true,
            pontosSmiles: true,
            owner: { select: { id: true, name: true, login: true } },
          },
        },
      },
    });

    // ✅ Ordena para a UI (mês/dia), sem quebrar a deduplicação
    const unique = [...latestPerCedente].sort((a, b) => {
      const av = String(a.smilesBonusEligibleAt || "");
      const bv = String(b.smilesBonusEligibleAt || "");
      if (av !== bv) return av.localeCompare(bv); // asc por data elegível
      // tie-break: mais atualizado primeiro
      const au = String(a.updatedAt || "");
      const bu = String(b.updatedAt || "");
      if (au !== bu) return bu.localeCompare(au);
      return String(b.id).localeCompare(String(a.id));
    });

    return NextResponse.json({ ok: true, items: unique });
  } catch (e) {
    console.error(e);
    return bad("Falha ao carregar renovação do clube (Smiles).", 500);
  }
}
