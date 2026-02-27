import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api";
import { recomputeCompra } from "@/lib/compras";
import { getSessionServer } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

/**
 * Body opcional:
 * {
 *   saldosAplicados?: { latam?: number, smiles?: number, livelo?: number, esfera?: number }
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

    // 4) define saldos aplicados (preferência: body > saldoPrevisto* > saldo atual)
    const applied = {
      latam: clampPts(
        body?.saldosAplicados?.latam ??
          compra.saldoPrevistoLatam ??
          compra.cedente.pontosLatam ??
          0
      ),
      smiles: clampPts(
        body?.saldosAplicados?.smiles ??
          compra.saldoPrevistoSmiles ??
          compra.cedente.pontosSmiles ??
          0
      ),
      livelo: clampPts(
        body?.saldosAplicados?.livelo ??
          compra.saldoPrevistoLivelo ??
          compra.cedente.pontosLivelo ??
          0
      ),
      esfera: clampPts(
        body?.saldosAplicados?.esfera ??
          compra.saldoPrevistoEsfera ??
          compra.cedente.pontosEsfera ??
          0
      ),
    };

    // 5) transação: aplica saldo no cedente + fecha compra + libera itens + gera comissão
    const result = await prisma.$transaction(async (tx) => {
      const stillOpen = await tx.purchase.findUnique({
        where: { id },
        include: { cedente: true },
      });

      if (!stillOpen) throw new Error("Compra não encontrada.");
      if (stillOpen.status !== "OPEN") {
        throw new Error("Compra já não está OPEN (possível dupla liberação).");
      }
      if (!stillOpen.cedente) throw new Error("Cedente não encontrado na compra.");

      // aplica saldos no cedente
      await tx.cedente.update({
        where: { id: stillOpen.cedenteId },
        data: {
          pontosLatam: applied.latam,
          pontosSmiles: applied.smiles,
          pontosLivelo: applied.livelo,
          pontosEsfera: applied.esfera,
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
