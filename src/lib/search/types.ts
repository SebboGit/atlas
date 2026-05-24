export type SearchEntityType = 'trip' | 'segment' | 'document' | 'wishlist';

export type SegmentSubtype = 'flight' | 'hotel' | 'activity' | 'transit' | 'food' | 'note';

export type WishlistSubtype = 'food' | 'activity';

export type SearchResultRow = {
  type: SearchEntityType;
  // Only populated when `type === 'segment'`. Drives the icon choice in
  // the palette so we don't have to round-trip a join just to render.
  segmentType: SegmentSubtype | null;
  // Only populated when `type === 'wishlist'`. Drives the icon choice
  // for wishlist rows (fork vs. sparkles).
  wishlistType: WishlistSubtype | null;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

export type SearchResults = {
  trips: SearchResultRow[];
  segments: SearchResultRow[];
  documents: SearchResultRow[];
  wishlist: SearchResultRow[];
};
