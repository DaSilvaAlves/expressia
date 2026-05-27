import { describe, expect, it } from 'vitest';

import { mapSignInError, mapSignUpError } from '@/app/(auth)/_lib/error-messages';

describe('mapSignUpError', () => {
  it('mapeia email_address_invalid para mensagem accionável PT-PT', () => {
    const msg = mapSignUpError({ code: 'email_address_invalid', status: 400 });
    expect(msg).toMatch(/email não é aceite/);
    expect(msg).toMatch(/domínio real/);
  });

  it('mapeia weak_password com instrução clara', () => {
    expect(mapSignUpError({ code: 'weak_password' })).toMatch(/palavra-passe é demasiado fraca/);
    expect(mapSignUpError({ code: 'weak_password' })).toMatch(/8 caracteres/);
  });

  it('mapeia over_email_send_rate_limit', () => {
    expect(mapSignUpError({ code: 'over_email_send_rate_limit' })).toMatch(/Aguarda alguns minutos/);
  });

  it('mapeia email_exists sem enumeration de palavra-passe', () => {
    const msg = mapSignUpError({ code: 'email_exists' });
    expect(msg).toMatch(/já tem conta/);
    expect(msg).toMatch(/recuperar a palavra-passe/);
  });

  it('devolve fallback PT-PT para códigos desconhecidos', () => {
    expect(mapSignUpError({ code: 'completamente_inventado' })).toBe(
      'Não foi possível concluir o registo. Tenta novamente.',
    );
  });

  it('devolve fallback para erros sem code', () => {
    expect(mapSignUpError({ status: 500, message: 'random' })).toBe(
      'Não foi possível concluir o registo. Tenta novamente.',
    );
  });

  it('devolve fallback para null/undefined/non-object', () => {
    expect(mapSignUpError(null)).toBe('Não foi possível concluir o registo. Tenta novamente.');
    expect(mapSignUpError(undefined)).toBe('Não foi possível concluir o registo. Tenta novamente.');
    expect(mapSignUpError('string error')).toBe(
      'Não foi possível concluir o registo. Tenta novamente.',
    );
  });
});

describe('mapSignInError', () => {
  it('mantém mensagem genérica para invalid_credentials (anti-enumeration)', () => {
    expect(mapSignInError({ code: 'invalid_credentials' })).toBe(
      'Email ou palavra-passe incorrectos.',
    );
  });

  it('expõe email_not_confirmed para desbloquear o utilizador', () => {
    const msg = mapSignInError({ code: 'email_not_confirmed' });
    expect(msg).toMatch(/confirmar o teu email/);
    expect(msg).toMatch(/caixa de entrada/);
  });

  it('mapeia user_banned', () => {
    expect(mapSignInError({ code: 'user_banned' })).toMatch(/suporte@expressia.pt/);
  });

  it('devolve fallback genérico para códigos desconhecidos (anti-enumeration)', () => {
    expect(mapSignInError({ code: 'inventado' })).toBe(
      'Email ou palavra-passe incorrectos.',
    );
  });

  it('devolve fallback para null/undefined', () => {
    expect(mapSignInError(null)).toBe('Email ou palavra-passe incorrectos.');
    expect(mapSignInError(undefined)).toBe('Email ou palavra-passe incorrectos.');
  });
});
