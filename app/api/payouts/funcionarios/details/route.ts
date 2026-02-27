// app/api/payouts/funcionarios/details/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function safeInt(v: any, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fb;
}

function isISODate(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test((v || "").trim());
}

function isISOMonth(v: string) {
  return /^\d{4}-\d{2}$/.test((v || "").trim());
}

function monthFromISODate(dateISO: string) {
  return String(dateISO || "").slice(0, 7);
}

/**
 * Bounds do dia em UTC para não “perder” vendas por timezone.
 * dateISO: "YYYY-MM-DD"
 */
function dayBoundsUTC(dateISO: string) {
  if (!isISODate(dateISO)) {
    throw new Error("date inválido. Use YYYY-MM-DD");
  }
  const start = new Date(`${dateISO}T00:00:00.000Z`);
  const end = new Date(`${dateISO}T24:00:00.000Z`);
  return { start, end };
}

/**
 * Bounds do mês em UTC.
 * month: "YYYY-MM"
 */
function monthBoundsUTC(month: string) {
  if (!isISOMonth(month)) {
    throw new Error("month inválido. Use YYYY-MM");
  }
  const [yy, mm] = month.split("-").map((x) => Number(x));
  const start = new Date(Date.UTC(yy, mm - 1, 1));
  const end = new Date(Date.UTC(yy, mm, 1)); // 1º do mês seguinte
  return { start, end };
}

/**
 * ⚠️ Se você já tem essas regras num arquivo shared, importe de lá.
 * Aqui deixei simples pra não depender do compute/day.
 */
function commission1Fallback(pointsValueCents: number) {
  // 1%
  return Math.round(Math.max(0, safeInt(pointsValueCents, 0)) * 0.01);
}

function pointsValueCentsFallback(points: number, milheiroCents: number) {
  const denom = (safeInt(points, 0) || 0) / 1000;
  if (denom <= 0) return 0;
  return Math.round(denom * safeInt(milheiroCents, 0));
}

// se você tiver regra real do bônus (C2), plugue aqui
function bonusFallback(/* sale */ _s: any) {
  return 0;
}

