import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, RefreshCw, AlertTriangle, Save, FileText, History, Calculator, Warehouse } from 'lucide-react';
import { DataTable } from '@/components/shared/DataTable';
import { formatCurrency } from '@/lib/formatters';
import { exportToCSV } from '@/lib/exportUtils';
import { useInventory, useInventoryMovements } from './hooks/useInventory';
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

const SOURCE_TYPE_LABELS: Record<string, string> = {
    purchase_receipt: '採購入庫',
    sales_shipment: '出貨扣減',
    sales_note_deletion: '銷貨刪除回補',
    manual_adjustment: '手動調整',
};

function QuantityCell({ row, updateInventory }: { row: any; updateInventory: UseMutationResult<any, Error, { id: string; quantity: number; note?: string }, unknown> }) {
    const [val, setVal] = useState(row.original.quantity);
    const [showAdjust, setShowAdjust] = useState(false);
    const [adjustNote, setAdjustNote] = useState('');
    const isDirty = val !== row.original.quantity;

    return (
        <>
            <div className="flex items-center gap-2">
                <Input
                    type="number"
                    value={val}
                    onChange={(e) => setVal(parseInt(e.target.value) || 0)}
                    className={cn(
                        "w-20 h-8 text-right text-xs",
                        row.original.isLowStock && !isDirty ? "border-rose-300 bg-rose-50 text-rose-700" : "",
                        isDirty ? "border-blue-400 ring-1 ring-blue-400" : ""
                    )}
                />
                {isDirty && (
                    <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-7 w-7 text-blue-600"
                        onClick={() => setShowAdjust(true)}
                        disabled={updateInventory.isPending}
                        aria-label="儲存庫存"
                    >
                        <Save className="h-4 w-4" />
                    </Button>
                )}
                {row.original.isLowStock && !isDirty && (
                    <AlertTriangle className="h-4 w-4 text-rose-500 animate-pulse" />
                )}
            </div>

            <Dialog open={showAdjust} onOpenChange={setShowAdjust}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>庫存調整確認</DialogTitle>
                        <DialogDescription>
                            {row.original.name}
                            <Badge variant="secondary" className="ml-2 text-[10px]">{row.original.warehouseName}</Badge>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="flex items-center gap-4 justify-center text-lg">
                            <span className="font-mono tabular-nums text-muted-foreground line-through">{row.original.quantity}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-mono tabular-nums font-bold text-lg">{val}</span>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="adjust-note" className="text-xs text-muted-foreground">調整原因（選填）</Label>
                            <Input
                                id="adjust-note"
                                value={adjustNote}
                                onChange={(e) => setAdjustNote(e.target.value)}
                                placeholder="例：盤點差異、破損報廢..."
                                className="text-sm"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => { setShowAdjust(false); setAdjustNote(''); }}>
                            取消
                        </Button>
                        <Button size="sm" onClick={() => {
                            updateInventory.mutate({ id: row.original.id, quantity: val, note: adjustNote || undefined });
                            setShowAdjust(false);
                            setAdjustNote('');
                        }}>
                            確認調整
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

function MovementsDialog({ open, onOpenChange, productId, variantId, name }: { open: boolean; onOpenChange: (open: boolean) => void; productId: string | null; variantId: string | null; name: string }) {
    const { data: movements = [], isLoading } = useInventoryMovements(productId, variantId);
    const [filterType, setFilterType] = useState('');

    const filtered = filterType
        ? movements.filter(m => m.sourceType === filterType)
        : movements;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>庫存明細 - {name}</DialogTitle>
                    <DialogDescription>
                        進出貨記錄，包含採購入庫、出貨扣減、手動調整等
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center gap-2 mb-4">
                    <span className="text-sm text-muted-foreground">篩選：</span>
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                    >
                        <option value="">全部</option>
                        <option value="purchase_receipt">採購入庫</option>
                        <option value="sales_shipment">出貨扣減</option>
                        <option value="sales_note_deletion">銷貨刪除回補</option>
                        <option value="manual_adjustment">手動調整</option>
                    </select>
                </div>

                <ScrollArea className="max-h-[60vh]">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="text-xs">時間</TableHead>
                                <TableHead className="text-xs text-right">異動</TableHead>
                                <TableHead className="text-xs text-right">餘額</TableHead>
                                <TableHead className="text-xs">來源</TableHead>
                                <TableHead className="text-xs">單號</TableHead>
                                <TableHead className="text-xs">備註</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">載入中...</TableCell>
                                </TableRow>
                            ) : filtered.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">暫無記錄</TableCell>
                                </TableRow>
                            ) : (
                                filtered.map((m: any) => (
                                    <TableRow key={m.id}>
                                        <TableCell className="text-xs whitespace-nowrap">
                                            {m.createdAt ? new Date(m.createdAt).toLocaleString() : '-'}
                                        </TableCell>
                                        <TableCell className={cn(
                                            "text-xs text-right font-mono tabular-nums",
                                            m.quantityChange > 0 ? "text-emerald-600" : "text-rose-600"
                                        )}>
                                            {m.quantityChange > 0 ? '+' : ''}{m.quantityChange}
                                        </TableCell>
                                        <TableCell className="text-xs text-right font-mono tabular-nums">
                                            {m.balanceAfter}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            <Badge variant="outline" className="text-[10px] font-normal">
                                                {SOURCE_TYPE_LABELS[m.sourceType] || m.sourceType}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs font-mono">
                                            {m.referenceCode || '-'}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">
                                            {m.note || '-'}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}

export default function AdminInventory() {
    const {
        inventory,
        isLoading,
        search,
        setSearch,
        lowStockOnly,
        setLowStockOnly,
        updateInventory,
        recalculateInventory,
    } = useInventory();

    const [movementsTarget, setMovementsTarget] = useState<{ productId: string; variantId: string | null; name: string } | null>(null);

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
            header: "規格 / 描述",
            accessorKey: "specs",
            cell: ({ row }) => (
                <span className="text-xs text-muted-foreground italic">{row.original.specs}</span>
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
            header: "狀態",
            cell: ({ row }) => (
                <Badge 
                    variant={row.original.isLowStock ? "destructive" : "outline"}
                    className="text-[10px] px-1.5 h-5 font-normal"
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

            <Tabs defaultValue="inventory">
                <TabsList>
                    <TabsTrigger value="inventory">庫存列表</TabsTrigger>
                    <TabsTrigger value="warehouses">
                        <Warehouse className="mr-1.5 h-3.5 w-3.5" />
                        倉庫管理
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="inventory" className="space-y-6 mt-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={async () => {
                                const exportData = inventory.map((item: any) => ({
                                    "商品名稱": item.name,
                                    "SKU": item.code,
                                    "規格": item.specs,
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

                        <div className="flex items-center gap-4 w-full md:w-auto">
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
                                    僅顯示低庫存項目
                                    <Badge variant="secondary" className="text-[9px] h-4 px-1">
                                        ≤ 5
                                    </Badge>
                                </label>
                            </div>
                        </div>
                    </div>

                    <DataTable
                        columns={columns}
                        data={inventory}
                        isLoading={isLoading}
                        skeletonCount={6}
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
                </TabsContent>

                <TabsContent value="warehouses" className="mt-6">
                    <WarehousesTab />
                </TabsContent>
            </Tabs>
        </div>
    );
}
