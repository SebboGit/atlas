'use client';

import * as React from 'react';
import type { z } from 'zod';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  createWishlistItemAction,
  type FormError,
  updateWishlistItemAction,
} from '@/lib/wishlist/actions';
import type { WishlistItem, WishlistItemType, wishlistItemCreateInput } from '@/lib/wishlist';
import type { Result } from '@/types/result';

import { WishlistForm } from './wishlist-form';

type FormInput = z.input<typeof wishlistItemCreateInput>;

interface WishlistFormDialogProps {
  trigger: React.ReactNode;
  defaultType?: WishlistItemType;
  defaultCountryCode?: string;
  editingItem?: WishlistItem;
}

const CREATE_TITLE: Record<WishlistItemType, string> = {
  food: 'New food spot',
  activity: 'New attraction',
};

const EDIT_TITLE: Record<WishlistItemType, string> = {
  food: 'Edit food spot',
  activity: 'Edit attraction',
};

function itemToFormInput(item: WishlistItem): FormInput {
  return {
    type: item.type,
    data: item.data,
    countryCode: item.countryCode,
    locationName: item.locationName ?? '',
    notes: item.notes ?? '',
    tags: item.tags,
  } as FormInput;
}

export function WishlistFormDialog({
  trigger,
  defaultType,
  defaultCountryCode,
  editingItem,
}: WishlistFormDialogProps) {
  const [open, setOpen] = React.useState(false);

  const submit = React.useCallback(
    async (input: unknown): Promise<Result<{ id: string }, FormError>> => {
      if (editingItem) return updateWishlistItemAction(editingItem.id, input);
      return createWishlistItemAction(input);
    },
    [editingItem],
  );

  const title = editingItem
    ? EDIT_TITLE[editingItem.type]
    : (CREATE_TITLE[defaultType ?? 'food'] ?? 'New wishlist item');
  const submitLabel = editingItem ? 'Save changes' : undefined;
  const initialValues = editingItem ? itemToFormInput(editingItem) : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest('[data-radix-popper-content-wrapper]')) {
            e.preventDefault();
          }
        }}
        aria-describedby={undefined}
        className="gap-4 sm:p-6"
      >
        <DialogHeader className="gap-0">
          <DialogTitle className="text-xl">{title}</DialogTitle>
        </DialogHeader>
        <WishlistForm
          defaultType={defaultType}
          defaultCountryCode={defaultCountryCode}
          initialValues={initialValues}
          submitLabel={submitLabel}
          onSubmit={submit}
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
