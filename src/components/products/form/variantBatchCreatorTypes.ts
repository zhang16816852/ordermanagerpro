import type { Tables } from '@/integrations/supabase/types';
import type { SharedVariant } from '@/utils/variantGeneration';
import type { VariantReference } from '@/utils/variantReferenceCheck';

export type Product = Tables<'products'>;

export interface VariantBatchCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  onSuccess: () => void;
}

export interface DiffSummary {
  added: number;
  kept: number;
  updated: number;
  removed: SharedVariant[];
  orphans: SharedVariant[];
  priceUpdated: number;
}

export interface OrphanEntry {
  variant: SharedVariant;
  refs: VariantReference[];
}

export interface OrphanConfirmState {
  referencedOrphans: OrphanEntry[];
  unreferencedToDelete: SharedVariant[];
}