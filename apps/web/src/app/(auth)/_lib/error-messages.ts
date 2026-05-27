/**
 * Mapeamento de erros Supabase Auth → mensagens PT-PT acionáveis.
 *
 * Contexto (TASK-1 Dex 2026-05-26):
 *   Anteriormente todas as falhas de signUp eram colapsadas em
 *   "Não foi possível concluir o registo. Tenta novamente." — isto escondeu
 *   durante dias que o root cause era `Confirm email` activo no Dashboard
 *   combinado com SMTP default rate-limited (D8 do runbook tinha sido revertido).
 *
 * Política:
 *   - Mensagens neutras quando o detalhe expõe enumeration (ex: "este email
 *     já existe" → não dizemos).
 *   - Mensagens accionáveis quando o utilizador pode resolver (palavra-passe
 *     fraca, email mal formado, rate limit).
 *   - Mensagens "verifica o teu email" quando confirmation é o bloqueador.
 *
 * Trace: Story 1.5 AC2 (Server Actions errors PT-PT), TASK-1 root cause
 *        (auth-fix local 2026-05-26).
 */

/**
 * Forma mínima do erro devolvido por `@supabase/supabase-js` (AuthError).
 *
 * Em runtime a classe oficial é `AuthError` mas só importar o tipo
 * inflaciona o bundle do Server Action sem necessidade — usamos shape
 * estrutural que é estável desde supabase-js v2.
 */
export interface SupabaseAuthErrorLike {
  readonly code?: string | undefined;
  readonly status?: number | undefined;
  readonly message?: string | undefined;
}

/**
 * Códigos conhecidos do GoTrue (Supabase Auth) que mapeamos explicitamente.
 *
 * Lista de referência:
 * https://github.com/supabase/auth/blob/master/internal/api/errors.go (constants)
 */
const SIGNUP_MESSAGES: Readonly<Record<string, string>> = {
  email_address_invalid:
    'Esse endereço de email não é aceite. Verifica se está bem escrito e usa um domínio real.',
  email_exists: 'Esse email já tem conta. Tenta entrar ou recuperar a palavra-passe.',
  weak_password:
    'A palavra-passe é demasiado fraca. Usa pelo menos 8 caracteres com letras e números.',
  over_email_send_rate_limit:
    'Demasiados pedidos de registo deste endereço nos últimos minutos. Aguarda alguns minutos e tenta de novo.',
  over_request_rate_limit:
    'Demasiados pedidos. Aguarda alguns minutos e tenta de novo.',
  signup_disabled: 'O registo está temporariamente desativado.',
  email_provider_disabled: 'O registo por email está temporariamente desativado.',
  user_banned: 'Esta conta foi suspensa. Contacta suporte@expressia.pt.',
};

const SIGNIN_MESSAGES: Readonly<Record<string, string>> = {
  invalid_credentials: 'Email ou palavra-passe incorrectos.',
  email_not_confirmed:
    'Tens de confirmar o teu email antes de entrar. Verifica a tua caixa de entrada.',
  user_banned: 'Esta conta foi suspensa. Contacta suporte@expressia.pt.',
  over_request_rate_limit:
    'Demasiados pedidos. Aguarda alguns minutos e tenta de novo.',
};

/** Mensagem default quando o `code` não está mapeado. */
const FALLBACK_SIGNUP = 'Não foi possível concluir o registo. Tenta novamente.';
const FALLBACK_SIGNIN = 'Email ou palavra-passe incorrectos.';

/**
 * Mensagem PT-PT para erros de signUp.
 *
 * Aceita `unknown` para evitar leakage do tipo de @supabase/supabase-js em
 * todo o Server Action e para ser robusto a erros não-tipados.
 */
export function mapSignUpError(error: unknown): string {
  const code = extractCode(error);
  if (code && code in SIGNUP_MESSAGES) {
    return SIGNUP_MESSAGES[code]!;
  }
  return FALLBACK_SIGNUP;
}

/**
 * Mensagem PT-PT para erros de signIn.
 *
 * Por defeito devolvemos "Email ou palavra-passe incorrectos" para evitar
 * enumeration. Excepção: `email_not_confirmed` é exposto explicitamente
 * porque desbloqueia o utilizador (sabe que tem de ir verificar o email).
 */
export function mapSignInError(error: unknown): string {
  const code = extractCode(error);
  if (code && code in SIGNIN_MESSAGES) {
    return SIGNIN_MESSAGES[code]!;
  }
  return FALLBACK_SIGNIN;
}

function extractCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const e = error as SupabaseAuthErrorLike;
  return typeof e.code === 'string' ? e.code : undefined;
}
