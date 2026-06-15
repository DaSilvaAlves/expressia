/**
 * Validação pura (sem efeitos) do formulário de definição de nova palavra-passe
 * (Soft-launch A2). Extraída para função testável — espelha as mesmas regras do
 * registo (`signUpAction`): mínimo 8 caracteres + confirmação coincidente.
 *
 * Devolve a primeira mensagem de erro PT-PT, ou `null` se válido. Não lança.
 */

/** Mínimo de caracteres da palavra-passe — coerente com o registo (8). */
export const MIN_PASSWORD_LENGTH = 8;

export function validateNewPassword(password: string, passwordConfirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A palavra-passe tem de ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (password !== passwordConfirm) {
    return 'As palavras-passe não coincidem.';
  }
  return null;
}
