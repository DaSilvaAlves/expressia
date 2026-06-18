'use client';

/**
 * `<Sidebar>` — navegação principal da Expressia (Story 5.3 AC2).
 *
 * Estrutura visual top-to-bottom:
 *   1. Logo Expressia → `/visao`
 *   2. Visão, Chat, Tarefas (expansível), Finanças (expansível)
 *   3. Divider
 *   4. Conta
 *   5. Spacer flex-1
 *   6. Avatar + email truncado (footer)
 *
 * Responsive — 4 breakpoints (front-end-spec §10.2/§10.3):
 *   - Wide/Desktop (≥1024px): fixa 240px (`lg:w-60`)
 *   - Tablet (640-1023px): icon-only collapsible 64px ↔ 240px (drawer overlay
 *     quando expandido)
 *   - Mobile (<640px): renderiza apenas a versão "drawer" — mostrada/escondida
 *     via prop `mobileOpen` controlada pelo `TopBar` (hamburger)
 *
 * State:
 *   - Sidebar collapsed/expanded (tablet): `useShellStore` (persist)
 *   - Grupos Tarefas / Finanças expansíveis: `useState` local (não persistido —
 *     reset por render é OK; o utilizador re-expande quando precisa)
 *
 * **D-5.3.1 (ícones):** emojis pictográficos PT-PT-safe. KISS — nenhuma
 * dependência de icon library nesta story (`lucide-react` etc fica para
 * Story 5.10 se for decidido).
 *
 * **D-5.3.4 / DP-5.3.D:** rota `/jarvis` mantida (DP8 Epic 5 ratificado pelo
 * Eurico em 2026-05-23) mas o label do nav diz "Chat" (`front-end-spec §5.4`
 * wireframe linha 500). Divergência consciente label↔URL — documentada aqui.
 *
 * Trace: Epic 5 §3 IN bullet 1 + §8 DP1/DP8; `architecture.md §8.2 linhas
 * 699-702` (Client por `usePathname()` + state); `front-end-spec §5.4`.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { User } from '@supabase/supabase-js';

import {
  useMobileDrawerOpen,
  useShellActions,
  useShellHydrated,
  useSidebarCollapsed,
} from '@/lib/stores/shellStore';

// ───────────────────────────────────────────────────────────────────────────
// Estrutura de navegação — fonte única para render + cross-referência testes
// ───────────────────────────────────────────────────────────────────────────

interface NavLeafItem {
  kind: 'leaf';
  label: string;
  href: string;
  icon: string;
}

interface NavGroupItem {
  kind: 'group';
  label: string;
  icon: string;
  /** Prefixo activo para destaque do grupo (ex: `/tarefas`). */
  prefix: string;
  children: NavLeafItem[];
}

type NavItem = NavLeafItem | NavGroupItem;

/**
 * Nav items principais. **NÃO** inclui "Conta" — esse fica num bloco separado
 * abaixo do divider (per `front-end-spec §5.4`).
 */
const NAV_ITEMS: readonly NavItem[] = [
  {
    kind: 'leaf',
    label: 'Visão',
    href: '/visao',
    icon: '🏠',
  },
  {
    kind: 'leaf',
    // DP-5.3.D: label "Chat" mas URL `/jarvis` (DP8 Epic 5 validated).
    label: 'Chat',
    href: '/jarvis',
    icon: '💬',
  },
  {
    kind: 'group',
    label: 'Tarefas',
    icon: '✅',
    prefix: '/tarefas',
    children: [
      { kind: 'leaf', label: 'Lista', href: '/tarefas', icon: '·' },
      { kind: 'leaf', label: 'Kanban', href: '/tarefas/kanban', icon: '·' },
      { kind: 'leaf', label: 'Calendário', href: '/tarefas/calendario', icon: '·' },
    ],
  },
  {
    kind: 'group',
    label: 'Finanças',
    icon: '💰',
    prefix: '/financas',
    children: [
      { kind: 'leaf', label: 'Este mês', href: '/financas/este-mes', icon: '·' },
      { kind: 'leaf', label: 'Variáveis', href: '/financas/variaveis', icon: '·' },
      { kind: 'leaf', label: 'Recorrentes', href: '/financas/recorrentes', icon: '·' },
      { kind: 'leaf', label: 'Cartões', href: '/financas/cartoes', icon: '·' },
      { kind: 'leaf', label: 'Património', href: '/financas/patrimonio', icon: '·' },
    ],
  },
] as const;

/**
 * Bloco "Conta" — único item abaixo do divider. Futuras sub-rotas (`/conta/perfil`,
 * `/conta/plano`, `/conta/household`, `/conta/exportar`) listadas em
 * `architecture.md §8.1 linhas 676-680` adicionar-se-ão quando Epic 6 chegar.
 */
