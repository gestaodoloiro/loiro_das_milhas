import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api";
import { recomputeCompra } from "@/lib/compras";
import { getSessionServer } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

/**
 * Body opcional:
 * {
 *   saldosAplicados?: {
 *     latam?: number, smiles?: number, livelo?: number, esfera?: number,
 *     azul?: number, iberia?: number, aa?: number, tap?: number, flyingBlue?: number
 *   }
 * }
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    if (!id) return badRequest("id é obrigatório.");

    // ✅ sessão vem do cookie (server)
    const session = await getSessionServer();
    const userId = String(session?.id || "");
    if (!userId) return badRequest("Sessão inválida: faça login novamente.");

    // body pode ser vazio
    const body = await req.json().catch(() => ({} as any));

    // 1) valida compra
    const compraBase = await prisma.purchase.findUnique({
      where: { id },
      include: { cedente: true },
    });
    if (!compraBase) return notFound("Compra não encontrada.");
    if (compraBase.status !== "OPEN") {
      return badRequest("Só pode liberar compra OPEN.");
    }

    // 2) recompute antes de aplicar
    await recomputeCompra(id);

    // 3) recarrega (garante valores atualizados)
    const compra = await prisma.purchase.findUnique({
      where: { id },
      include: { cedente: true },
    });
    if (!compra) return notFound("Compra não encontrada (pós-recompute).");
    if (compra.status !== "OPEN") {
      return badRequest("Só pode liberar compra OPEN.");
    }
    if (!compra.cedente) return badRequest("Cedente não encontrado na compra.");

    // 4) transação: aplica saldo no cedente + fecha compra + libera itens + gera comissão
    const result = await prisma.$transaction(async (tx) => {
      const stillOpen = await tx.purchase.findUnique({
        where: { id },
        include: { cedente: true, items: true },
      });

      if (!stillOpen) throw new Error("Compra não encontrada.");
      if (stillOpen.status !== "OPEN") {
        throw new Error("Compra já não está OPEN (possível dupla liberação).");
      }
      if (!stillOpen.cedente) throw new Error("Cedente não encontrado na compra.");

      const current = {
        latam: clampPts(stillOpen.cedente.pontosLatam),
        smiles: clampPts(stillOpen.cedente.pontosSmiles),
        livelo: clampPts(stillOpen.cedente.pontosLivelo),
        esfera: clampPts(stillOpen.cedente.pontosEsfera),
        azul: clampPts(stillOpen.cedente.pontosAzul),
        iberia: clampPts(stillOpen.cedente.pontosIberia),
        aa: clampPts(stillOpen.cedente.pontosAA),
        tap: clampPts(stillOpen.cedente.pontosTAP),
        flyingBlue: clampPts(stillOpen.cedente.pontosFlyingBlue),
      };

      const deltas = computeProgramDeltas(stillOpen.items || []);

      // Prioridade:
      // 1) body.saldosAplicados (quando front manda ajuste explícito)
      // 2) saldoPrevisto* (legado para os 4 programas originais)
      // 3) saldo atual + deltas dos itens da compra
      const applied = {
        latam: clampPts(
          body?.saldosAplicados?.latam ?? stillOpen.saldoPrevistoLatam ?? current.latam + deltas.latam
        ),
        smiles: clampPts(
          body?.saldosAplicados?.smiles ??
            stillOpen.saldoPrevistoSmiles ??
            current.smiles + deltas.smiles
        ),
        livelo: clampPts(
          body?.saldosAplicados?.livelo ??
            stillOpen.saldoPrevistoLivelo ??
            current.livelo + deltas.livelo
        ),
        esfera: clampPts(
          body?.saldosAplicados?.esfera ??
            stillOpen.saldoPrevistoEsfera ??
            current.esfera + deltas.esfera
        ),
        azul: clampPts(body?.saldosAplicados?.azul ?? current.azul + deltas.azul),
        iberia: clampPts(body?.saldosAplicados?.iberia ?? current.iberia + deltas.iberia),
        aa: clampPts(body?.saldosAplicados?.aa ?? current.aa + deltas.aa),
        tap: clampPts(body?.saldosAplicados?.tap ?? current.tap + deltas.tap),
        flyingBlue: clampPts(
          body?.saldosAplicados?.flyingBlue ?? current.flyingBlue + deltas.flyingBlue
        ),
      };

      // aplica saldos no cedente
      await tx.cedente.update({
        where: { id: stillOpen.cedenteId },
        data: {
          pontosLatam: applied.latam,
          pontosSmiles: applied.smiles,
          pontosLivelo: applied.livelo,
          pontosEsfera: applied.esfera,
          pontosAzul: applied.azul,
          pontosIberia: applied.iberia,
          pontosAA: applied.aa,
          pontosTAP: applied.tap,
          pontosFlyingBlue: applied.flyingBlue,
        },
      });

      // libera itens pendentes
      await tx.purchaseItem.updateMany({
        where: { purchaseId: id, status: "PENDING" },
        data: { status: "RELEASED" },
      });

      // fecha compra + registra saldos aplicados + auditoria
      const closedPurchase = await tx.purchase.update({
        where: { id },
        data: {
          liberadoEm: new Date(),
          liberadoPorId: userId,
          status: "CLOSED",

          saldoAplicadoLatam: applied.latam,
          saldoAplicadoSmiles: applied.smiles,
          saldoAplicadoLivelo: applied.livelo,
          saldoAplicadoEsfera: applied.esfera,
        },
        include: { items: true, cedente: true, liberadoPor: true },
      });

      // gera/atualiza comissão do cedente (se tiver valor)
      let commission: any = null;
      const amountCents = Number(closedPurchase.cedentePayCents || 0);

      if (amountCents > 0) {
        commission = await tx.cedenteCommission.upsert({
          where: { purchaseId: closedPurchase.id },
          create: {
            cedenteId: closedPurchase.cedenteId,
            purchaseId: closedPurchase.id,
            amountCents,
            status: "PENDING",
            generatedById: userId,
            // generatedAt default(now())
          },
          update: {
            amountCents,
            status: "PENDING",
            generatedById: userId,
            // (opcional) se quiser “regerar” data:
            // generatedAt: new Date(),
            paidAt: null,
            paidById: null,
          },
        });
      }

      return { compra: closedPurchase, commission };
    });

    return ok(result);
  } catch (e: any) {
    return serverError("Falha ao liberar compra.", { detail: e?.message });
  }
}

function clampPts(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

type ProgramKey =
  | "latam"
  | "smiles"
  | "livelo"
  | "esfera"
  | "azul"
  | "iberia"
  | "aa"
  | "tap"
  | "flyingBlue";

function toProgramKey(v: any): ProgramKey | null {
  const up = String(v || "").trim().toUpperCase();
  if (up === "LATAM") return "latam";
  if (up === "SMILES") return "smiles";
  if (up === "LIVELO") return "livelo";
  if (up === "ESFERA") return "esfera";
  if (up === "AZUL") return "azul";
  if (up === "IBERIA") return "iberia";
  if (up === "AA") return "aa";
  if (up === "TAP") return "tap";
  if (up === "FLYING_BLUE") return "flyingBlue";
  return null;
}

function computeProgramDeltas(items: any[]) {
  const out: Record<ProgramKey, number> = {
    latam: 0,
    smiles: 0,
    livelo: 0,
    esfera: 0,
    azul: 0,
    iberia: 0,
    aa: 0,
    tap: 0,
    flyingBlue: 0,
  };

  for (const it of items || []) {
    if (String(it?.status || "").toUpperCase() === "CANCELED") continue;

    const programTo = toProgramKey(it?.programTo);
    if (programTo) out[programTo] += clampPts(it?.pointsFinal);

    const programFrom = toProgramKey(it?.programFrom);
    if (programFrom) out[programFrom] -= clampPts(it?.pointsDebitedFromOrigin);
  }

  return out;
}
