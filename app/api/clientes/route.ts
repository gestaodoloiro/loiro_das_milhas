// app/api/clientes/route.ts
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
  // aceita 11 (CPF) ou 14 (CNPJ), senão rejeita
  if (d.length !== 11 && d.length !== 14) return "__INVALID__";
  return d;
}

function cleanTelefone(v: any) {
  const d = onlyDigits(v);
  if (!d) return null;
  // deixa flexível: 10-13 (com DDI etc)
  if (d.length < 10 || d.length > 13) return "__INVALID__";
  return d;
}

const TIPOS = ["PESSOA", "EMPRESA"] as const;
const ORIGENS = ["BALCAO_MILHAS", "PARTICULAR", "SITE", "OUTROS"] as const;

type ClienteTipo = (typeof TIPOS)[number];
type ClienteOrigem = (typeof ORIGENS)[number];

function isTipo(v: any): v is ClienteTipo {
  return TIPOS.includes(String(v) as any);
}
function isOrigem(v: any): v is ClienteOrigem {
  return ORIGENS.includes(String(v) as any);
}

function pad5(n: number) {
  return String(n).padStart(5, "0");
}

export async function GET(req: NextRequest) {
  try {
    // opcional: filtro simples por q
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();

    const where = q
      ? {
          OR: [
            { nome: { contains: q, mode: "insensitive" as const } },
            { identificador: { contains: q, mode: "insensitive" as const } },
            { cpfCnpj: { contains: onlyDigits(q), mode: "insensitive" as const } },
          ],
        }
      : {};

    const clientes = await prisma.cliente.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
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

    return NextResponse.json({ ok: true, data: { clientes } }, { status: 200 });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Erro ao listar clientes." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionServer();
    const userId = String(session?.id || "");
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Sessão inválida: faça login novamente." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));

    const tipo: ClienteTipo = isTipo(body?.tipo) ? body.tipo : "PESSOA";

    const nome = String(body?.nome ?? "").trim();
    if (!nome) {
      return NextResponse.json(
        { ok: false, error: "Informe o nome (ou empresa)." },
        { status: 400 }
      );
    }

    const origem: ClienteOrigem | null = isOrigem(body?.origem) ? body.origem : null;
    if (!origem) {
      return NextResponse.json(
        { ok: false, error: "Informe a origem." },
        { status: 400 }
      );
    }

    const origemDescricao = String(body?.origemDescricao ?? "").trim() || null;
    if (origem === "OUTROS" && !origemDescricao) {
      return NextResponse.json(
        { ok: false, error: "Em 'Outros', descreva a origem." },
        { status: 400 }
      );
    }

    const cpfCnpj = cleanCpfCnpj(body?.cpfCnpj);
    if (cpfCnpj === "__INVALID__") {
      return NextResponse.json(
        { ok: false, error: "CPF/CNPJ inválido (use 11 ou 14 dígitos)." },
        { status: 400 }
      );
    }

    const telefone = cleanTelefone(body?.telefone);
    if (telefone === "__INVALID__") {
      return NextResponse.json(
        { ok: false, error: "Telefone inválido." },
        { status: 400 }
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      // contador sequencial CL00001
      const counter = await tx.counter.upsert({
        where: { key: "cliente" },
        create: { key: "cliente", value: 1 },
        update: { value: { increment: 1 } },
        select: { value: true },
      });

      const identificador = `CL${pad5(counter.value)}`;

      const cliente = await tx.cliente.create({
        data: {
          identificador,
          tipo,
          nome,
          cpfCnpj,
          telefone,
          origem,
          origemDescricao: origem === "OUTROS" ? origemDescricao : null,
          createdById: userId,
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

      return cliente;
    });

    return NextResponse.json({ ok: true, data: { cliente: created } }, { status: 201 });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Erro ao criar cliente." },
      { status: 500 }
    );
  }
}
