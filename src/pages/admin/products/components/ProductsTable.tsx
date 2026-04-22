import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductRowItem } from './ProductRowItem';
import { Tables } from '@/integrations/supabase/types';

type Product = Tables<'products'>;

interface ProductsTableProps {
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
    onEdit: (p: Product) => void;
    onCopy: (p: Product) => void;
    onDelete: (p: Product) => void;
    onUpdateVariant: (id: string, updates: any) => void;
}

export function ProductsTable({
    products,
    isLoading,
    brandMap,
    selectedIds,
    isAllSelected,
    expandedIds,
    onToggleSelectAll,
    onToggleSelect,
    onToggleExpand,
    getVariants,
    getModels,
    onEdit,
    onCopy,
    onDelete,
    onUpdateVariant
}: ProductsTableProps) {
    if (isLoading) {
        return (
            <div className="rounded-xl border bg-card overflow-x-auto">
                <Table>
                    <TableHeader className="bg-muted/50">
                        <TableRow>
                            <TableHead className="w-[40px]"></TableHead>
                            <TableHead className="w-[50px]"></TableHead>
                            <TableHead>名稱</TableHead>
                            <TableHead>類別</TableHead>
                            <TableHead>廠牌/型號</TableHead>
                            <TableHead className="text-right">批發/零售價</TableHead>
                            <TableHead>狀態</TableHead>
                            <TableHead className="w-12"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i}>
                                <TableCell colSpan={8}><Skeleton className="h-10 w-full" /></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        );
    }

    return (
        <div className="rounded-xl border bg-card shadow-sm overflow-x-auto">
            <Table>
                <TableHeader className="bg-muted/50">
                    <TableRow>
                        <TableHead className="w-[40px]">
                            <Checkbox
                                checked={isAllSelected}
                                onCheckedChange={onToggleSelectAll}
                                aria-label="Select all"
                            />
                        </TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                        <TableHead>名稱</TableHead>
                        <TableHead>類別</TableHead>
                        <TableHead className="min-w-[120px]">廠牌 / 型號</TableHead>
                        <TableHead className="text-right">批發 / 零售價</TableHead>
                        <TableHead>狀態</TableHead>
                        <TableHead className="w-12 text-center">操作</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {products?.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                                找不到符合條件的產品
                            </TableCell>
                        </TableRow>
                    ) : (
                        products?.map((product) => (
                            <ProductRowItem
                                key={product.id}
                                product={product}
                                brandMap={brandMap}
                                variants={getVariants(product.id)}
                                models={getModels ? getModels(product.id) : []}
                                isSelected={selectedIds.has(product.id)}
                                isExpanded={expandedIds.has(product.id)}
                                onToggleSelect={() => onToggleSelect(product.id)}
                                onToggleExpand={() => onToggleExpand(product.id)}
                                onEdit={onEdit}
                                onCopy={onCopy}
                                onDelete={onDelete}
                                onUpdateVariant={onUpdateVariant}
                            />
                        ))
                    )}
                </TableBody>
            </Table>
        </div>
    );
}
