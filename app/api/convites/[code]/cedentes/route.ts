// app/api/convites/[code]/cedentes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noCacheHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  };
}

function onlyDigits(v: string) {
  return (v || "").replace(/\D+/g, "");
}

function getClientIp(req: NextRequest) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xr = req.headers.get("x-real-ip");
  if (xr) return xr.trim();
  return null;
}

function safeIsoDateToDate(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;

  // esperado: YYYY-MM-DD (ou ISO)
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

const PIX_TIPOS = new Set(["CPF", "CNPJ", "EMAIL", "TELEFONE", "ALEATORIA"] as const);

function normalizeString(v: unknown, max = 255): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeInt(v: unknown, def = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return i < 0 ? 0 : i;
}

// ✅ gera identificador interno (não expor no frontend)
function makeIdentifier(nomeCompleto: string) {
  const cleaned = (nomeCompleto || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .trim();

  const first = (cleaned.split(/\s+/)[0] || "CED").replace(/[^A-Z0-9]/g, "");
  const prefix = (first.slice(0, 3) || "CED").padEnd(3, "X");

  const time = Date.now().toString().slice(-6);
  const rnd = Math.floor(Math.random() * 9000 + 1000); // 4 dígitos
  return `${prefix}-${time}${rnd}`;
}

async function createCedenteWithRetry(tx: any, data: any, retries = 6) {
  let lastErr: any = null;

  for (let i = 0; i < retries; i++) {
    try {
      const identificador = makeIdentifier(data.nomeCompleto);

      const cedente = await tx.cedente.create({
        data: {
          ...data,
          identificador,
        },
        select: {
          id: true,
          identificador: true,
          nomeCompleto: true,
          cpf: true,
          ownerId: true,
          inviteId: true,
          createdAt: true,
        },
      });

      return cedente;
    } catch (e: any) {
      lastErr = e;

      if (e?.code === "P2002") {
        const target = Array.isArray(e?.meta?.target)
          ? e.meta.target.join(",")
          : String(e?.meta?.target || "");

        // CPF duplicado não adianta retry
        if (target.includes("cpf")) throw e;

        // identificador (ou outro unique) -> tenta de novo
        continue;
      }

      throw e;
    }
  }

  throw lastErr || new Error("Falha ao gerar identificador único.");
}

// ✅ Next 16: params é Promise
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await req.json().catch(() => ({} as any));

    // ✅ valida convite
    const invite = await prisma.employeeInvite.findUnique({
      where: { code },
      select: { id: true, isActive: true, userId: true },
    });

    if (!invite || !invite.isActive) {
      return NextResponse.json(
        { ok: false, error: "Convite inválido ou inativo." },
        { status: 404, headers: noCacheHeaders() }
      );
    }

    // ✅ termo obrigatório
    const termoAceito = Boolean(body?.termoAceito);
    const termoVersao = String(body?.termoVersao || "").trim();
    if (!termoAceito || !termoVersao) {
      return NextResponse.json(
        { ok: false, error: "Você precisa aceitar o termo para continuar." },
        { status: 400, headers: noCacheHeaders() }
      );
    }

    // ✅ campos mínimos
    const nomeCompleto = String(body?.nomeCompleto || "").trim();
    const cpf = onlyDigits(String(body?.cpf || "")).slice(0, 11);

    if (!nomeCompleto) {
      return NextResponse.json(
        { ok: false, error: "Informe o nome completo." },
        { status: 400, headers: noCacheHeaders() }
      );
    }
    if (!cpf || cpf.length !== 11) {
      return NextResponse.json(
        { ok: false, error: "CPF inválido (11 dígitos)." },
        { status: 400, headers: noCacheHeaders() }
      );
    }

    // ✅ telefone (obrigatório no onboarding)
    const telefoneDigits = onlyDigits(String(body?.telefone || "")).slice(0, 11);
    if (!telefoneDigits) {
      return NextResponse.json(
        { ok: false, error: "Informe o telefone." },
        { status: 400, headers: noCacheHeaders() }
      );
    }
    if (!(telefoneDigits.length === 10 || telefoneDigits.length === 11)) {
      return NextResponse.json(
        { ok: false, error: "Telefone inválido (DDD + número)." },
        { status: 400, headers: noCacheHeaders() }
      );
    }

    // ✅ banco/PIX obrigatórios
    const banco = String(body?.banco || "").trim();
    const chavePix = String(body?.chavePix || "").trim();

    if (!banco) {
      return NextResponse.json(
        { ok: false, error: "Informe o banco (pagamento apenas ao titular)." },
        { status: 400, headers: noCacheHeaders() }
      );
    }
    if (!chavePix) {
      return NextResponse.json(
        { ok: false, error: "Informe a chave PIX do titular (pagamento apenas ao titular)." },
        { status: 400, headers: noCacheHeaders() }
      );
    }

    // ✅ pixTipo obrigatório (Prisma: PixTipo sem ?)
    const pixTipoRaw = body?.pixTipo ? String(body.pixTipo).trim().toUpperCase() : null;
    if (!pixTipoRaw) {
      return NextResponse.json(
        { ok: false, error: "Informe o tipo da chave PIX." },
        { status: 400, headers: noCacheHeaders() }
      );
    }
    if (!PIX_TIPOS.has(pixTipoRaw as any)) {
      return NextResponse.json(
        { ok: false, error: "Tipo PIX inválido." },
        { status: 400, headers: noCacheHeaders() }
      );
    }
    const pixTipo = pixTipoRaw as any;

    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent");

    /**
     * ✅ AJUSTE DEFINITIVO:
     * - Prisma Cedente tem: senhaEmail/senhaSmiles/senhaLatamPass/senhaLivelo/senhaEsfera
     * - Frontend manda: senhaEmailEnc etc
     * Então: aceitamos ambos e salvamos nos campos corretos.
     */
    const senhaEmail = normalizeString(body?.senhaEmailEnc ?? body?.senhaEmail, 255);
    const senhaSmiles = normalizeString(body?.senhaSmilesEnc ?? body?.senhaSmiles, 255);
    const senhaLatamPass = normalizeString(body?.senhaLatamPassEnc ?? body?.senhaLatamPass, 255);
    const senhaLivelo = normalizeString(body?.senhaLiveloEnc ?? body?.senhaLivelo, 255);
    const senhaEsfera = normalizeString(body?.senhaEsferaEnc ?? body?.senhaEsfera, 255);

    const baseCedenteData = {
      nomeCompleto,
      cpf,
      dataNascimento: safeIsoDateToDate(body?.dataNascimento),

      telefone: telefoneDigits,
      emailCriado: normalizeString(body?.emailCriado, 120),

      banco,
      pixTipo,
      chavePix,
      titularConfirmado: true,

      // ✅ campos reais do Prisma
      senhaEmail,
      senhaSmiles,
      senhaLatamPass,
      senhaLivelo,
      senhaEsfera,

      pontosLatam: normalizeInt(body?.pontosLatam, 0),
      pontosSmiles: normalizeInt(body?.pontosSmiles, 0),
      pontosLivelo: normalizeInt(body?.pontosLivelo, 0),
      pontosEsfera: normalizeInt(body?.pontosEsfera, 0),

      ownerId: invite.userId,
      inviteId: invite.id,
    };

    const created = await prisma.$transaction(async (tx) => {
      const cedente = await createCedenteWithRetry(tx, baseCedenteData, 6);

      await tx.cedenteTermAcceptance.create({
        data: {
          cedenteId: cedente.id,
          termoVersao,
          ip: ip || null,
          userAgent: userAgent || null,
        },
      });

      await tx.employeeInvite.update({
        where: { id: invite.id },
        data: { uses: { increment: 1 }, lastUsedAt: new Date() },
      });

      return cedente;
    });

    return NextResponse.json(
      { ok: true, data: created },
      { status: 201, headers: noCacheHeaders() }
    );
  } catch (e: any) {
    console.error("Erro POST /api/convites/[code]/cedentes:", e);

    if (e?.code === "P2002") {
      return NextResponse.json(
        { ok: false, error: "Já existe um cadastro com esses dados (CPF ou identificador)." },
        { status: 409, headers: noCacheHeaders() }
      );
    }

    return NextResponse.json(
      { ok: false, error: e?.message || "Erro ao cadastrar." },
      { status: 500, headers: noCacheHeaders() }
    );
  }
}