const CONTA_ITEMS: readonly NavLeafItem[] = [
  { kind: 'leaf', label: 'Conta', href: '/conta/preferencias', icon: '⚙' },
  { kind: 'leaf', label: 'Família', href: '/conta/household', icon: '⌂' },
  { kind: 'leaf', label: 'Os meus dados', href: '/conta/dados', icon: '⤓' },
];

// ───────────────────────────────────────────────────────────────────────────
// Helpers de estado activo
// ───────────────────────────────────────────────────────────────────────────

/**
 * `/visao` exige match exacto para não conflituar com sub-rotas que possam
 * vir a existir. Restantes leaves usam `startsWith` para que sub-rotas
 * (ex: `/tarefas/kanban`) destaquem o grupo-pai correctamente — mas para
 * leaves directos, exact match é o esperado (evita falso-positivo em
 * `/conta` para `/conta/preferencias` etc).
 */
function isLeafActive(pathname: string, href: string): boolean {
  if (href === '/visao') return pathname === '/visao';
  // Para leaves de sub-rotas (ex: `/tarefas`, `/financas/este-mes`) match exacto.
  return pathname === href;
}

/**
 * Grupo está activo se o pathname começa pelo prefixo. Cobre `/tarefas`,
 * `/tarefas/kanban`, `/tarefas/calendario`.
 */
