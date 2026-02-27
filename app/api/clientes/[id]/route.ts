// app/api/clientes/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionServer } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function onlyDigits(v: any) {
  return String(v ?? "").replace(/\D+/g, "");
}

function cleanCpfCnpj(v: any) {
  const d = onlyDigits(v);
  if (!d) return null;
  if (d.length !== 11 && d.length !== 14) return "__INVALID__";
  return d;
}

function cleanTelefone(v: any) {
  const d = onlyDigits(v);
  if (!d) return null;
  if (d.length < 10 || d.length > 13) return "__INVALID__";
  return d;
}

const TIPOS = ["PESSOA", "EMPRESA"] as const;
const ORIGENS = ["BALCAO_MILHAS", "PARTICULAR", "SITE", "OUTROS"] as const;

function isTipo(v: any) {
  return TIPOS.includes(String(v) as any);
}
function isOrigem(v: any) {
  return ORIGENS.includes(String(v) as any);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const cliente = await prisma.cliente.findUnique({
      where: { id },
      select: {
        id: true,
        identificador: true,
        tipo: true,
        nome: true,
        cpfCnpj: true,
        telefone: true,
        origem: true,
        origemDescricao: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!cliente) return NextResponse.json({ ok: false, error: "Cliente não encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true, data: { cliente } }, { status: 200 });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Erro ao carregar cliente." },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionServer();
    const userId = String(session?.id || "");
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Sessão inválida." }, { status: 401 });
    }

    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const nome = String(body?.nome ?? "").trim();
    if (!nome) {
      return NextResponse.json({ ok: false, error: "Informe o nome (ou empresa)." }, { status: 400 });
    }

    const tipo = isTipo(body?.tipo) ? body.tipo : undefined;
    const origem = isOrigem(body?.origem) ? body.origem : undefined;

    const origemDescricao = String(body?.origemDescricao ?? "").trim() || null;
    if (origem === "OUTROS" && !origemDescricao) {
      return NextResponse.json({ ok: false, error: "Em 'Outros', descreva a origem." }, { status: 400 });
    }

    const cpfCnpj = cleanCpfCnpj(body?.cpfCnpj);
    if (cpfCnpj === "__INVALID__") {
      return NextResponse.json({ ok: false, error: "CPF/CNPJ inválido (11 ou 14 dígitos)." }, { status: 400 });
    }

    const telefone = cleanTelefone(body?.telefone);
    if (telefone === "__INVALID__") {
      return NextResponse.json({ ok: false, error: "Telefone inválido." }, { status: 400 });
    }

    const updated = await prisma.cliente.update({
      where: { id },
      data: {
        tipo,
        nome,
        cpfCnpj,
        telefone,
        origem,
        origemDescricao: (origem ?? undefined) === "OUTROS" ? origemDescricao : null,
      },
      select: {
        id: true,
        identificador: true,
        tipo: true,
        nome: true,
        cpfCnpj: true,
        telefone: true,
        origem: true,
        origemDescricao: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ ok: true, data: { cliente: updated } }, { status: 200 });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Erro ao atualizar cliente." },
      { status: 500 }
    );
  }
}
