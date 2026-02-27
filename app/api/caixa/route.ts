// app/api/caixa/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function startOfDayUTC(date = new Date()) {
  // normaliza para 00:00 UTC do dia (evita duplicar “por horário”)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toInt(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // Agora o endpoint grava o HISTÓRICO DO TOTAL (principalmente o líquido).
    // Espera centavos (Int) vindo do front:
    // { totalBruto: number, totalDividas: number, totalLiquido: number }
    const totalBruto = toInt(body?.totalBruto);
    const totalDividas = toInt(body?.totalDividas);
    const totalLiquido = toInt(body?.totalLiquido);

    const date = startOfDayUTC(new Date());

    const upserted = await prisma.cashSnapshot.upsert({
      where: { date },
      create: { date, totalBruto, totalDividas, totalLiquido },
      update: { totalBruto, totalDividas, totalLiquido },
      select: { id: true, date: true, totalBruto: true, totalDividas: true, totalLiquido: true },
    });

    return NextResponse.json(
      {
        ok: true,
        data: {
          id: upserted.id,
          date: upserted.date.toISOString(),
          totalBruto: upserted.totalBruto,
          totalDividas: upserted.totalDividas,
          totalLiquido: upserted.totalLiquido,
        },
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Erro ao salvar histórico." },
      { status: 500 }
    );
  }
}
