/**
 * Vitest setup — @meu-jarvis/ui (Story 5.2).
 *
 * Regista os matchers de `@testing-library/jest-dom` (`toBeInTheDocument`,
 * `toHaveClass`, etc.) globalmente para os testes do package. Sem este import,
 * os matchers seriam reportados como `undefined` no `expect()` runtime.
 */
import '@testing-library/jest-dom/vitest';
