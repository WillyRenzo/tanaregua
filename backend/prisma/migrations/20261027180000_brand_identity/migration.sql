-- AlterTable
ALTER TABLE "barbershops" ADD COLUMN     "brand_primary_color" TEXT,
ADD COLUMN     "brand_secondary_color" TEXT,
ADD COLUMN     "logo_key" TEXT;


-- ───────────── SQL manual (CHECKs que o schema.prisma não expressa) ─────────────

-- Cores só em hex minúsculo: nada de texto livre indo para CSS (security.md).
ALTER TABLE "barbershops"
  ADD CONSTRAINT barbershops_brand_primary_color_check
  CHECK (brand_primary_color IS NULL OR brand_primary_color ~ '^#[0-9a-f]{6}$'),
  ADD CONSTRAINT barbershops_brand_secondary_color_check
  CHECK (brand_secondary_color IS NULL OR brand_secondary_color ~ '^#[0-9a-f]{6}$');
