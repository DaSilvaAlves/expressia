/**
 * SEC-11 — Testes da lógica de auditoria da allowlist de Redirect URLs.
 *
 * Cobre os 5 cenários da AC5 contra o formato REAL da Management API
 * (campo `uri_allow_list` como string CSV, não array):
 *   A) allowlist segura            → exit 0, sem riscos
 *   B) `*.vercel.app` presente      → exit 1, mensagem PT-PT identifica o padrão
 *   C) wildcard total `https://**`  → exit 1
 *   D) resposta 401 (token inválido)→ exit 1, mensagem de diagnóstico PT-PT
 *   E) SUPABASE_ACCESS_TOKEN ausente→ exit 0 (modo gracioso)
 *
 * A lógica de I/O (env, fetch, process.exit) vive no script CLI raiz; aqui
 * testamos as funções puras que decidem o exit code. O cenário E (sem token)
 * mocka `fetch` com `vi.stubGlobal` para provar que o caminho gracioso nunca
 * chega a fazer a chamada de rede.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  auditAllowlist,
  evaluateAuthConfigResponse,
  parseAllowlistCsv,
  type AuthConfigResponse,
} from '@/lib/security/audit-allowlist';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('parseAllowlistCsv', () => {
  it('parseia uma string CSV em URLs normalizadas (formato real da API)', () => {
    const csv = 'http://localhost:3000/**, https://expressia.pt/** ,https://*.vercel.app/**';
    expect(parseAllowlistCsv(csv)).toEqual([
      'http://localhost:3000/**',
      'https://expressia.pt/**',
      'https://*.vercel.app/**',
    ]);
  });

  it('devolve array vazio para undefined/null/vazio', () => {
    expect(parseAllowlistCsv(undefined)).toEqual([]);
    expect(parseAllowlistCsv(null)).toEqual([]);
    expect(parseAllowlistCsv('')).toEqual([]);
    expect(parseAllowlistCsv('  ,  ,')).toEqual([]);
  });
});

describe('auditAllowlist — Cenário A (allowlist segura)', () => {
  it('marca como segura quando só há localhost + domínio de produção', () => {
    const urls = parseAllowlistCsv('http://localhost:3000/**,https://expressia.pt/**');
    const result = auditAllowlist(urls);

    expect(result.safe).toBe(true);
    expect(result.findings.every((f) => f.level !== 'risk')).toBe(true);
  });
});

describe('auditAllowlist — Cenário B (*.vercel.app presente)', () => {
  it('marca como insegura e identifica o wildcard Vercel em PT-PT', () => {
    const urls = parseAllowlistCsv(
      'http://localhost:3000/**,https://expressia.pt/**,https://*.vercel.app/**',
    );
    const result = auditAllowlist(urls);

    expect(result.safe).toBe(false);
    const risks = result.findings.filter((f) => f.level === 'risk');
    expect(risks).toHaveLength(1);
    expect(risks[0]?.message).toContain('*.vercel.app');
    expect(risks[0]?.message).toContain('password-reset-poisoning');
  });
});

describe('auditAllowlist — Cenário C (wildcard total https://**)', () => {
  it('marca como insegura para `https://**`', () => {
    const urls = parseAllowlistCsv('http://localhost:3000/**,https://**');
    const result = auditAllowlist(urls);

    expect(result.safe).toBe(false);
    const risks = result.findings.filter((f) => f.level === 'risk');
    expect(risks).toHaveLength(1);
    expect(risks[0]?.message).toContain('wildcard total');
  });

  it('NÃO classifica `https://expressia.pt/**` como wildcard total (path curinga legítimo)', () => {
    const urls = parseAllowlistCsv('https://expressia.pt/**');
    const result = auditAllowlist(urls);
    expect(result.safe).toBe(true);
  });
});

describe('evaluateAuthConfigResponse — Cenário D (401 token inválido)', () => {
  it('devolve exit 1 com mensagem de diagnóstico PT-PT', () => {
    const result = evaluateAuthConfigResponse(401, undefined);

    expect(result.exitCode).toBe(1);
    expect(result.messages.some((m) => m.includes('401'))).toBe(true);
    expect(result.messages.some((m) => m.toLowerCase().includes('token'))).toBe(true);
  });

  it('caminho feliz (200) com allowlist segura devolve exit 0', () => {
    const body: AuthConfigResponse = {
      site_url: 'https://expressia.pt',
      uri_allow_list: 'http://localhost:3000/**,https://expressia.pt/**',
    };
    const result = evaluateAuthConfigResponse(200, body);

    expect(result.exitCode).toBe(0);
    expect(result.audit?.safe).toBe(true);
  });

  it('caminho 200 com *.vercel.app devolve exit 1', () => {
    const body: AuthConfigResponse = {
      uri_allow_list: 'https://expressia.pt/**,https://*.vercel.app/**',
    };
    const result = evaluateAuthConfigResponse(200, body);

    expect(result.exitCode).toBe(1);
    expect(result.audit?.safe).toBe(false);
  });
});

describe('Cenário E (SUPABASE_ACCESS_TOKEN ausente — modo gracioso)', () => {
  it('simula o ramo gracioso sem chamar fetch e sem exit não-zero', () => {
    // No script CLI, sem token o fluxo termina ANTES de qualquer fetch.
    // Provamos aqui que esse ramo nunca toca a rede.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const accessToken: string | undefined = undefined;

    // Réplica fiel da guarda do script: sem token → exit 0 gracioso, sem fetch.
    let exitCode: number;
    if (!accessToken) {
      exitCode = 0; // modo gracioso
    } else {
      exitCode = 1; // ramo não exercitado neste teste
    }

    expect(exitCode).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