function isoDayUTC(d: Date) {
  // Date -> "YYYY-MM-DD" em UTC
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const url = new URL(req.url);

  const date = String(url.searchParams.get("date") || "").trim(); // sempre obrigatório (pra UX do front)
  const userId = String(url.searchParams.get("userId") || "").trim();
  const includeLines = String(url.searchParams.get("includeLines") || "") === "1";
  const month = String(url.searchParams.get("month") || "").trim(); // opcional "YYYY-MM"

  if (!date) return bad("date é obrigatório (YYYY-MM-DD)");
  if (!isISODate(date)) return bad("date inválido. Use YYYY-MM-DD");
  if (!userId) return bad("userId é obrigatório");
  if (month && !isISOMonth(month)) return bad("month inválido. Use YYYY-MM");

  const scopeMonth = !!month;
  const monthKey = scopeMonth ? month.slice(0, 7) : monthFromISODate(date);

  // ✅ carrega payouts do banco (fonte de verdade)
  const payouts = await prisma.employeePayout.findMany({
    where: {
      team: session.team,
      userId,
      ...(scopeMonth ? { date: { startsWith: monthKey } } : { date }),
    },
    include: {
      user: { select: { id: true, name: true, login: true } },
      paidBy: { select: { id: true, name: true } },
    },
    orderBy: { date: "asc" },
    take: scopeMonth ? 80 : 1,
  });

  const payout = payouts[0] || null;

  const base: any = {
    ok: true,
    scope: scopeMonth ? "month" : "day",
    date,
    month: monthKey,
    user: payout?.user || null,
    payout: payout
      ? {
          id: payout.id,
          team: payout.team,
          date: payout.date,
          userId: payout.userId,
          grossProfitCents: safeInt(payout.grossProfitCents, 0),
          tax7Cents: safeInt(payout.tax7Cents, 0),
          feeCents: safeInt(payout.feeCents, 0),
          netPayCents: safeInt(payout.netPayCents, 0),
          paidAt: payout.paidAt ? payout.paidAt.toISOString() : null,
          paidById: payout.paidById ?? null,
          paidBy: payout.paidBy ?? null,
        }
      : null,
    payouts: scopeMonth
      ? payouts.map((p) => ({
          date: p.date,
          grossProfitCents: safeInt(p.grossProfitCents, 0),
          tax7Cents: safeInt(p.tax7Cents, 0),
          feeCents: safeInt(p.feeCents, 0),
          netPayCents: safeInt(p.netPayCents, 0),
          breakdown: (p.breakdown as any) ?? null,
          paidAt: p.paidAt ? p.paidAt.toISOString() : null,
          paidById: p.paidById ?? null,
        }))
      : undefined,
    breakdown: payout ? ((payout.breakdown as any) ?? null) : null,
    explain: payout
      ? {
          gross: "Bruto = C1 + C2 + C3",
          tax: "Imposto = 8% (salvo em tax7Cents)",
          fee: "Taxas = reembolso taxa embarque (feeCents)",
          lucroSemTaxa: "Lucro s/ taxa = gross - tax",
          net: "Líquido (a pagar) = netPayCents (já inclui fee)",
        }
      : null,
  };

  if (!includeLines) {
    return NextResponse.json(base);
  }

  // ==========================
  // ✅ modo “linhas”: auditoria por SALES
  // ==========================
  let start: Date;
  let end: Date;

  try {
    if (scopeMonth) {
      const b = monthBoundsUTC(monthKey);
      start = b.start;
      end = b.end;
    } else {
      const b = dayBoundsUTC(date);
      start = b.start;
      end = b.end;
    }
  } catch (e: any) {
    return bad(e?.message || "Parâmetro inválido");
  }

  const sales = await prisma.sale.findMany({
    where: {
      sellerId: userId,
      date: { gte: start, lt: end },
      // seller é optional no schema -> precisa do "is"
      seller: { is: { team: session.team } },
    },
    select: {
      id: true,
      date: true,
      numero: true,
      locator: true,
      points: true,
      milheiroCents: true,
      pointsValueCents: true,
      embarqueFeeCents: true,
    },
    orderBy: { date: "asc" },
    take: 5000,
  });

  const lineFromSale = (s: any) => {
    const pvc =
      safeInt(s.pointsValueCents, 0) ||
      pointsValueCentsFallback(safeInt(s.points, 0), safeInt(s.milheiroCents, 0));

    const c1 = commission1Fallback(pvc);
    const c2 = bonusFallback(s);
    const fee = safeInt(s.embarqueFeeCents, 0);

    return {
      ref: { type: "sale", id: s.id },
      numero: s.numero,
      locator: s.locator || null,
      points: safeInt(s.points, 0),
      pointsValueCents: pvc,
      c1Cents: c1,
      c2Cents: c2,
      c3Cents: 0, // ⚠️ C3 depende da sua regra real
      feeCents: fee,
    };
  };

  if (!scopeMonth) {
    const lines = sales.map(lineFromSale);

    const sum = lines.reduce(
      (acc, it) => {
        acc.gross += it.c1Cents + it.c2Cents + it.c3Cents;
        acc.fee += it.feeCents;
        return acc;
      },
      { gross: 0, fee: 0 }
    );

    const audit =
      payout
        ? {
            linesGrossCents: sum.gross,
            payoutGrossCents: safeInt(payout.grossProfitCents, 0),
            diffGrossCents: sum.gross - safeInt(payout.grossProfitCents, 0),

            linesFeeCents: sum.fee,
            payoutFeeCents: safeInt(payout.feeCents, 0),
            diffFeeCents: sum.fee - safeInt(payout.feeCents, 0),
          }
        : null;

    return NextResponse.json({
      ...base,
      lines: { sales: lines },
      audit,
      note:
        "As linhas são uma auditoria/explicação. A fonte de verdade do pagamento é o payout salvo em employee_payouts.",
    });
  }

  // ✅ mês: agrupa por dia (YYYY-MM-DD)
  const byDay = new Map<string, any[]>();
  for (const s of sales) {
    const d = isoDayUTC(new Date(s.date));
    const arr = byDay.get(d) || [];
    arr.push(lineFromSale(s));
    byDay.set(d, arr);
  }

  const days = Array.from(byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, items]) => {
      const sums = items.reduce(
        (acc, it) => {
          acc.gross += it.c1Cents + it.c2Cents + it.c3Cents;
          acc.fee += it.feeCents;
          acc.salesCount += 1;
          return acc;
        },
        { gross: 0, fee: 0, salesCount: 0 }
      );
      return { date: d, sales: items, sums };
    });

  const totalLines = days.reduce(
    (acc, day) => {
      acc.gross += day.sums.gross;
      acc.fee += day.sums.fee;
      acc.salesCount += day.sums.salesCount;
      return acc;
    },
    { gross: 0, fee: 0, salesCount: 0 }
  );

  const totalPayouts = payouts.reduce(
    (acc, p) => {
      acc.gross += safeInt(p.grossProfitCents, 0);
      acc.fee += safeInt(p.feeCents, 0);
      return acc;
    },
    { gross: 0, fee: 0 }
  );

  const auditMonth = {
    linesGrossCents: totalLines.gross,
    payoutsGrossCents: totalPayouts.gross,
    diffGrossCents: totalLines.gross - totalPayouts.gross,

    linesFeeCents: totalLines.fee,
    payoutsFeeCents: totalPayouts.fee,
    diffFeeCents: totalLines.fee - totalPayouts.fee,

    linesSalesCount: totalLines.salesCount,
  };

  return NextResponse.json({
    ...base,
    lines: { days },
    audit: auditMonth,
    note:
      "As linhas são uma auditoria/explicação por SALES. A fonte de verdade do pagamento é o payout salvo em employee_payouts.",
  });
}
