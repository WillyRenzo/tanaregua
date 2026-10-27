-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "no_show_justification" TEXT;

-- AlterTable
ALTER TABLE "barbershops" ADD COLUMN     "reschedule_min_notice_minutes" INTEGER NOT NULL DEFAULT 1440;


-- ───────────── SQL manual (CHECKs que o schema.prisma não expressa) ─────────────

ALTER TABLE "barbershops"
  ADD CONSTRAINT barbershops_reschedule_notice_check
  CHECK (reschedule_min_notice_minutes BETWEEN 0 AND 10080);

-- Justificativa só existe em falta.
ALTER TABLE "appointments"
  ADD CONSTRAINT appointments_no_show_justification_check
  CHECK (no_show_justification IS NULL OR status = 'NO_SHOW');
