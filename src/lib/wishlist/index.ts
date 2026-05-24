// Client-safe barrel: validators + types only. Repo lives at
// '@/lib/wishlist/repo' so it isn't pulled into client bundles
// (it transitively imports `pg`). Server code does
// `import * as wishlistRepo from '@/lib/wishlist/repo'` directly.
export * from './validators';
export type { WishlistItem } from './repo';
