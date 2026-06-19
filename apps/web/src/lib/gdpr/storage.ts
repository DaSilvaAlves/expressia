/**
 * Cliente Supabase Storage com service-role para o export GDPR (Story 6.8 AC5).
 *
 * ⚠️ GUARD DE SEGURANÇA (espírito SEC-10): este cliente usa o
 * `SUPABASE_SERVICE_ROLE_KEY` e tem acesso de ADMIN ao Storage. O bucket
 * `exports` é PRIVADO — apenas a Admin API pode escrever lá e gerar signed URLs.
 * Usar EXCLUSIVAMENTE em código de servidor controlado (este endpoint de export),
 * NUNCA expor a chave ao cliente. A verificação de pertença ao household é feita
 * app-level ANTES do upload (defesa em profundidade — precedente D-12C).
 *
 * Construção NOVA nesta story (zero referências a `.storage`/`createSignedUrl`
 * no codebase anterior).
 *
 * BLOQUEADOR EXTERNO: o bucket `exports` (privado, eu-central-1) tem de existir
 * no Supabase Storage. Acção [EURICO] — ver topo da story 6.8. Sem o bucket o
 * upload falha em runtime.
 *
 * Trace: Story 6.8 AC5/AC8 [DEV-DECISION D-6.8.2]; NFR11 (data residency UE);
 * CLAUDE.md §Multi-tenancy (getServiceDb guard).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Nome do bucket privado de exports (criado pelo Eurico — bloqueador externo). */
export const EXPORTS_BUCKET = 'exports';

/** Validade do signed URL — 24 horas (AC5). */
export const SIGNED_URL_TTL_SECONDS = 86_400;

let _storageClient: SupabaseClient | null = null;

/**
 * Cliente Supabase service-role (singleton). Lê `NEXT_PUBLIC_SUPABASE_URL` +
 * `SUPABASE_SERVICE_ROLE_KEY`. Sem persistência de sessão (uso server-only).
 *
 * @throws se as env vars não estiverem definidas.
 */
function getStorageClient(): SupabaseClient {
  if (_storageClient) return _storageClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      '[gdpr/storage] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos.',
    );
  }

  _storageClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _storageClient;
}

/**
 * Path do ZIP no bucket: `exports/{household_id}/{job_id}.zip`.
 *
 * Nota: o nome do bucket NÃO é prefixado ao path passado à Admin API (o método
 * `.from(EXPORTS_BUCKET)` já o define). O path é relativo ao bucket.
 */
export function buildStoragePath(householdId: string, jobId: string): string {
  return `${householdId}/${jobId}.zip`;
}

/**
 * Faz upload do ZIP para o bucket privado `exports` (service-role) e gera um
 * signed URL de 24h.
 *
 * @param householdId - household do job (já validado app-level pelo chamador).
 * @param jobId - id do job de export.
 * @param zip - conteúdo do ZIP em memória.
 * @returns `{ storagePath, signedUrl, expiresAt }`.
 * @throws se o upload ou a geração do signed URL falharem (ex.: bucket inexistente).
 */
export async function uploadExportZip(
  householdId: string,
  jobId: string,
  zip: Buffer,
): Promise<{ storagePath: string; signedUrl: string; expiresAt: Date }> {
  const client = getStorageClient();
  const storagePath = buildStoragePath(householdId, jobId);

  const { error: uploadError } = await client.storage
    .from(EXPORTS_BUCKET)
    .upload(storagePath, zip, {
      contentType: 'application/zip',
      upsert: true,
    });
  if (uploadError) {
    throw new Error(`[gdpr/storage] upload falhou: ${uploadError.message}`);
  }

  const { data, error: signError } = await client.storage
    .from(EXPORTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (signError || !data?.signedUrl) {
    throw new Error(
      `[gdpr/storage] createSignedUrl falhou: ${signError?.message ?? 'sem URL'}`,
    );
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000);
  return { storagePath, signedUrl: data.signedUrl, expiresAt };
}
