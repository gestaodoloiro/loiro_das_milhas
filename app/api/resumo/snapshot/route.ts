import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toInt(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // ✅ Aceita 2 formatos:
    // (novo) cashCents, totalBruto, totalDividas, totalLiquido
    // (antigo) totalBrutoCents, totalDividasCents, totalLiquidoCents
    const cashCents = toInt(body.cashCents ?? body.caixaCents ?? 0);

    const totalBrutoCents = toInt(body.totalBruto ?? body.totalBrutoCents);
    const totalDividasCents = toInt(body.totalDividas ?? body.totalDividasCents);
    const totalLiquidoCents = toInt(body.totalLiquido ?? body.totalLiquidoCents);

    if (
      cashCents == null ||
      totalBrutoCents == null ||
      totalDividasCents == null ||
      totalLiquidoCents == null
    ) {
      return NextResponse.json(
        { ok: false, error: "Valores inválidos." },
        { status: 400 }
      );
    }

    // 📅 usa o dia atual (00:00)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.cashSnapshot.upsert({
      where: { date: today },
      create: {
        date: today,
        cashCents,
        totalBruto: totalBrutoCents,
        totalDividas: totalDividasCents,
        totalLiquido: totalLiquidoCents,
      },
      update: {
        cashCents,
        totalBruto: totalBrutoCents,
        totalDividas: totalDividasCents,
        totalLiquido: totalLiquidoCents,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Erro ao salvar histórico." },
      { status: 500 }
    );
  }
}
