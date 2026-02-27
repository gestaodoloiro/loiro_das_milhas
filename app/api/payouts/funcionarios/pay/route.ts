import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-server";
import { todayISORecife } from "@/lib/payouts/employeePayouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isISODate(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test((v || "").trim());
}

export async function POST(req: Request) {
  try {
    const sess = await requireSession();
    const team = String((sess as any)?.team || "");
    const meId = String((sess as any)?.id || "");
    const role = String((sess as any)?.role || "");

    if (!team || !meId) {
      return NextResponse.json({ ok: false, error: "Não autenticado" }, { status: 401 });
    }

    // ✅ sugiro travar pagamento só pra admin
    if (role !== "admin") {
      return NextResponse.json({ ok: false, error: "Sem permissão para pagar." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const date = String(body?.date || "").slice(0, 10);
    const userId = String(body?.userId || "");

    if (!date || !userId) {
      return NextResponse.json({ ok: false, error: "date e userId obrigatórios" }, { status: 400 });
    }
    if (!isISODate(date)) {
      return NextResponse.json({ ok: false, error: "date inválido (YYYY-MM-DD)" }, { status: 400 });
    }

    const today = todayISORecife();
    if (date >= today) {
      return NextResponse.json(
        { ok: false, error: "Só paga dia fechado (apenas dias anteriores a hoje)." },
        { status: 400 }
      );
    }

    // 1) tenta pagar de forma atômica (evita corrida)
    const res = await prisma.employeePayout.updateMany({
      where: { team, date, userId, paidById: null },
      data: { paidById: meId, paidAt: new Date() },
    });

    // 2) lê a linha final (paga ou já paga)
    const row = await prisma.employeePayout.findFirst({
      where: { team, date, userId },
      include: {
        user: { select: { id: true, name: true, login: true } },
        paidBy: { select: { id: true, name: true } },
      },
    });

    if (!row) {
      return NextResponse.json({ ok: false, error: "Payout não encontrado." }, { status: 404 });
    }

    // se res.count === 0, significa que já estava pago (idempotente)
    return NextResponse.json({ ok: true, updated: row, changed: res.count === 1 });
  } catch (e: any) {
    const msg = e?.message === "UNAUTHENTICATED" ? "Não autenticado" : e?.message || String(e);
    const status = e?.message === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
