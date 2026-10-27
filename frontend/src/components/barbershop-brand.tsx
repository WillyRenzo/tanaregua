import Image from 'next/image';
import { brandCss, logoUrl, type BrandColors } from '@/lib/brand';
import { cn } from '@/lib/utils';

/**
 * Aplica as cores da barbearia sobrescrevendo os tokens no `:root`, para valer também em
 * diálogos e menus renderizados em portal. O CSS só contém tokens e hex validados.
 */
export function BrandStyle({ brand }: { brand: BrandColors }) {
  const css = brandCss(brand);
  return css ? <style data-brand>{css}</style> : null;
}

/** Logo enviado pela barbearia (WebP reprocessado pela API, até 512 px). */
export function BarbershopLogo({
  slug,
  name,
  logoVersion,
  className,
}: {
  slug: string;
  name: string;
  logoVersion: string;
  className?: string;
}) {
  return (
    <Image
      src={logoUrl(slug, logoVersion)}
      alt={`Logo da ${name}`}
      width={512}
      height={512}
      // A API já entrega a imagem otimizada; o otimizador do Next só buscaria de novo.
      unoptimized
      className={cn('h-14 w-auto max-w-40 object-contain', className)}
    />
  );
}
