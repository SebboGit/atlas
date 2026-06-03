import { notFound } from 'next/navigation';

import { DocumentCard } from '@/components/features/documents/document-card';
import { DocumentUploadDialog } from '@/components/features/documents/document-upload-dialog';
import { ExtractingAutoRefresh } from '@/components/features/documents/extracting-auto-refresh';
import { TabEmpty } from '@/components/features/segments/tab-empty';
import { TabHeader } from '@/components/features/segments/tab-header';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/session';
import * as documentsRepo from '@/lib/documents/repo';
import { isExtractionFresh } from '@/lib/documents/state';
import * as tripsRepo from '@/lib/trips/repo';

interface DocumentsTabPageProps {
  params: Promise<{ id: string }>;
}

export default async function DocumentsTabPage({ params }: DocumentsTabPageProps) {
  const user = await requireUser();
  const { id } = await params;

  const trip = await tripsRepo.getByIdForUser(user.id, id);
  if (!trip) notFound();

  // Documents stay uploader-scoped (ADR-0015): a household member can see
  // and edit a shared trip's segments, but its documents belong to the
  // member who uploaded them. So a non-owner gets an empty list and no
  // upload affordance here.
  const isOwner = trip.userId === user.id;
  const docs = await documentsRepo.listForTrip(user.id, id);

  // Poll the RSC while at least one doc is mid-extraction. Stale rows
  // (process restarted, job lost) don't count — the page would never
  // resolve them by polling. isExtractionFresh defaults `now` to
  // Date.now() inside the helper, so the purity-rule scolding stays
  // confined to that one module.
  const anyExtracting = docs.some((d) => isExtractionFresh(d));

  const uploadButton = isOwner ? (
    <DocumentUploadDialog tripId={id} trigger={<Button size="sm">+ Upload</Button>} />
  ) : null;

  return (
    <>
      {anyExtracting && <ExtractingAutoRefresh />}
      <TabHeader eyebrow="Documents" count={docs.length} action={uploadButton} />

      {docs.length === 0 ? (
        <TabEmpty
          // Title tracks the audience: "yet" implies none exist (true for
          // the owner); a non-owner's empty tab means none are shared with
          // them, not that none exist.
          title={isOwner ? 'No documents yet.' : 'Nothing shared here.'}
          hint={
            isOwner
              ? 'Drop a boarding pass, hotel reservation, or ticket. Atlas verifies the file type and stores the original on disk.'
              : "Documents stay with the member who uploaded them — ask the trip's owner."
          }
          action={uploadButton}
        />
      ) : (
        <ul className="atlas-rise space-y-3" style={{ animationDelay: '300ms' }}>
          {docs.map((doc) => (
            <li key={doc.id}>
              <DocumentCard document={doc} tripId={id} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
