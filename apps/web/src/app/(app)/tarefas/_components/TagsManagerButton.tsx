'use client';

import { useState } from 'react';

import { TagsManager } from '@/app/(app)/tarefas/_components/TagsManager';

/**
 * `<TagsManagerButton>` — botão "Gerir tags" no header (Story 3.6 T5.7 / AC3a).
 *
 * Pequena ilha cliente que abre o modal `TagsManager` hand-rolled.
 */
export function TagsManagerButton(): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-black/15 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700"
      >
        Gerir tags
      </button>
      <TagsManager open={open} onClose={() => setOpen(false)} />
    </>
  );
}
