/**
 * Script anti-FOUC (Flash of Incorrect Theme) — Story 5.8 AC1.c / AC6.b.
 *
 * String de JavaScript puro (NÃO React) injectada via `dangerouslySetInnerHTML`
 * num `<script>` no `<head>` do RootLayout, ANTES de qualquer folha de estilos.
 * Corre no browser antes da hidratação React — é o único ponto onde garantimos
 * zero flash de tema errado (DP-5.8.A; front-end-spec §11.3).
 *
 * Lê o cookie `expressia-theme` (`light` | `dark` | `system`) e aplica/remove a
 * classe `dark` no `<html>`. Sem cookie → `system` (segue `prefers-color-scheme`).
 *
 * É o único sítio onde JS muta o DOM fora de um `useEffect` — legítimo porque
 * não é React e corre pré-hidratação (a excepção documentada na lição FIX-1 5.7).
 *
 * Mantido conciso e auto-contido (sem dependências). Falha defensivamente
 * dentro de try/catch — qualquer erro não pode partir o render do documento.
 */
export const THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )expressia-theme=([^;]*)/);var t=m?decodeURIComponent(m[1]):'system';var d=t==='dark'||(t!=='light'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;
