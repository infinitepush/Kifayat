/**
 * Prisma client singleton for Next.js
 *
 * In development, Next.js hot-reloads modules, which would create a new
 * PrismaClient on every reload and exhaust the SQLite connection pool.
 * This pattern stores one instance on the global object to survive hot-reloads.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
