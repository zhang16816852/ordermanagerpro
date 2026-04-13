import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, Filter, RefreshCw, AlertTriangle, Save, FileText } from 'lucide-react';
import { DataTable } from '@/components/shared/DataTable';
import { formatCurrency } from '@/lib/formatters';
import { exportToCSV } from '@/lib/exportUtils';
import { useInventory } from './hooks/useInventory';
import { ColumnDef } from '@tanstack/react-table';
import { Checkbox } from '@/components/ui/checkbox';

export default function AdminInventory() {
    const {
        inventory,
        isLoading,
        search,
        setSearch,
        lowStockOnly,
        setLowStockOnly,
        updateInventory
    } = useInventory();

    // 定義表格欄位
    const columns: ColumnDef<any>[] = [
        {
            header: "商品項目",
            accessorKey: "name",
            cell: ({ row }) => (
                <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-sm">{row.original.name}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{row.original.sku}</span>
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
            header: "當前庫存",
            accessorKey: "quantity",
            cell: ({ row }) => {
                const [val, setVal] = useState(row.original.quantity);
                const isDirty = val !== row.original.quantity;

                return (
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
                                onClick={() => updateInventory.mutate({ id: row.original.id, quantity: val })}
                                disabled={updateInventory.isPending}
                            >
                                <Save className="h-4 w-4" />
                            </Button>
                        )}
                        {row.original.isLowStock && !isDirty && (
                            <AlertTriangle className="h-4 w-4 text-rose-500 animate-pulse" />
                        )}
                    </div>
                );
            }
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
        }
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">庫存管理</h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        監控產品存貨水位並即時進行數量調整
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => {
                        const exportData = inventory.map(item => ({
                            "商品名稱": item.name,
                            "SKU": item.sku,
                            "規格": item.specs,
                            "單價": item.price,
                            "庫存數量": item.quantity,
                            "最後更新": item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-'
                        }));
                        exportToCSV(exportData, '庫存清單');
                    }}>
                        <FileText className="mr-2 h-4 w-4" />
                        匯出 CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        重新整理
                    </Button>
                </div>
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
        </div>
    );
}

// 輔助函數：cn
import { cn } from '@/lib/utils';
