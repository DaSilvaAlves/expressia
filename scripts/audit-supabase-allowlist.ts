#!/usr/bin/env tsx
/**
 * SEC-11 — Auditoria operacional da allowlist de Redirect URLs do Supabase.
 *
 * Consulta a Supabase **Management API** para ler o estado REAL da configuração
 * de autenticação do projecto e verifica se a allowlist de Redirect URLs contém
 * wildcards de risco (`*.vercel.app`, `**` total). Análogo ao `check:rls`:
 *   - exit 0 = configuração segura (ou modo gracioso sem credencial).
 *   - exit 1 = configuração de risco OU erro de diagnóstico (token inválido, etc).
 *
 * Endpoint (fonte correcta — `/auth/v1/settings` NÃO expõe a allowlist):
 *   GET https://api.supabase.com/v1/projects/{ref}/config/auth
 *   Authorization: Bearer {SUPABASE_ACCESS_TOKEN}
 * Campo relevante: `uri_allow_list` (string CSV — parsear com `.split(',')`).
 *
 * Uso:
 *   pnpm check:allowlist
 *   tsx scripts/audit-supabase-allowlist.ts
 *
 * Variáveis de ambiente (operacionais — NÃO são runtime Vercel):
 *   SUPABASE_ACCESS_TOKEN  Personal Access Token Supabase (obrigatória).
 *   SUPABASE_PROJECT_REF   Ref do projecto Supabase (obrigatória).
 *   PRODUCTION_DOMAIN      (opcional) padrão de produção a procurar; default
 *                          `https://expressia.pt/**`.
 *
 * Modo gracioso: se `SUPABASE_ACCESS_TOKEN` estiver ausente, imprime aviso e
 * termina com exit 0 — para que ambientes sem credencial (CI) não falhem.
 *
 * NOTA: a lógica pura de detecção vive em
 * `apps/web/src/lib/security/audit-allowlist.ts` (testada por Vitest). Este
 * ficheiro só faz I/O (env, fetch, process.exit) e delega a detecção.
 */
import {
  auditAllowlist,
  parseAllowlistCsv,
  type AuditResult,
  type AuthConfigResponse,
} from '../apps/web/src/lib/security/audit-allowlist';

const MANAGEMENT_API_BASE = 'https://api.supabase.com/v1/projects';

/** Imprime o resultado da auditoria de forma legível em PT-PT. */
function printResult(result: AuditResult, urls: string[]): void {
  console.log(`\nURLs na allowlist (${urls.length}):`);
  if (urls.length === 0) {
    console.log('  (allowlist vazia)');
  } else {
    for (const url of urls) {
      console.log(`  • ${url}`);
    }
  }

  console.log('\nAchados:');
  if (result.findings.length === 0) {
    console.log('  (nenhum)');
  } else {
    for (const finding of result.findings) {
      const prefix = finding.level === 'risk' ? '  ✗' : '  ℹ';
      console.log(`${prefix} ${finding.message}`);
    }
  }
}

async function main(): Promise<number> {
  console.log('🔐 SEC-11 — Auditoria da allowlist de Redirect URLs (Supabase Management API)\n');

  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const productionDomain = process.env.PRODUCTION_DOMAIN ?? 'https://expressia.pt/**';

  // Modo gracioso: sem token, não bloqueia (CI / ambientes sem credencial).
  if (!accessToken) {
    console.warn('AVISO: SUPABASE_ACCESS_TOKEN não definida — auditoria ignorada.');
    console.warn(
      '       Define SUPABASE_ACCESS_TOKEN (Personal Access Token Supabase) e SUPABASE_PROJECT_REF',
    );
    console.warn('       no teu .env.local para correr a auditoria. A terminar com exit 0.');
    return 0;
  }

  // Token presente mas ref em falta → erro de configuração (bloqueia).
  if (!projectRef) {
    console.error('ERRO: SUPABASE_PROJECT_REF não definida (mas SUPABASE_ACCESS_TOKEN está).');
    console.error('Causa: a ref do projecto Supabase é obrigatória para construir o endpoint.');
    console.error('Solução: define SUPABASE_PROJECT_REF no teu .env.local.');
    return 1;
  }

  const url = `${MANAGEMENT_API_BASE}/${projectRef}/config/auth`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
  } catch (error) {
    console.error('ERRO: falha de rede ao contactar a Supabase Management API.');
    console.error(`Causa: ${error instanceof Error ? error.message : String(error)}`);
    console.error('Solução: verifica a tua ligação e se api.supabase.com está acessível.');
    return 1;
  }

  if (response.status === 401) {
    console.error('ERRO: token inválido ou expirado (HTTP 401 da Management API).');
    console.error('Causa: o SUPABASE_ACCESS_TOKEN não é aceite pela Management API.');
    console.error(
      'Solução: gera um novo Personal Access Token em https://supabase.com/dashboard/account/tokens.',
    );
    return 1;
  }

  if (!response.ok) {
    console.error(`ERRO: resposta inesperada da Management API (HTTP ${response.status}).`);
    console.error(`Causa: o endpoint ${url} devolveu um estado de erro.`);
    console.error('Solução: confirma que SUPABASE_PROJECT_REF está correcta e que o token tem permissões.');
    return 1;
  }

  let config: AuthConfigResponse;
  try {
    config = (await response.json()) as AuthConfigResponse;
  } catch (error) {
    console.error('ERRO: resposta da Management API não é JSON válido.');
    console.error(`Causa: ${error instanceof Error ? error.message : String(error)}`);
    console.error('Solução: tenta novamente; se persistir, verifica o estado da Supabase Management API.');
    return 1;
  }

  if (config.site_url) {
    console.log(`Site URL configurado: ${config.site_url}`);
  }

  const urls = parseAllowlistCsv(config.uri_allow_list);
  const result = auditAllowlist(urls, productionDomain);

  printResult(result, urls);

  if (result.safe) {
    console.log('\n✅ Allowlist segura.');
    return 0;
  }

  console.error('\n❌ Allowlist de risco — ver achados acima.');
  console.error('Trace: SEC-11 (remover wildcard *.vercel.app após DNS estável — ver runbook §5).');
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('ERRO inesperado na auditoria da allowlist:');
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
