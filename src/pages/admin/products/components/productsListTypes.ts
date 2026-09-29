import type { Tables } from '@/integrations/supabase/types';

export type Product = Tables<'products'>;

export interface ProductsListViewProps {
    products: Product[] | undefined;
    isLoading: boolean;
    brandMap: Record<string, string>;
    selectedIds: Set<string>;
    isAllSelected: boolean;
    expandedIds: Set<string>;
    onToggleSelectAll: (checked: boolean) => void;
    onToggleSelect: (id: string) => void;
    onToggleExpand: (id: string) => void;
    getVariants: (id: string) => any[];
    getModels?: (id: string) => string[];
    getModelGroups?: (id: string) => string[];
    onEdit: (p: Product) => void;
    onCopy: (p: Product) => void;
    onDelete: (p: Product) => void;
    onUpdateVariant: (id: string, updates: any) => void;
}
