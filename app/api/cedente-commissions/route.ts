import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api";
import { getSessionServer } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await getSessionServer();
    const userId = String(session?.id || "");
    if (!userId) return badRequest("Sessão inválida: faça login novamente.");

    const url = new URL(req.url);

    const status = (url.searchParams.get("status") || "").toUpperCase();
    const cedenteId = url.searchParams.get("cedenteId") || "";
    const purchaseId = url.searchParams.get("purchaseId") || "";

    const from = url.searchParams.get("from"); // YYYY-MM-DD
    const to = url.searchParams.get("to"); // YYYY-MM-DD

    const takeRaw = Number(url.searchParams.get("take") || 50);
    const skipRaw = Number(url.searchParams.get("skip") || 0);

    const take = clampInt(takeRaw, 1, 200);
    const skip = clampInt(skipRaw, 0, 1_000_000);

    const where: any = {};

    if (status) {
      if (!["PENDING", "PAID", "CANCELED"].includes(status)) {
        return badRequest("status inválido. Use PENDING, PAID ou CANCELED.");
      }
      where.status = status;
    }

    if (cedenteId) where.cedenteId = cedenteId;
    if (purchaseId) where.purchaseId = purchaseId;

    if (from || to) {
      where.generatedAt = {};
      if (from) where.generatedAt.gte = parseDateOnly(from);
      if (to) where.generatedAt.lte = endOfDay(parseDateOnly(to));
    }

    const [items, total] = await prisma.$transaction([
      prisma.cedenteCommission.findMany({
        where,
        orderBy: { generatedAt: "desc" },
        take,
        skip,
        include: {
          cedente: { select: { id: true, nomeCompleto: true, cpf: true, identificador: true } },
          purchase: { select: { id: true, numero: true, status: true, totalCents: true } },
          generatedBy: { select: { id: true, name: true, login: true } },
          paidBy: { select: { id: true, name: true, login: true } },
        },
      }),
      prisma.cedenteCommission.count({ where }),
    ]);

    return ok({ total, take, skip, items });
  } catch (e: any) {
    return serverError("Falha ao listar comissões.", { detail: e?.message });
  }
}

function clampInt(v: any, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function parseDateOnly(s: string) {
  // espera YYYY-MM-DD
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error("Data inválida.");
  return d;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}
