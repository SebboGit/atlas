import { z } from 'zod';

// Mirrors the `trip_status` Postgres enum from src/db/schema/trips.ts.
// Kept inline here so the Zod schema is self-contained and feature code
// doesn't have to reach into the db layer.
export const TRIP_STATUSES = ['planned', 'active', 'completed', 'archived'] as const;
export const tripStatusEnum = z.enum(TRIP_STATUSES);
export type TripStatus = z.infer<typeof tripStatusEnum>;

// Mirrors the `trip_visibility` Postgres enum (ADR-0015). 'household' =
// shared with every household member; 'private' = creator-only. Default
// 'household' keeps the full-sharing model unless the owner opts out.
export const TRIP_VISIBILITIES = ['household', 'private'] as const;
export const tripVisibilityEnum = z.enum(TRIP_VISIBILITIES);
export type TripVisibility = z.infer<typeof tripVisibilityEnum>;

// Native <input type="date"> submits 'yyyy-mm-dd'. Empty strings come in
// when the user clears the field. Normalize both to Date | null before
// the cross-field refine runs.
const dateInput = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return v;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  });

// `null` is in the accepted input shape on purpose: this schema is
// parsed twice on a typical request — once on the client by RHF's
// resolver and again on the server by the action — and the first parse
// emits `null` for an empty summary. Without accepting `null` on input,
// the second parse rejects valid form data.
const summaryInput = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const t = v.trim();
    return t === '' ? null : t;
  })
  .refine((v) => v === null || v.length <= 2000, 'Summary is too long');

const baseFields = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title is too long'),
  summary: summaryInput,
  status: tripStatusEnum.default('planned'),
  visibility: tripVisibilityEnum.default('household'),
  startDate: dateInput,
  endDate: dateInput,
});

const dateOrder = (
  data: { startDate: Date | null; endDate: Date | null },
  ctx: z.RefinementCtx,
) => {
  if (data.startDate && data.endDate && data.startDate > data.endDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'End date must be on or after start date',
    });
  }
};

export const tripCreateInput = baseFields.superRefine(dateOrder);
export type TripCreateInput = z.infer<typeof tripCreateInput>;

// Update is partial on top of base, but if either date is provided we
// still want the order check. We refine on the final shape with whatever
// fields were sent.
export const tripUpdateInput = baseFields.partial().superRefine((data, ctx) => {
  if (data.startDate && data.endDate && data.startDate > data.endDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'End date must be on or after start date',
    });
  }
});
export type TripUpdateInput = z.infer<typeof tripUpdateInput>;
