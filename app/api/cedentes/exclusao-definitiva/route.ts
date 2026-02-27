import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import crypto from "node:crypto";

type SessionCookie = {
  id: string;
  login: string;
  role: "admin" | "staff";
  team: string;
};

type Program = "LATAM" | "SMILES" | "LIVELO" | "ESFERA";
type ScopeMode = "ACCOUNT" | "PROGRAM";

const PROGRAMS: Program[] = ["LATAM", "SMILES", "LIVELO", "ESFERA"];

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function b64urlDecode(input: string) {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64").toString("utf8");
}

function readCookie(req: Request, name: string) {
  const raw = req.headers.get("cookie") || "";
  const parts = raw.split(";").map((s) => s.trim());
  const hit = parts.find((p) => p.startsWith(name + "="));
  if (!hit) return null;
  return decodeURIComponent(hit.slice(name.length + 1));
}

function getSession(req: Request): SessionCookie | null {
  const cookie = readCookie(req, "tm.session");
  if (!cookie) return null;
  try {
    const s = JSON.parse(b64urlDecode(cookie)) as SessionCookie;
    if (!s?.id || !s?.team || !s?.role || !s?.login) return null;
    return s;
  } catch {
    return null;
  }
}

async function requirePassword(req: Request, password: string) {
  const session = getSession(req);
  if (!session) return { ok: false as const, status: 401, error: "Não autenticado." };

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, passwordHash: true, team: true },
  });

  if (!user?.passwordHash) return { ok: false as const, status: 401, error: "Usuário não encontrado." };
  if (user.passwordHash !== sha256(password)) {
    return { ok: false as const, status: 401, error: "Senha inválida." };
  }

  return {
    ok: true as const,
    userId: user.id,
    team: user.team,
    role: session.role,
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

export async function GET(req: Request) {
  try {
    const session = getSession(req);
    if (!session?.id) {
      return NextResponse.json({ ok: false, error: "Não autenticado." }, { status: 401 });
    }

    const rows = await prisma.cedenteExclusion.findMany({
      where: { team: session.team },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        team: true,
        cedenteId: true,
        cedenteIdentificador: true,
        cedenteNomeCompleto: true,
        cedenteCpf: true,
        scope: true,
        program: true,
        details: true,
        createdAt: true,
        deletedBy: { select: { id: true, name: true, login: true } },
      },
    });

    return NextResponse.json({ ok: true, rows });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error, "Erro ao listar excluídos.") },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const cedenteId = String(body?.cedenteId || "").trim();
    const mode = String(body?.mode || "").trim().toUpperCase() as ScopeMode;
    const program = String(body?.program || "").trim().toUpperCase() as Program;
    const password = String(body?.password || "").trim();

    if (!cedenteId) {
      return NextResponse.json({ ok: false, error: "cedenteId obrigatório." }, { status: 400 });
    }
    if (mode !== "ACCOUNT" && mode !== "PROGRAM") {
      return NextResponse.json({ ok: false, error: "Modo inválido." }, { status: 400 });
    }
    if (mode === "PROGRAM" && !PROGRAMS.includes(program)) {
      return NextResponse.json({ ok: false, error: "Programa inválido." }, { status: 400 });
    }
    if (!password) {
      return NextResponse.json({ ok: false, error: "Senha obrigatória." }, { status: 400 });
    }

    const auth = await requirePassword(req, password);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const result = await prisma.$transaction(async (tx) => {
      const ced = await tx.cedente.findUnique({
        where: { id: cedenteId },
        select: {
          id: true,
          identificador: true,
          nomeCompleto: true,
          cpf: true,
          owner: { select: { team: true } },
        },
      });

      if (!ced) throw new Error("Cedente não encontrado.");
      if (ced.owner.team !== auth.team) {
        throw new Error("Sem permissão para excluir cedente de outro time.");
      }

      if (mode === "ACCOUNT") {
        const salesPreserved = await tx.sale.count({ where: { cedenteId } });
        const receivablesPreserved = await tx.receivable.count({
          where: { sale: { is: { cedenteId } } },
        });
        const purchasesPreserved = await tx.purchase.count({ where: { cedenteId } });
        const commissionsPreserved = await tx.cedenteCommission.count({
          where: { cedenteId },
        });

        const blockedDeleted = (await tx.blockedAccount.deleteMany({ where: { cedenteId } })).count;
        const protocolsDeleted = (await tx.protocol.deleteMany({ where: { cedenteId } })).count;
        const clubsDeleted = (await tx.clubSubscription.deleteMany({ where: { cedenteId } })).count;
        const walletDeleted = (await tx.walletBalance.deleteMany({ where: { cedenteId } })).count;
        const latamTurboMonthsDeleted = (
          await tx.latamTurboMonth.deleteMany({ where: { cedenteId } })
        ).count;
        const latamTurboAccountDeleted = (
          await tx.latamTurboAccount.deleteMany({ where: { cedenteId } })
        ).count;

        await tx.cedente.update({
          where: { id: cedenteId },
          data: {
            status: "REJECTED",
            telefone: null,
            emailCriado: null,
            pontosLatam: 0,
            pontosSmiles: 0,
            pontosLivelo: 0,
            pontosEsfera: 0,
            senhaEmail: null,
            senhaSmiles: null,
            senhaLatamPass: null,
            senhaLivelo: null,
            senhaEsfera: null,
          },
        });

        const details = {
          mode,
          historyPreserved: true,
          salesPreserved,
          receivablesPreserved,
          purchasesPreserved,
          commissionsPreserved,
          blockedDeleted,
          protocolsDeleted,
          clubsDeleted,
          walletDeleted,
          latamTurboMonthsDeleted,
          latamTurboAccountDeleted,
          cedenteStatus: "REJECTED",
        };

        await tx.cedenteExclusion.create({
          data: {
            team: auth.team,
            cedenteId: ced.id,
            cedenteIdentificador: ced.identificador,
            cedenteNomeCompleto: ced.nomeCompleto,
            cedenteCpf: ced.cpf,
            scope: "ACCOUNT",
            program: null,
            deletedById: auth.userId,
            details,
          },
        });

        return details;
      }

      const salesPreserved = await tx.sale.count({ where: { cedenteId, program } });
      const receivablesPreserved = await tx.receivable.count({
        where: { sale: { is: { cedenteId, program } } },
      });
      const purchasesPreserved = await tx.purchase.count({
        where: { cedenteId, ciaAerea: program },
      });
      const commissionsPreserved = await tx.cedenteCommission.count({
        where: { cedenteId, purchase: { is: { ciaAerea: program } } },
      });

      const blockedDeleted = (
        await tx.blockedAccount.deleteMany({ where: { cedenteId, program } })
      ).count;
      const protocolsDeleted = (
        await tx.protocol.deleteMany({ where: { cedenteId, program } })
      ).count;
      const clubsDeleted = (
        await tx.clubSubscription.deleteMany({ where: { cedenteId, program } })
      ).count;
      const walletDeleted = (
        await tx.walletBalance.deleteMany({ where: { cedenteId, program } })
      ).count;

      let latamTurboMonthsDeleted = 0;
      let latamTurboAccountDeleted = 0;
      if (program === "LATAM") {
        latamTurboMonthsDeleted = (
          await tx.latamTurboMonth.deleteMany({ where: { cedenteId } })
        ).count;
        latamTurboAccountDeleted = (
          await tx.latamTurboAccount.deleteMany({ where: { cedenteId } })
        ).count;
      }

      const cedentePatch: Prisma.CedenteUpdateInput = {};
      if (program === "LATAM") {
        cedentePatch.pontosLatam = 0;
        cedentePatch.senhaLatamPass = null;
      } else if (program === "SMILES") {
        cedentePatch.pontosSmiles = 0;
        cedentePatch.senhaSmiles = null;
      } else if (program === "LIVELO") {
        cedentePatch.pontosLivelo = 0;
        cedentePatch.senhaLivelo = null;
      } else if (program === "ESFERA") {
        cedentePatch.pontosEsfera = 0;
        cedentePatch.senhaEsfera = null;
      }

      await tx.cedente.update({ where: { id: cedenteId }, data: cedentePatch });

      const details = {
        mode,
        program,
        historyPreserved: true,
        salesPreserved,
        receivablesPreserved,
        purchasesPreserved,
        commissionsPreserved,
        blockedDeleted,
        protocolsDeleted,
        clubsDeleted,
        walletDeleted,
        latamTurboMonthsDeleted,
        latamTurboAccountDeleted,
      };

      await tx.cedenteExclusion.create({
        data: {
          team: auth.team,
          cedenteId: ced.id,
          cedenteIdentificador: ced.identificador,
          cedenteNomeCompleto: ced.nomeCompleto,
          cedenteCpf: ced.cpf,
          scope: "PROGRAM",
          program,
          deletedById: auth.userId,
          details,
        },
      });

      return details;
    });

    return NextResponse.json({ ok: true, result });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error, "Falha na exclusão definitiva.") },
      { status: 500 }
    );
  }
}
