'use client';

import * as React from 'react';
import type { FieldErrors, UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';

import { segmentCreateInput } from '@/lib/segments';

// Shared types used by every per-type fields module + the dispatcher.
// Centralised here so a future refactor of the discriminated union
// doesn't have to chase six call sites.
export type FormInput = z.input<typeof segmentCreateInput>;
export type FormOutput = z.output<typeof segmentCreateInput>;
export type Form = UseFormReturn<FormInput, unknown, FormOutput>;

// Field-errors view scoped to the per-type `data` subtree. The
// discriminated union makes precise narrowing awkward; this stays
// runtime-safe (we always index by string keys that exist on the
// active variant).
export type DataErrors = Record<string, { message?: string } | undefined>;

export function getDataErrors(errors: FieldErrors<FormInput>): DataErrors {
  return (errors.data as DataErrors | undefined) ?? {};
}

// Tiny inline UI primitives — used in many field modules. Kept here
// (not in components/ui/) because they're form-specific in
// styling/copy and not part of the public design system.

export function Optional() {
  return <span className="text-foreground/40 tracking-normal normal-case"> · optional</span>;
}

export function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-destructive mt-0.5 text-xs leading-snug">
      {children}
    </p>
  );
}

export function FormBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive/8 text-destructive rounded-xl border px-4 py-3 text-sm"
    >
      {children}
    </div>
  );
}
