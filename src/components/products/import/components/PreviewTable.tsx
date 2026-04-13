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
import { Check, X, AlertCircle } from 'lucide-react';
import { ImportRow } from '../hooks/useProductImport';

interface PreviewTableProps {
    data: ImportRow[];
    onUpdate: (index: number, field: keyof ImportRow, value: any) => void;
    onRemove: (index: number) => void;
}

export function PreviewTable({ data, onUpdate, onRemove }: PreviewTableProps) {
    return (
        <div className="rounded-xl border bg-card shadow-soft overflow-hidden">
            <div className="max-h-[550px] overflow-auto">
                <Table>
                    <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10 shadow-sm">
                        <TableRow>
                            <TableHead className="w-12 text-center">狀態</TableHead>
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
                                            <div className="bg-success/20 p-1 rounded-full">
                                                <Check className="h-3 w-3 text-success" />
                                            </div>
                                            {row.hasVariant && <Badge variant="outline" className="text-[9px] px-1 h-3 border-primary/30 text-primary">V</Badge>}
                                        </div>
                                    ) : (
                                        <div className="bg-destructive/20 p-1 rounded-full inline-block">
                                            <AlertCircle className="h-3 w-3 text-destructive" />
                                        </div>
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
                                        className="h-8 text-xs border-none bg-transparent focus-visible:bg-background"
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
                                        className="h-8 text-xs border-none bg-transparent focus-visible:bg-background"
                                    />
                                </TableCell>
                                <TableCell>
                                    <div className="flex gap-1 items-center justify-end">
                                        <Input
                                            type="number"
                                            value={row.base_wholesale_price}
                                            onChange={(e) => onUpdate(index, 'base_wholesale_price', parseFloat(e.target.value) || 0)}
                                            className="h-7 w-14 text-[10px] text-right p-1 border-dotted border-b border-t-0 border-x-0 rounded-none bg-transparent"
                                        />
                                        <span className="text-muted-foreground">/</span>
                                        <Input
                                            type="number"
                                            value={row.base_retail_price}
                                            onChange={(e) => onUpdate(index, 'base_retail_price', parseFloat(e.target.value) || 0)}
                                            className="h-7 w-14 text-[10px] text-right p-1 border-dotted border-b border-t-0 border-x-0 rounded-none bg-transparent font-bold"
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
                                            className="h-7 text-[10px] border-none bg-transparent focus-visible:bg-background"
                                        />
                                        <div className="text-[9px] text-muted-foreground px-1 truncate">
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
    );
}
