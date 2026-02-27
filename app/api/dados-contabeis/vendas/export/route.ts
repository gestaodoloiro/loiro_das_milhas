import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function nextMonthStart(yyyyMm: string) {
  const [yStr, mStr] = String(yyyyMm || "").split("-");
  let y = Number(yStr);
  let m = Number(mStr);
  if (!y || !m) return "";
  m += 1;
  if (m === 13) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function addDaysISO(iso: string, days: number) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + (days || 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** ✅ Igual ao preview: ISO -> Date UTC 00:00Z */
function isoToUTCDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

function isoDateOnlyUTC(d: Date) {
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function cleanDoc(v: string) {
  return String(v || "").replace(/\D+/g, "");
}

function safeInt(v: unknown, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fb;
}

/**
 * ✅ Rateio proporcional (idêntico ao preview)
 * Só rateia se totalProfitCents > 0, senão tudo 0
 */
function splitProfitProportional(
  items: Array<{ key: string; totalCents: number }>,
  totalProfitCents: number
) {
  const total = items.reduce((a, x) => a + (x.totalCents || 0), 0);
  if (total <= 0 || totalProfitCents <= 0) {
    return new Map(items.map((i) => [i.key, 0]));
  }

  const tmp = items.map((i) => {
    const raw = (i.totalCents / total) * totalProfitCents;
    return { key: i.key, raw, floor: Math.floor(raw) };
  });

  const allocated = tmp.reduce((a, x) => a + x.floor, 0);
  let remaining = totalProfitCents - allocated;

  tmp.sort((a, b) => (b.raw - b.floor) - (a.raw - a.floor));

  const out = new Map<string, number>();
  for (let i = 0; i < tmp.length; i++) {
    const add = remaining > 0 ? 1 : 0;
    out.set(tmp[i].key, tmp[i].floor + add);
    if (remaining > 0) remaining -= 1;
  }
  return out;
}

function styleHeaderRow(ws: ExcelJS.Worksheet, lastCol: number) {
  const headerRow = ws.getRow(1);
  headerRow.height = 18;
  for (let c = 1; c <= lastCol; c++) {
    const cell = headerRow.getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF3A3A3A" },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFBDBDBD" } },
      left: { style: "thin", color: { argb: "FFBDBDBD" } },
      bottom: { style: "thin", color: { argb: "FFBDBDBD" } },
      right: { style: "thin", color: { argb: "FFBDBDBD" } },
    };
  }
}

// =========================
// ✅ PREJUÍZO DO MÊS — IGUAL AO PREVIEW (/prejuizo-like)
// - purchases CLOSED no mês
// - sales vinculadas (purchaseId pode ser id ou numero em várias capitalizações)
// - ignora CANCELED
// - pvCents fallback total-fee
// - bonus 30% por venda (excedente acima da meta)
// - remove “sem venda” (includeZeroSales=false)
// - soma SOMENTE negativos
// =========================

function milheiroFrom(points: number, pointsValueCents: number) {
  const pts = safeInt(points, 0);
  const cents = safeInt(pointsValueCents, 0);
  if (!pts || !cents) return 0;
  return Math.round((cents * 1000) / pts);
}

function bonus30(points: number, milheiroCents: number, metaMilheiroCents: number) {
  const pts = safeInt(points, 0);
  const mil = safeInt(milheiroCents, 0);
  const meta = safeInt(metaMilheiroCents, 0);
  if (!pts || !mil || !meta) return 0;

  const diff = mil - meta;
  if (diff <= 0) return 0;

  const excedenteCents = Math.round((pts * diff) / 1000);
  return Math.round(excedenteCents * 0.3);
}

function monthBoundsISO(ym: string) {
  if (!/^\d{4}-\d{2}$/.test(String(ym || ""))) return null;
  const startISO = `${ym}-01`;
  const endISO = nextMonthStart(ym);
  if (!endISO) return null;
  return { startISO, endISO };
}

