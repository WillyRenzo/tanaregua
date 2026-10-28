import type { INestApplicationContext } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { createPlatformAdmin } from '../modules/platform/platform-admins.js';
import { SubscriptionsService } from '../modules/subscriptions/subscriptions.service.js';
import { DEMO_PASSWORD } from './demo-seed.js';

export const PLATFORM_ADMIN_EMAIL = 'plataforma@tanaregua.dev';

/**
 * Preços FICTÍCIOS, só para ver a tela de planos no desenvolvimento. Os reais são definidos
 * na administração da plataforma (business-rules §12, ainda [PENDENTE]).
 */
const DEMO_PRICES: Record<string, { monthlyCents: number; yearlyCents: number }> = {
  essential: { monthlyCents: 7990, yearlyCents: 79900 },
  professional: { monthlyCents: 12990, yearlyCents: 129900 },
  premium: { monthlyCents: 19990, yearlyCents: 199900 },
};

export interface PlatformSeedResult {
  /** `false` sem DATABASE_MIGRATION_URL: só o dono das tabelas cria administrador. */
  available: boolean;
  added: string[];
}

/**
 * Administração da plataforma no desenvolvimento: uma conta (mesma senha das contas da demo)
 * e preços fictícios nos planos que ainda não têm nenhum. Global, não pertence à demo; nunca
 * sobrescreve um preço já definido.
 */
export async function seedPlatform(app: INestApplicationContext): Promise<PlatformSeedResult> {
  const url = process.env['DATABASE_MIGRATION_URL'];
  if (!url) return { available: false, added: [] };

  const added: string[] = [];
  const owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    let admin = await owner.platformAdmin.findUnique({
      where: { email: PLATFORM_ADMIN_EMAIL },
      select: { id: true },
    });
    if (!admin) {
      admin = await createPlatformAdmin(owner, {
        email: PLATFORM_ADMIN_EMAIL,
        name: 'Administração TaNaRegua',
        password: DEMO_PASSWORD,
      });
      added.push('conta da administração da plataforma');
    }

    const subscriptions = app.get(SubscriptionsService);
    let priced = false;
    for (const plan of await subscriptions.listPlansAsPlatform(admin.id)) {
      const prices = DEMO_PRICES[plan.key];
      if (!prices || plan.prices.monthlyCents !== null || plan.prices.yearlyCents !== null) continue;
      await subscriptions.setPlanPrices(admin.id, plan.key, prices);
      priced = true;
    }
    if (priced) added.push('preços fictícios dos planos');
  } finally {
    await owner.$disconnect();
  }
  return { available: true, added };
}
