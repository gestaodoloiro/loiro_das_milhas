// prisma.config.ts
import "dotenv/config";
import { defineConfig } from "@prisma/config";

const prismaCliUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!prismaCliUrl) {
  throw new Error("Defina DIRECT_URL ou DATABASE_URL para executar comandos Prisma.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: prismaCliUrl },
});