async function computeLossTotalCentsLikePrejuizo(team: string, scopeMonth: string) {
  const mb = monthBoundsISO(scopeMonth);
  if (!mb) return 0;

  const start = new Date(`${mb.startISO}T00:00:00.000Z`);
  const end = new Date(`${mb.endISO}T00:00:00.000Z`);

  const purchasesBase = await prisma.purchase.findMany({
    where: {
      status: "CLOSED",
      finalizedAt: { not: null, gte: start, lt: end },
      cedente: { owner: { team } },
    },
    orderBy: [{ finalizedAt: "desc" }, { updatedAt: "desc" }],
    take: 5000,
    select: {
      id: true,
      numero: true,
      metaMilheiroCents: true,
      totalCents: true,
      finalizedAt: true,
    },
  });

  if (purchasesBase.length === 0) return 0;

  const ids = purchasesBase.map((p) => p.id);
  const numeros = purchasesBase.map((p) => String(p.numero || "").trim()).filter(Boolean);

  const idByNumeroUpper = new Map<string, string>(
    purchasesBase
      .map((p) => [String(p.numero || "").trim().toUpperCase(), p.id] as const)
      .filter(([k]) => !!k)
  );

  const numerosUpper = Array.from(new Set(numeros.map((n) => n.toUpperCase())));
  const numerosLower = Array.from(new Set(numeros.map((n) => n.toLowerCase())));
  const numerosAll = Array.from(new Set([...numeros, ...numerosUpper, ...numerosLower]));

  function normalizePurchaseId(raw: string) {
    const r = (raw || "").trim();
    if (!r) return "";
    const upper = r.toUpperCase();
    return idByNumeroUpper.get(upper) || r;
  }

  const byId = new Map(purchasesBase.map((p) => [p.id, p]));

  const sales = await prisma.sale.findMany({
    where: {
      paymentStatus: { not: "CANCELED" },
      OR: [{ purchaseId: { in: ids } }, { purchaseId: { in: numerosAll } }],
    },
    select: {
      purchaseId: true,
      points: true,
      totalCents: true,
      pointsValueCents: true,
      embarqueFeeCents: true,
      passengers: true,
    },
    take: 20000,
  });

  const agg = new Map<
    string,
    {
      soldPoints: number;
      pax: number;
      salesTotalCents: number;
      salesPointsValueCents: number;
      salesTaxesCents: number;
      bonusCents: number;
      salesCount: number;
    }
  >();

  for (const s of sales) {
    const pid = normalizePurchaseId(String(s.purchaseId || ""));
    if (!pid) continue;

    const totalCents = safeInt(s.totalCents, 0);
    const feeCents = safeInt(s.embarqueFeeCents, 0);
    let pvCents = safeInt(s.pointsValueCents as any, 0);

    // fallback igual ao preview
    if (pvCents <= 0 && totalCents > 0) {
      const cand = Math.max(totalCents - feeCents, 0);
      pvCents = cand > 0 ? cand : totalCents;
    }

    const taxes = Math.max(totalCents - pvCents, 0);

    const cur =
      agg.get(pid) || {
        soldPoints: 0,
        pax: 0,
        salesTotalCents: 0,
        salesPointsValueCents: 0,
        salesTaxesCents: 0,
        bonusCents: 0,
        salesCount: 0,
      };

    cur.soldPoints += safeInt(s.points, 0);
    cur.pax += safeInt(s.passengers, 0);
    cur.salesTotalCents += totalCents;
    cur.salesPointsValueCents += pvCents;
    cur.salesTaxesCents += taxes;
    cur.salesCount += 1;

    const p = byId.get(pid);
    if (p) {
      const mil = milheiroFrom(safeInt(s.points, 0), pvCents);
      cur.bonusCents += bonus30(safeInt(s.points, 0), mil, safeInt(p.metaMilheiroCents, 0));
    }

    agg.set(pid, cur);
  }

  let lossTotalCents = 0; // negativo

  for (const p of purchasesBase) {
    const a =
      agg.get(p.id) || {
        soldPoints: 0,
        pax: 0,
        salesTotalCents: 0,
        salesPointsValueCents: 0,
        salesTaxesCents: 0,
        bonusCents: 0,
        salesCount: 0,
      };

    // remove “sem venda”
    const hasSales =
      safeInt(a.salesCount, 0) > 0 ||
      safeInt(a.salesPointsValueCents, 0) > 0 ||
      safeInt(a.salesTotalCents, 0) > 0 ||
      safeInt(a.soldPoints, 0) > 0;

    if (!hasSales) continue;

    const purchaseTotalCents = safeInt(p.totalCents, 0);
    const profitBruto = a.salesPointsValueCents - purchaseTotalCents;
    const profitLiquido = profitBruto - a.bonusCents;

    if (profitLiquido < 0) lossTotalCents += profitLiquido;
  }

  return lossTotalCents; // negativo
}

