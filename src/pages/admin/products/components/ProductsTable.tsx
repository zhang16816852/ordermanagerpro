import { useState, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductRowItem } from './ProductRowItem';
import type { ProductsListViewProps } from './productsListTypes';

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
    getModelGroups,
    onEdit,
    onCopy,
    onDelete,
    onUpdateVariant
}: ProductsListViewProps) {
    const [sortField, setSortField] = useState<'name' | 'category' | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const toggleSort = (f: 'name' | 'category') => {
        if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(f); setSortDir('asc'); }
    };
    const sortedProducts = useMemo(() => {
        if (!products) return products;
        if (!sortField) return products;
        const arr = [...products];
        arr.sort((a: any, b: any) => {
            const va = (a[sortField] ?? '').toString().toLowerCase();
            const vb = (b[sortField] ?? '').toString().toLowerCase();
            if (va < vb) return sortDir === 'asc' ? -1 : 1;
            if (va > vb) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
        return arr;
    }, [products, sortField, sortDir]);

    if (isLoading) {
        return (
            <div className="rounded-xl border bg-card overflow-x-auto">
                <Table>
                    <TableHeader className="bg-muted/50">
                        <TableRow>
                            <TableHead className="w-[40px]"></TableHead>
                            <TableHead className="w-[50px]"></TableHead>
                            <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('name')}>名稱 {sortField==='name' ? (sortDir==='asc'?'↑':'↓') : ''}</TableHead>
                            <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('category')}>類別 {sortField==='category' ? (sortDir==='asc'?'↑':'↓') : ''}</TableHead>
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
                        <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('name')}>名稱 {sortField==='name' ? (sortDir==='asc'?'↑':'↓') : ''}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('category')}>類別 {sortField==='category' ? (sortDir==='asc'?'↑':'↓') : ''}</TableHead>
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
                        sortedProducts?.map((product) => (
                            <ProductRowItem
                                key={product.id}
                                product={product}
                                brandMap={brandMap}
                                variants={getVariants(product.id)}
                                models={getModels ? getModels(product.id) : []}
                                modelGroups={getModelGroups ? getModelGroups(product.id) : []}
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
