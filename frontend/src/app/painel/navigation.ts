import {
  BarChart3,
  CalendarDays,
  Coins,
  Home,
  Percent,
  Receipt,
  Scissors,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Basta uma (mesma semântica do @RequirePermissions da API). Vazio = todos. */
  permissions: string[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/painel', label: 'Início', icon: Home, permissions: [] },
  {
    href: '/painel/agenda',
    label: 'Agenda',
    icon: CalendarDays,
    permissions: ['appointments:read:any', 'appointments:read:own'],
  },
  { href: '/painel/comandas', label: 'Comandas', icon: Receipt, permissions: ['orders:read:any'] },
  { href: '/painel/caixa', label: 'Caixa', icon: Coins, permissions: ['cash:read'] },
  { href: '/painel/clientes', label: 'Clientes', icon: UserRound, permissions: ['clients:read'] },
  { href: '/painel/equipe', label: 'Equipe', icon: Users, permissions: ['staff:read'] },
  { href: '/painel/servicos', label: 'Serviços', icon: Scissors, permissions: ['services:read'] },
  {
    href: '/painel/comissoes',
    label: 'Comissões',
    icon: Percent,
    permissions: ['commissions:read:any', 'commissions:read:own'],
  },
  { href: '/painel/relatorios', label: 'Relatórios', icon: BarChart3, permissions: ['reports:read'] },
  {
    href: '/painel/configuracoes',
    label: 'Configurações',
    icon: Settings,
    permissions: ['barbershop:manage'],
  },
];