export async function GET(req: Request) {
  try {
    const sess = await requireSession();
    const team = String((sess as any)?.team || "");
    const meId = String((sess as any)?.id || "");
    if (!team || !meId) return bad("Não autenticado", 401);

    const url = new URL(req.url);
    const month = String(url.searchParams.get("month") || "");
    const date = String(url.searchParams.get("date") || "");
    const status = String(url.searchParams.get("status") || "ALL").toUpperCase(); // ALL | PAID | PENDING
    const mode = String(url.searchParams.get("mode") || "raw").toLowerCase(); // model | raw
    if (mode !== "model" && mode !== "raw") return bad("mode inválido. Use model|raw");

    let startDate = "";
    let endExclusive = "";
    let scopeMonth = "";

    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad("date inválido. Use YYYY-MM-DD");
      startDate = date;
      endExclusive = addDaysISO(date, 1);
      if (!endExclusive) return bad("date inválido");
      scopeMonth = date.slice(0, 7);
    } else {
      const m = month.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(m)) return bad("month inválido. Use YYYY-MM");
      startDate = `${m}-01`;
      endExclusive = nextMonthStart(m);
      if (!endExclusive) return bad("month inválido");
      scopeMonth = m;
    }

    const startDT = isoToUTCDate(startDate);
    const endDT = isoToUTCDate(endExclusive);
    if (!startDT || !endDT) return bad("Período inválido (datas)");

    const paymentStatusWhere =
      status === "PAID" ? "PAID" : status === "PENDING" ? "PENDING" : undefined;

    // ✅ lucro do período (SEM 8%) — igual preview
    const lucroAgg = await prisma.employeePayout.aggregate({
      where: { team, date: { gte: startDate, lt: endExclusive } },
      _sum: { grossProfitCents: true },
    });
    const profitTotalCents = Number(lucroAgg._sum.grossProfitCents || 0);

    // ✅ prejuízo do mês — IGUAL preview (/prejuizo-like) e só quando é mês inteiro
    const applyLoss = !date;
    const lossTotalCents = applyLoss ? await computeLossTotalCentsLikePrejuizo(team, scopeMonth) : 0;

    // ✅ lucro tributável (não deixar negativo)
    const profitAfterLossCents = Math.max(0, profitTotalCents + lossTotalCents);

    // vendas do período (para montar XLSX)
    const sales = await prisma.sale.findMany({
      where: {
        cedente: { owner: { team } },
        date: { gte: startDT, lt: endDT },
        paymentStatus: paymentStatusWhere ? paymentStatusWhere : { in: ["PAID", "PENDING"] },
      },
      select: {
        id: true,
        numero: true,
        date: true,
        paymentStatus: true,
        totalCents: true,
        cliente: {
          select: { id: true, nome: true, identificador: true, cpfCnpj: true },
        },
      },
      orderBy: [{ date: "asc" }, { numero: "asc" }],
      take: 50000,
    });

    if (mode === "model") {
      // ✅ igual preview: agrupa por doc + nome (não por cliente.id)
      const map = new Map<
        string,
        { key: string; cpfCnpj: string; nome: string; totalServiceCents: number; salesCount: number }
      >();

      for (const s of sales) {
        const doc = cleanDoc(s?.cliente?.cpfCnpj || s?.cliente?.identificador || "") || "";
        const cpfCnpjDisplay = s?.cliente?.cpfCnpj || s?.cliente?.identificador || "—";
        const nome = s?.cliente?.nome || "—";
        const key = `${doc}::${nome}`;

        const prev = map.get(key) || {
          key,
          cpfCnpj: cpfCnpjDisplay,
          nome,
          totalServiceCents: 0,
          salesCount: 0,
        };

        prev.totalServiceCents += s.totalCents || 0;
        prev.salesCount += 1;
        map.set(key, prev);
      }

      const groups = Array.from(map.values());

      const profitMap = splitProfitProportional(
        groups.map((g) => ({ key: g.key, totalCents: g.totalServiceCents })),
        profitAfterLossCents
      );

      const rows = groups
        .map((g) => {
          const lucroCents = profitMap.get(g.key) || 0;
          const deducaoCents = Math.max(0, (g.totalServiceCents || 0) - lucroCents);

          const info = date
            ? `Vendas do dia ${date} (${g.salesCount} venda(s))`
            : `Vendas do mês ${scopeMonth} (${g.salesCount} venda(s))`;

          return {
            cpfCnpj: g.cpfCnpj,
            nome: g.nome,
            info,
            totalCents: g.totalServiceCents,
            deducaoCents,
            lucroCents,
          };
        })
        .sort((a, b) => b.totalCents - a.totalCents);

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Página1", { views: [{ state: "frozen", ySplit: 1 }] });

      ws.columns = [
        { header: "CPF/CNPJ", key: "cpf", width: 18 },
        { header: "NOME", key: "nome", width: 30 },
        { header: "INFORMAÇÕES", key: "info", width: 45 },
        { header: "VALOR TOTAL DO SERVIÇO", key: "total", width: 24 },
        { header: "DEDUÇÕES DA BASE DE CALCULO", key: "deducao", width: 28 },
        { header: "LUCRO", key: "lucro", width: 16 },
      ];

      styleHeaderRow(ws, 6);

      for (const r of rows) {
        ws.addRow({
          cpf: r.cpfCnpj,
          nome: r.nome,
          info: r.info,
          total: (r.totalCents || 0) / 100,
          deducao: (r.deducaoCents || 0) / 100,
          lucro: (r.lucroCents || 0) / 100,
        });
      }

      ["D", "E", "F"].forEach((col) => {
        ws.getColumn(col).numFmt = '"R$"#,##0.00;[Red]-"R$"#,##0.00';
      });

      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } };

      const buf = await wb.xlsx.writeBuffer();
      const label = date ? `vendas_${date}` : `vendas_${scopeMonth}`;

      return new NextResponse(Buffer.from(buf), {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${label}.xlsx"`,
          "Cache-Control": "no-store",
          "X-TM-Profit-Total": String(profitTotalCents),
          "X-TM-Loss-Total": String(lossTotalCents),
          "X-TM-Profit-After-Loss": String(profitAfterLossCents),
        },
      });
    }

    // RAW (detalhado): rateia por venda
    const profitBySale = splitProfitProportional(
      sales.map((s) => ({ key: s.id, totalCents: s.totalCents || 0 })),
      profitAfterLossCents
    );

    const rowsRaw = sales.map((s) => {
      const cpfCnpjDisplay = s?.cliente?.cpfCnpj || s?.cliente?.identificador || "—";
      const nome = s?.cliente?.nome || "—";
      const lucroCents = profitBySale.get(s.id) || 0;

      // ✅ igual preview: não deixa dedução negativa
      const deducaoCents = Math.max(0, (s.totalCents || 0) - lucroCents);

      return {
        date: isoDateOnlyUTC(s.date),
        numero: s.numero || "—",
        status: String((s as any)?.paymentStatus || "—"),
        cpfCnpj: cpfCnpjDisplay,
        nome,
        totalCents: s.totalCents || 0,
        deducaoCents,
        lucroCents,
      };
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Página1", { views: [{ state: "frozen", ySplit: 1 }] });

    ws.columns = [
      { header: "DATA", key: "date", width: 12 },
      { header: "Nº", key: "numero", width: 14 },
      { header: "STATUS", key: "status", width: 12 },
      { header: "CPF/CNPJ", key: "cpf", width: 18 },
      { header: "CLIENTE", key: "nome", width: 30 },
      { header: "VALOR TOTAL DO SERVIÇO", key: "total", width: 24 },
      { header: "DEDUÇÕES DA BASE DE CALCULO", key: "deducao", width: 28 },
      { header: "LUCRO", key: "lucro", width: 16 },
    ];

    styleHeaderRow(ws, 8);

    for (const r of rowsRaw) {
      ws.addRow({
        date: r.date,
        numero: r.numero,
        status: r.status,
        cpf: r.cpfCnpj,
        nome: r.nome,
        total: (r.totalCents || 0) / 100,
        deducao: (r.deducaoCents || 0) / 100,
        lucro: (r.lucroCents || 0) / 100,
      });
    }

    ["F", "G", "H"].forEach((col) => {
      ws.getColumn(col).numFmt = '"R$"#,##0.00;[Red]-"R$"#,##0.00';
    });

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 } };

    const buf = await wb.xlsx.writeBuffer();
    const label = date ? `vendas_${date}_raw` : `vendas_${scopeMonth}_raw`;

    return new NextResponse(Buffer.from(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${label}.xlsx"`,
        "Cache-Control": "no-store",
        "X-TM-Profit-Total": String(profitTotalCents),
        "X-TM-Loss-Total": String(lossTotalCents),
        "X-TM-Profit-After-Loss": String(profitAfterLossCents),
      },
    });
  } catch (e: any) {
    const msg = e?.message === "UNAUTHENTICATED" ? "Não autenticado" : e?.message || String(e);
    const status = e?.message === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
