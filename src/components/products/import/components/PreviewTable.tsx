import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, AlertCircle, Filter, Info } from 'lucide-react';
import { ImportRow } from '../hooks/useProductImport';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface PreviewTableProps {
    data: ImportRow[];
    categories: any[];
    filterCategory: string;
    onFilterChange: (id: string) => void;
    filterStatus: string;
    onStatusFilterChange: (status: string) => void;
    onUpdate: (index: number, field: keyof ImportRow, value: any) => void;
    onRemove: (index: number) => void;
}

export function PreviewTable({
    data, categories, filterCategory, onFilterChange,
    filterStatus, onStatusFilterChange, onUpdate, onRemove
}: PreviewTableProps) {
    console.log("匯入資料", data)
    return (
        <div className="space-y-4">
            {/* 變動篩選與工具列 */}
            <div className="flex flex-wrap items-center gap-4 bg-muted/20 p-3 rounded-lg border">
                <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">變動篩選：</span>
                    <Select value={filterStatus} onValueChange={onStatusFilterChange}>
                        <SelectTrigger className="w-[140px] h-8 bg-background">
                            <SelectValue placeholder="所有項目" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">顯示所有 ({data.length})</SelectItem>
                            <SelectItem value="changed">僅限變更項目</SelectItem>
                            <SelectItem value="new">僅限新增項目</SelectItem>
                            <SelectItem value="error">僅限錯誤項目</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center gap-2 border-l pl-4 ml-2">
                    <span className="text-sm font-medium text-muted-foreground">分類篩選：</span>
                    <Select value={filterCategory} onValueChange={onFilterChange}>
                        <SelectTrigger className="w-[150px] h-8 bg-background">
                            <SelectValue placeholder="選擇分類" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">所有分類</SelectItem>
                            {categories.map(cat => (
                                <SelectItem key={cat.id} value={cat.name}>{cat.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex-1 text-right text-[10px] text-muted-foreground">
                    <Info className="h-3 w-3 inline mr-1 mb-0.5" />
                    黃色背景代表內容與資料庫不符 (將被更新)
                </div>
            </div>

            <div className="rounded-xl border bg-card shadow-soft overflow-hidden">
                <div className="max-h-[550px] overflow-auto">
                    <Table>
                        <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10 shadow-sm">
                            <TableRow>
                                <TableHead className="w-12 text-center">狀態</TableHead>
                                <TableHead className="w-[120px]">變更內容</TableHead>
                                <TableHead className="w-[150px]">產品 SKU</TableHead>
                                <TableHead className="min-w-[180px]">產品名稱</TableHead>
                                <TableHead className="w-[120px]">品牌/系列</TableHead>
                                <TableHead className="w-[120px]">分類</TableHead>
                                <TableHead className="w-[140px] text-right">批發 / 零售</TableHead>
                                <TableHead className="w-[150px]">變體 SKU</TableHead>
                                <TableHead className="min-w-[150px]">變體名稱 / 選項</TableHead>
                                <TableHead className="w-12 text-center"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {data.map((row, index) => (
                                <TableRow key={index} className={!row.isValid ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-muted/50'}>
                                    <TableCell className="text-center">
                                        {row.isValid ? (
                                            <div className="flex flex-col items-center gap-1">
                                                {row.action === 'create' ? (
                                                    <Badge className="text-[10px] px-1.5 h-4 bg-emerald-500 hover:bg-emerald-600">新增</Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-[10px] px-1.5 h-4 border-amber-500 text-amber-600 bg-amber-50">
                                                        更新
                                                    </Badge>
                                                )}
                                                {row.hasVariant && (
                                                    <Badge variant="secondary" className="text-[8px] px-1 h-3.5 opacity-70">
                                                        變體
                                                    </Badge>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="bg-destructive/10 p-1.5 rounded-full inline-block">
                                                <AlertCircle className="h-4 w-4 text-destructive" />
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {row.action === 'update' && row.diff && row.diff.length > 0 ? (
                                            <div className="flex flex-wrap gap-1">
                                                {row.diff.map(field => (
                                                    <Badge key={field} variant="outline" className="text-[9px] px-1 h-3.5 bg-amber-500/10 border-amber-500/20 text-amber-700">
                                                        {field}
                                                    </Badge>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-[10px] text-muted-foreground">-</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Input
                                            value={row.product_sku}
                                            onChange={(e) => onUpdate(index, 'product_sku', e.target.value)}
                                            className="h-8 font-mono text-[11px] border-none bg-transparent focus-visible:bg-background"
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Input
                                            value={row.product_name}
                                            onChange={(e) => onUpdate(index, 'product_name', e.target.value)}
                                            className={cn(
                                                "h-8 text-xs border-none bg-transparent focus-visible:bg-background",
                                                row.diff?.includes('產品名稱') && "bg-amber-500/10 text-amber-900"
                                            )}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <div className="space-y-1">
                                            <Input
                                                value={row.brand}
                                                placeholder="品牌"
                                                onChange={(e) => onUpdate(index, 'brand', e.target.value)}
                                                className="h-7 text-[10px] border-none bg-transparent focus-visible:bg-background"
                                            />
                                            <Input
                                                value={row.series}
                                                placeholder="系列"
                                                onChange={(e) => onUpdate(index, 'series', e.target.value)}
                                                className="h-7 text-[10px] border-none bg-transparent focus-visible:bg-background opacity-70"
                                            />
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Input
                                            value={row.category}
                                            onChange={(e) => onUpdate(index, 'category', e.target.value)}
                                            className={cn(
                                                "h-8 text-xs border-none bg-transparent focus-visible:bg-background",
                                                row.diff?.includes('分類') && "bg-amber-500/10 text-amber-900"
                                            )}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex gap-1 items-center justify-end">
                                            <Input
                                                type="number"
                                                value={row.base_wholesale_price}
                                                onChange={(e) => onUpdate(index, 'base_wholesale_price', parseFloat(e.target.value) || 0)}
                                                className={cn(
                                                    "h-7 w-14 text-[10px] text-right p-1 border-dotted border-b border-t-0 border-x-0 rounded-none bg-transparent",
                                                    row.diff?.includes('批發價') && "bg-amber-500/20 text-amber-900"
                                                )}
                                            />
                                            <span className="text-muted-foreground">/</span>
                                            <Input
                                                type="number"
                                                value={row.base_retail_price}
                                                onChange={(e) => onUpdate(index, 'base_retail_price', parseFloat(e.target.value) || 0)}
                                                className={cn(
                                                    "h-7 w-14 text-[10px] text-right p-1 border-dotted border-b border-t-0 border-x-0 rounded-none bg-transparent font-bold",
                                                    row.diff?.includes('零售價') && "bg-amber-500/20 text-amber-900"
                                                )}
                                            />
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Input
                                            value={row.variant_sku || ''}
                                            placeholder="-"
                                            onChange={(e) => onUpdate(index, 'variant_sku', e.target.value)}
                                            className="h-8 font-mono text-[11px] border-none bg-transparent focus-visible:bg-background"
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <div className="space-y-1">
                                            <Input
                                                value={row.variant_name || ''}
                                                placeholder="變體名稱"
                                                onChange={(e) => onUpdate(index, 'variant_name', e.target.value)}
                                                className={cn(
                                                    "h-7 text-[10px] border-none bg-transparent focus-visible:bg-background",
                                                    row.diff?.includes('變體名稱') && "bg-amber-500/10 text-amber-900"
                                                )}
                                            />
                                            <div className={cn(
                                                "text-[9px] text-muted-foreground px-1 truncate rounded",
                                                row.diff?.includes('變體規格') && "bg-amber-500/10 text-amber-900 font-bold"
                                            )}>
                                                {[row.option_1, row.option_2, row.option_3].filter(Boolean).join(', ') || '-'}
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-50 hover:opacity-100"
                                            onClick={() => onRemove(index)}
                                        >
                                            <X className="h-3 w-3" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </div>
        </div>
    );
}
