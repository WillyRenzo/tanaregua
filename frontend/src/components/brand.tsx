import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Logotipo tipográfico: a "régua" é o traço cobre sob o nome. Sobre fundo escuro
 * (barra lateral) o cobre precisa ser o tom claro, senão o contraste cai abaixo do AA.
 */
export function Brand({
  className,
  href = '/',
  onDark = false,
}: {
  className?: string;
  href?: string;
  onDark?: boolean;
}) {
  const accent = onDark ? 'text-sidebar-primary' : 'text-primary';
  return (
    <Link
      href={href}
      className={cn(
        'group inline-flex flex-col leading-none',
        onDark && 'text-sidebar-foreground',
        className,
      )}
    >
      <span className="font-heading text-2xl font-bold tracking-wider uppercase">
        Ta<span className={accent}>Na</span>Regua
      </span>
      <span
        aria-hidden
        className={cn(
          'mt-1 h-0.5 w-full origin-left transition-transform group-hover:scale-x-110',
          onDark ? 'bg-sidebar-primary' : 'bg-primary',
        )}
      />
    </Link>
  );
}
