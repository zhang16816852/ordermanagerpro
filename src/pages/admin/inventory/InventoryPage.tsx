import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Search, RefreshCw, AlertTriangle, Save, FileText, History, Calculator, Warehouse, PackageSearch, ShieldCheck } from 'lucide-react';
import { DataTable } from '@/components/shared/DataTable';
import { formatCurrency } from '@/lib/formatters';
import { exportToCSV } from '@/lib/exportUtils';
import { useInventory } from './hooks/useInventory';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ColumnDef } from '@tanstack/react-table';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { UseMutationResult } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import WarehousesTab from './components/WarehousesTab';
import BatchesTab from './components/BatchesTab';
import { ReconcileDialog } from './components/ReconcileDialog';
import { StocktakeDialog } from './components/StocktakeDialog';
import { QuantityCell } from './components/QuantityCell';
import { MovementsDialog } from './components/MovementsDialog';

export default function AdminInventory() {
    const {
        inventory,
        isLoading,
        search,
        setSearch,
        lowStockOnly,
        setLowStockOnly,
        warehouseFilter,
        setWarehouseFilter,
        stockStatusFilter,
        setStockStatusFilter,
        itemTypeFilter,
        setItemTypeFilter,
        warehouses,
        pageIndex,
        pageSize,
        setPageIndex,
        updateInventory,
        recalculateInventory,
    } = useInventory();

    const [movementsTarget, setMovementsTarget] = useState<{ productId: string; variantId: string | null; name: string } | null>(null);
    const [reconcileOpen, setReconcileOpen] = useState(false);
    const [stocktakeOpen, setStocktakeOpen] = useState(false);

    const stocktakeItems = useMemo(() => inventory.map((i: any) => ({
        id: i.id,
        name: i.name,
        code: i.code,
        quantity: i.quantity,
        warehouseName: i.warehouseName,
        warehouseCode: i.warehouseCode,
    })), [inventory]);

    const columns: ColumnDef<any>[] = [
        {
            header: "商品項目",
            accessorKey: "name",
            cell: ({ row }) => (
                <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-sm">{row.original.name}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{row.original.code}</span>
                </div>
            )
        },
        {
            header: "零售價",
            accessorKey: "price",
            cell: ({ row }) => (
                <span className="text-sm font-semibold">{formatCurrency(row.original.price)}</span>
            )
        },
        {
            header: "倉庫",
            accessorKey: "warehouseName",
            cell: ({ row }) => (
                <Badge variant="outline" className="text-[10px] font-normal">
                    {row.original.warehouseName}
                </Badge>
            )
        },
        {
            header: "當前庫存",
            accessorKey: "quantity",
            cell: ({ row }) => <QuantityCell row={row} updateInventory={updateInventory} />
        },
        {
            header: "懸空數量",
            accessorKey: "suspenseQuantity",
            cell: ({ row }) => (
                row.original.suspenseQuantity > 0 ? (
                    <Badge variant="outline" className="text-[10px] font-normal text-amber-600 border-amber-200">
                        {row.original.suspenseQuantity}
                    </Badge>
                ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                )
            )
        },
        {
            header: "狀態",
            cell: ({ row }) => (
                <Badge
                    variant={row.original.isLowStock ? "destructive" : "outline"}
                    className="text-[10px] px-1.5 h-5 font-normal leading-none whitespace-nowrap"
                >
                    {row.original.isLowStock ? '低庫存' : '充足'}
                </Badge>
            )
        },
        {
            id: "actions",
            header: "明細",
            cell: ({ row }) => (
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setMovementsTarget({
                        productId: row.original.productId,
                        variantId: row.original.variantId,
                        name: row.original.name
                    })}
                    aria-label="查看異動紀錄"
                >
                    <History className="h-4 w-4" />
                </Button>
            )
        }
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">庫存管理</h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        監控產品存貨、管理倉庫配置
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="p-3">
                    <div className="text-xs text-muted-foreground">總品項數</div>
                    <div className="text-xl font-bold">{inventory.length}</div>
                </Card>
                <Card className="p-3">
                    <div className="text-xs text-muted-foreground">低庫存</div>
                    <div className="text-xl font-bold text-rose-600">{inventory.filter((i: any) => i.isLowStock).length}</div>
                </Card>
                <Card className="p-3">
                    <div className="text-xs text-muted-foreground">懸空 movement</div>
                    <div className="text-xl font-bold text-amber-600">{inventory.filter((i: any) => i.suspenseQuantity > 0).length}</div>
                </Card>
                <Card className="p-3">
                    <div className="text-xs text-muted-foreground">懸空總數量</div>
                    <div className="text-xl font-bold text-amber-600">{inventory.reduce((s: number, i: any) => s + (i.suspenseQuantity || 0), 0)}</div>
                </Card>
            </div>

            <Tabs defaultValue="inventory">
                <TabsList>
                    <TabsTrigger value="inventory">庫存列表</TabsTrigger>
                    <TabsTrigger value="warehouses">
                        <Warehouse className="mr-1.5 h-3.5 w-3.5" />
                        倉庫管理
                    </TabsTrigger>
                    <TabsTrigger value="batches">
                        <PackageSearch className="mr-1.5 h-3.5 w-3.5" />
                        批次 / 序號
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="inventory" className="space-y-6 mt-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={async () => {
                                const exportData = inventory.map((item: any) => ({
                                    "商品名稱": item.name,
                                    "SKU": item.code,
                                    "單價": item.price,
                                    "庫存數量": item.quantity,
                                    "最後更新": item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-'
                                }));
                                await exportToCSV(exportData, '庫存清單');
                            }}>
                                <FileText className="mr-2 h-4 w-4" />
                                匯出 CSV
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    if (window.confirm('將根據採購入庫與出貨紀錄重新計算所有庫存數量，確定繼續？')) {
                                        recalculateInventory.mutate();
                                    }
                                }}
                                disabled={recalculateInventory.isPending}
                            >
                                <Calculator className="mr-2 h-4 w-4" />
                                {recalculateInventory.isPending ? '計算中...' : '系統重算'}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setReconcileOpen(true)}
                            >
                                <ShieldCheck className="mr-2 h-4 w-4" />
                                FIFO 驗算
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setStocktakeOpen(true)}
                            >
                                <PackageSearch className="mr-2 h-4 w-4" />
                                系統盤點
                            </Button>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            重新整理
                        </Button>
                    </div>

                    <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 bg-muted/20 border rounded-xl">
                        <div className="relative w-full md:w-80">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground opacity-50" />
                            <Input
                                placeholder="搜尋名稱或 SKU..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9 bg-background"
                            />
                        </div>

                        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id="low-stock"
                                    checked={lowStockOnly}
                                    onCheckedChange={(v) => setLowStockOnly(!!v)}
                                />
                                <label
                                    htmlFor="low-stock"
                                    className="text-sm font-medium leading-none cursor-pointer flex items-center gap-1"
                                >
                                    僅顯示低庫存
                                    <Badge variant="secondary" className="text-[9px] h-4 px-1">
                                        ≤ 5
                                    </Badge>
                                </label>
                            </div>

                            <select
                                value={warehouseFilter}
                                onChange={(e) => setWarehouseFilter(e.target.value)}
                                className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                            >
                                <option value="all">全部倉庫</option>
                                {warehouses.map(w => (
                                    <option key={w.code} value={w.code}>{w.name}（{w.code}）</option>
                                ))}
                            </select>

                            <select
                                value={stockStatusFilter}
                                onChange={(e) => setStockStatusFilter(e.target.value)}
                                className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                            >
                                <option value="all">全部狀態</option>
                                <option value="negative">負數（異常）</option>
                                <option value="zero">零庫存</option>
                                <option value="low">低庫存（1-5）</option>
                                <option value="normal">充足（&gt;5）</option>
                            </select>

                            <select
                                value={itemTypeFilter}
                                onChange={(e) => setItemTypeFilter(e.target.value)}
                                className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                            >
                                <option value="all">全部類型</option>
                                <option value="product">一般商品</option>
                                <option value="packaging">包裝材料</option>
                                <option value="repair_part">維修零件</option>
                                <option value="shipping">運費（不應出現）</option>
                            </select>
                        </div>
                    </div>

                    <DataTable
                        columns={columns}
                        data={inventory}
                        isLoading={isLoading}
                        skeletonCount={6}
                        pageIndex={pageIndex}
                        pageSize={pageSize}
                        onPageIndexChange={setPageIndex}
                    />

                    {movementsTarget && (
                        <MovementsDialog
                            open={!!movementsTarget}
                            onOpenChange={(open) => { if (!open) setMovementsTarget(null); }}
                            productId={movementsTarget.productId}
                            variantId={movementsTarget.variantId}
                            name={movementsTarget.name}
                        />
                    )}
                    <ReconcileDialog open={reconcileOpen} onOpenChange={setReconcileOpen} />
                    <StocktakeDialog
                        open={stocktakeOpen}
                        onOpenChange={setStocktakeOpen}
                        items={stocktakeItems}
                        warehouses={warehouses}
                        updateInventory={updateInventory}
                        isPending={updateInventory.isPending}
                    />
                </TabsContent>

                <TabsContent value="warehouses" className="mt-6">
                    <WarehousesTab />
                </TabsContent>

                <TabsContent value="batches" className="mt-6">
                    <BatchesTab />
                </TabsContent>
            </Tabs>
        </div>
    );
}