function isGroupActive(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

// ───────────────────────────────────────────────────────────────────────────
// Sub-componentes
// ───────────────────────────────────────────────────────────────────────────

interface SidebarProps {
  user: User | null;
}

/**
 * Componente principal `<Sidebar>`.
 *
 * Consome o `shellStore` para colapso (tablet/desktop) + drawer mobile.
 * Ambos os estados — `sidebarCollapsed` (persisted) e `mobileDrawerOpen`
 * (ephemeral) — vivem no store partilhado para que `HamburgerButton` no
 * `TopBar` possa controlar sem prop drilling.
 */
export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const collapsed = useSidebarCollapsed();
  const mobileOpen = useMobileDrawerOpen();
  const hydrated = useShellHydrated();
  const { toggleSidebar, closeMobileDrawer } = useShellActions();
  const onMobileClose = closeMobileDrawer;

  // Antes da hidratação, usa o default (não colapsada) para evitar mismatch.
  const effectiveCollapsed = hydrated ? collapsed : false;

  // Versão mobile (drawer): renderiza apenas quando `mobileOpen` é true.
  // Quando fechado em mobile, retorna `null` para não ocupar espaço.
  // Em desktop/tablet a sidebar é sempre visível — `mobileOpen` ignorado.
  return (
    <>
      {/* Drawer mobile — backdrop + sidebar 280px slide-from-left. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={[
          // Mobile: drawer fixed à esquerda; oculto quando !mobileOpen.
          'fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-black/10 bg-white transition-transform dark:border-white/10 dark:bg-neutral-900',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop ≥1024px: static, largura conforme `collapsed`.
          // Tablet/desktop em geral aplica `md:` para tomar o lugar normal no flow.
          'md:static md:z-auto md:translate-x-0',
          effectiveCollapsed ? 'md:w-16' : 'md:w-60',
        ].join(' ')}
        aria-label="Navegação principal"
        data-collapsed={effectiveCollapsed ? 'true' : 'false'}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-4">
          <Link
            href="/visao"
            className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
            onClick={onMobileClose}
          >
            {effectiveCollapsed ? 'E' : 'Expressia'}
          </Link>
          {/* Toggle collapse — visível só em tablet/desktop (md:flex), oculto em mobile (que usa hamburger no TopBar). */}
          <button
            type="button"
            onClick={toggleSidebar}
            className="hidden h-7 w-7 items-center justify-center rounded text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 md:flex dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            aria-label={effectiveCollapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
            aria-expanded={!effectiveCollapsed}
          >
            {effectiveCollapsed ? '›' : '‹'}
          </button>
        </div>

        {/* Nav principal */}
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.kind === 'leaf' ? item.href : item.prefix}>
                {item.kind === 'leaf' ? (
                  <NavLinkLeaf
                    item={item}
                    active={isLeafActive(pathname ?? '', item.href)}
                    collapsed={effectiveCollapsed}
                    onClick={onMobileClose}
                  />
                ) : (
                  <NavGroup
                    item={item}
                    pathname={pathname ?? ''}
                    collapsed={effectiveCollapsed}
                    onLeafClick={onMobileClose}
                  />
                )}
              </li>
            ))}
          </ul>

          {/* Divider */}
          <div className="my-3 border-t border-black/10 dark:border-white/10" aria-hidden="true" />

          {/* Conta */}
          <ul className="space-y-1">
            {CONTA_ITEMS.map((item) => (
              <li key={item.href}>
                <NavLinkLeaf
                  item={item}
                  active={isLeafActive(pathname ?? '', item.href)}
                  collapsed={effectiveCollapsed}
                  onClick={onMobileClose}
                />
              </li>
            ))}
          </ul>
        </nav>

        {/* Footer — avatar + email */}
        <div className="border-t border-black/10 px-3 py-3 dark:border-white/10">
          {user ? (
            <div className="flex items-center gap-2 text-sm">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
                aria-hidden="true"
              >
                {initialsFromEmail(user.email ?? '?')}
              </span>
              {!effectiveCollapsed && (
                <span
                  className="truncate text-neutral-700 dark:text-neutral-300"
                  title={user.email ?? ''}
                >
                  {truncateEmail(user.email ?? '')}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-neutral-500">Sem sessão</span>
          )}
        </div>
      </aside>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Sub-componentes internos
// ───────────────────────────────────────────────────────────────────────────

interface NavLinkLeafProps {
  item: NavLeafItem;
  active: boolean;
  collapsed: boolean;
  onClick?: () => void;
}

function NavLinkLeaf({ item, active, collapsed, onClick }: NavLinkLeafProps) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={[
        'flex items-center gap-2 rounded-md px-2 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F4F6A]',
        active
          ? 'bg-[#E6EEF3] text-[#1F4F6A] dark:bg-[#1E3343] dark:text-[#5C9BBE]'
          : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
      ].join(' ')}
      title={collapsed ? item.label : undefined}
    >
      <span className="w-5 shrink-0 text-center text-base" aria-hidden="true">
        {item.icon}
      </span>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

interface NavGroupProps {
  item: NavGroupItem;
  pathname: string;
  collapsed: boolean;
  onLeafClick?: () => void;
}

function NavGroup({ item, pathname, collapsed, onLeafClick }: NavGroupProps) {
  const groupActive = isGroupActive(pathname, item.prefix);
  // Expande por defeito quando o grupo está activo (UX: vê-se logo a sub-rota
  // actual destacada). Caso contrário, comprimido.
  const [expanded, setExpanded] = useState<boolean>(groupActive);

  // Em collapsed (tablet icon-only) o grupo torna-se simplesmente um botão
  // que navega para o primeiro filho — KISS sem flyout nesta story.
  if (collapsed) {
    const firstChild = item.children[0];
    if (!firstChild) return null;
    return (
      <Link
        href={firstChild.href}
        onClick={onLeafClick}
        title={item.label}
        aria-current={groupActive ? 'page' : undefined}
        className={[
          'flex items-center justify-center rounded-md px-2 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F4F6A]',
          groupActive
            ? 'bg-[#E6EEF3] text-[#1F4F6A] dark:bg-[#1E3343] dark:text-[#5C9BBE]'
            : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
        ].join(' ')}
      >
        <span aria-hidden="true">{item.icon}</span>
        <span className="sr-only">{item.label}</span>
      </Link>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={[
          'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F4F6A]',
          groupActive
            ? 'bg-[#E6EEF3] text-[#1F4F6A] dark:bg-[#1E3343] dark:text-[#5C9BBE]'
            : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
        ].join(' ')}
      >
        <span className="w-5 shrink-0 text-center text-base" aria-hidden="true">
          {item.icon}
        </span>
        <span className="flex-1 truncate">{item.label}</span>
        <span aria-hidden="true" className="text-xs text-neutral-500">
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded && (
        <ul className="ml-7 mt-1 space-y-0.5">
          {item.children.map((child) => {
            const childActive = pathname === child.href;
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  onClick={onLeafClick}
                  aria-current={childActive ? 'page' : undefined}
                  className={[
                    'block rounded px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F4F6A]',
                    childActive
                      ? 'bg-[#E6EEF3] font-medium text-[#1F4F6A] dark:bg-[#1E3343] dark:text-[#5C9BBE]'
                      : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800',
                  ].join(' ')}
                >
                  {child.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers puros (testáveis)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Iniciais a partir de email (até 2 letras). `joao.silva@expressia.pt` → "JS".
 * Email com uma única secção antes do `@` → primeira letra.
 */
function initialsFromEmail(email: string): string {
  if (!email) return '?';
  const local = email.split('@')[0] ?? email;
  const parts = local.split(/[.\-_+]/).filter(Boolean);
  if (parts.length === 0) return email.slice(0, 1).toUpperCase();
  if (parts.length === 1) {
    const single = parts[0] ?? '';
    return single.slice(0, 1).toUpperCase();
  }
  const first = parts[0] ?? '';
  const second = parts[1] ?? '';
  return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase();
}

/**
 * Trunca email para no máximo 24 caracteres no sidebar footer (AC2.a).
 */
function truncateEmail(email: string): string {
  if (email.length <= 24) return email;
  return `${email.slice(0, 22)}…`;
}
