import { z } from 'zod';

// Reusable pagination input for list endpoints and server actions.
// Capped at 100 to keep responses bounded.
export const paginationParams = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).default(20),
});

export type PaginationParams = z.infer<typeof paginationParams>;
