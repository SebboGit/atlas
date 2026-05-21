export type SearchEntityType = 'trip' | 'segment' | 'document';

export type SegmentSubtype = 'flight' | 'hotel' | 'activity' | 'transit' | 'food' | 'note';

export type SearchResultRow = {
  type: SearchEntityType;
  // Only populated when `type === 'segment'`. Drives the icon choice in
  // the palette so we don't have to round-trip a join just to render.
  segmentType: SegmentSubtype | null;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

export type SearchResults = {
  trips: SearchResultRow[];
  segments: SearchResultRow[];
  documents: SearchResultRow[];
};
