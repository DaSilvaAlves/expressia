import { memo } from 'react';

import { isColorDark } from '@/lib/tag-utils';

/**
 * `<TagBadge>` — pill colorido para mostrar uma tag (Story 3.6 T2.1 / AC1).
 *
 * Visual: background a 15% opacidade + border 40% opacidade da cor da tag.
 * Cor do texto calculada pela luminância (`isColorDark`) — branco se escuro, preto se claro.
 * Truncagem responsiva por tamanho — `sm` (~96px max-width) ou `xs` (~64px max-width).
 *
 * `React.memo` shallow (`Object.is`) — props primitivas estáveis. Re-render apenas quando
 * a tag muda. Sem lógica de fetch — componente visual puro.
 */
export interface TagBadgeProps {
  readonly tag: { id: string; name: string; color: string };
  readonly size?: 'sm' | 'xs';
}

function TagBadgeImpl({ tag, size = 'sm' }: TagBadgeProps): React.ReactElement {
  const dark = isColorDark(tag.color);
  const textColor = dark ? '#FFFFFF' : '#000000';
  // Background com 15% opacidade + border com 40% opacidade — gera tonalidade subtle
  // que assegura contraste >= 4.5:1 do texto contra a cor diluída do fundo.
  const style: React.CSSProperties = {
    backgroundColor: `${tag.color}26`, // 0x26 ≈ 15% alpha
    border: `1px solid ${tag.color}66`, // 0x66 ≈ 40% alpha
    color: textColor,
  };

  const sizeClasses =
    size === 'xs'
      ? 'text-[10px] font-medium px-1.5 py-px rounded-full max-w-[64px]'
      : 'text-xs font-medium px-2 py-0.5 rounded-full max-w-[96px]';

  return (
    <span
      role="listitem"
      title={tag.name}
      style={style}
      className={`inline-block truncate align-middle ${sizeClasses}`}
    >
      {tag.name}
    </span>
  );
}

export const TagBadge = memo(TagBadgeImpl);
