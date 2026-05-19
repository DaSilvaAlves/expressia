/**
 * Utilitárias de cor para `TagBadge` — Story 3.6 T2.2 / AC1(b), AC9(d).
 *
 * Cálculo de luminância relativa (W3C / WCAG 2.1) para decidir cor de texto
 * (branco vs preto) sobre background colorido — garantir contraste ≥ 4.5:1.
 */

/** Decompõe `#RRGGBB` em `{ r, g, b }` (0-255). Retorna `null` se inválido. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9A-Fa-f]{6})$/.exec(hex);
  if (!match || !match[1]) return null;
  const value = match[1];
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return { r, g, b };
}

/**
 * Indica se a cor é "escura" — usar texto branco quando true, preto quando false.
 *
 * Fórmula: luminância relativa simplificada `L = 0.299*R + 0.587*G + 0.114*B` (escala 0-255).
 * Threshold `< 128` (escala 0-255) corresponde aproximadamente a `< 0.5` (escala 0-1).
 * Hex inválido devolve `true` (default conservador — texto branco).
 */
export function isColorDark(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;
  const luminance = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  return luminance < 128;
}
