/**
 * Catálogo único de recursos vendáveis (business-rules §12). Como as permissões, o código
 * checa recursos, nunca o nome do plano. O núcleo das fases 1 e 2 vale em todo plano e não
 * tem chave. Cada chave passa a ser exigida (`@RequiresFeature`) quando o módulo dela entra.
 */
export const FEATURES = ['online-payment', 'payroll', 'advanced-reports', 'assistant'] as const;

export type Feature = (typeof FEATURES)[number];

export function isFeature(value: string): value is Feature {
  return (FEATURES as readonly string[]).includes(value);
}

/**
 * Recursos do plano da assinatura. Valem em qualquer situação: no modo só leitura (teste
 * vencido, carência esgotada, cancelada) a barbearia ainda consulta tudo o que o plano tem, e
 * quem barra as escritas é o `ReadOnlyGuard` (§12: trocar de plano ou parar de pagar nunca
 * apaga nem esconde dados).
 */
export function grantedFeatures(planFeatures: readonly string[]): Feature[] {
  return planFeatures.filter(isFeature);
}
