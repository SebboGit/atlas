import { Paperclip } from 'lucide-react';

import type { LinkedDocument } from '@/lib/documents';

interface LinkedDocumentChipsProps {
  documents: LinkedDocument[];
}

// Footer slot for SegmentCardShell — one chip per document linked to
// the segment. Each chip opens the original file inline in a new tab
// through the authenticated /api/documents/<id> route; storage keys
// never leak to the client.
//
// Truncates long filenames inside the chip (max-w cap) with the full
// name on the `title` attribute. Multi-pass flights surface every
// traveller's pass; ordering matches `documents.createdAt` asc so it
// stays stable across page loads.
export function LinkedDocumentChips({ documents }: LinkedDocumentChipsProps) {
  if (documents.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {documents.map((doc) => (
        <a
          key={doc.id}
          href={`/api/documents/${doc.id}?disposition=inline`}
          target="_blank"
          rel="noopener noreferrer"
          title={doc.title ?? doc.originalName}
          className="border-foreground/15 bg-card/70 text-foreground/70 hover:bg-card hover:text-foreground hover:border-foreground/30 inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors"
        >
          <Paperclip className="size-3 shrink-0" strokeWidth={1.75} />
          <span className="truncate font-mono text-[10px] tracking-wider">
            {doc.title ?? doc.originalName}
          </span>
        </a>
      ))}
    </div>
  );
}
