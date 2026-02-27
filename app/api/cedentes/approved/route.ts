import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noCacheHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  };
}

export async function GET() {
  try {
    const rows = await prisma.cedente.findMany({
      where: { status: "APPROVED" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        identificador: true,
        nomeCompleto: true,
        cpf: true,
        pontosLatam: true,
        pontosSmiles: true,
        pontosLivelo: true,
        pontosEsfera: true,
        createdAt: true,
        owner: {
          select: { id: true, name: true, login: true },
        },

        // ✅ pega bloqueios em aberto e devolve os programas
        blockedAccounts: {
          where: { status: "OPEN" },
          select: { program: true },
        },
      },
    });

    const data = rows.map((r) => ({
      id: r.id,
      identificador: r.identificador,
      nomeCompleto: r.nomeCompleto,
      cpf: r.cpf,
      pontosLatam: r.pontosLatam,
      pontosSmiles: r.pontosSmiles,
      pontosLivelo: r.pontosLivelo,
      pontosEsfera: r.pontosEsfera,
      createdAt: r.createdAt.toISOString(),
      owner: r.owner,
      blockedPrograms: (r.blockedAccounts || []).map((b) => b.program), // ["LATAM","SMILES"...]
    }));

    return NextResponse.json({ ok: true, data }, { headers: noCacheHeaders() });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Erro ao listar cedentes aprovados." },
      { status: 500, headers: noCacheHeaders() }
    );
  }
}
