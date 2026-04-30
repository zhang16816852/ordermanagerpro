import React, { useState } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Check, X, AlertCircle, Filter, Info } from 'lucide-react';
import { ImportRow } from '../hooks/useProductImport';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { formatSpecValue } from '@/utils/specLogic';
import { useColorStore } from '@/store/useColorStore';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';

interface PreviewTableProps {
    data: ImportRow[];
    categories: any[];
    filterCategory: string;
    onFilterChange: (id: string) => void;
    filterStatus: string;
    onStatusFilterChange: (status: string) => void;
    onUpdate: (index: number, field: keyof ImportRow, value: any) => void;
    onRemove: (index: number) => void;
    allBrands?: any[];
}

export function PreviewTable({
    data, categories, filterCategory, onFilterChange,
    filterStatus, onStatusFilterChange, onUpdate, onRemove,
    allBrands = []
}: PreviewTableProps) {
    const { colors: allColors, addColor, fetchColors, getColorByName } = useColorStore();
    const [searchQuery, setSearchQuery] = useState('');
    const [addingColorForIndex, setAddingColorForIndex] = useState<number | null>(null);
    const [newColorForm, setNewColorForm] = useState({ name: '', code: '', hex_code: '#808080' });

    React.useEffect(() => {
        fetchColors();
    }, []);
    console.log("allColors", allColors)
    console.log("data", data)
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
                                <TableHead className="w-[120px]">型號 (一般)</TableHead>
                                <TableHead className="w-[140px]">裝置型號 (庫)</TableHead>
                                <TableHead className="w-[140px]">品牌庫匹配</TableHead>
                                <TableHead className="w-[110px]">分類</TableHead>
                                <TableHead className="w-[130px] text-right">批發 / 零售</TableHead>
                                <TableHead className="min-w-[120px]">規格摘要</TableHead>
                                <TableHead className="w-[150px]">變體 SKU</TableHead>
                                <TableHead className="w-[120px]">顏色</TableHead>
                                <TableHead className="min-w-[150px]">其他選項</TableHead>
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
                                                {row.is_variant ? (
                                                    <Badge variant="secondary" className="text-[9px] px-1.5 h-4 bg-indigo-50 text-indigo-700 border-indigo-200">
                                                        變體
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-[9px] px-1.5 h-4 bg-slate-50 text-slate-600 border-slate-200">
                                                        主商品
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
                                        <Input
                                            value={row.model || ''}
                                            placeholder="一般型號"
                                            onChange={(e) => onUpdate(index, 'model', e.target.value)}
                                            className={cn(
                                                "h-8 text-xs border-none bg-transparent focus-visible:bg-background",
                                                row.diff?.includes('型號') && "bg-amber-500/10 text-amber-900"
                                            )}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col gap-1">
                                            <Input
                                                value={row.device_models || ''}
                                                placeholder="例: iPhone 15"
                                                onChange={(e) => onUpdate(index, 'device_models', e.target.value)}
                                                className={cn(
                                                    "h-8 text-[10px] border-none bg-transparent focus-visible:bg-background",
                                                    row.device_models && !row.device_models.split(',').every(name => 
                                                        allDeviceModels.some(dm => dm.name.toLowerCase() === name.trim().toLowerCase())
                                                    ) && "text-destructive font-bold bg-destructive/5"
                                                )}
                                            />
                                            {row.device_models && !row.device_models.split(',').every(name => 
                                                allDeviceModels.some(dm => dm.name.toLowerCase() === name.trim().toLowerCase())
                                            ) && (
                                                <span className="text-[8px] text-destructive pl-1">部分型號在庫中找不到</span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {row.brand_id ? (
                                            <div className="flex flex-col gap-1">
                                                <Badge variant="outline" className="text-[10px] w-fit border-emerald-500/30 text-emerald-700 bg-emerald-50/50">
                                                    {row.brand}
                                                </Badge>
                                                <span className="text-[9px] text-muted-foreground ml-1">{row.series || '-'}</span>
                                            </div>
                                        ) : (
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 w-full text-[10px] border-destructive/50 text-destructive bg-destructive/5 hover:bg-destructive/10"
                                                    >
                                                        {row.brand || '未設定品牌'} ⚠️
                                                    </Button>
                                                </PopoverTrigger>
                                                <PopoverContent className="p-0 w-[200px]" align="start">
                                                    <Command>
                                                        <CommandInput placeholder="搜尋品牌..." />
                                                        <CommandList>
                                                            <CommandEmpty>找不到品牌</CommandEmpty>
                                                            <CommandGroup>
                                                                {allBrands.map((b) => (
                                                                    <CommandItem
                                                                        key={b.id}
                                                                        onSelect={() => {
                                                                            onUpdate(index, 'brand', b.name);
                                                                            onUpdate(index, 'brand_id', b.id);
                                                                        }}
                                                                        className="text-xs"
                                                                    >
                                                                        <Check className={cn("mr-2 h-3 w-3", row.brand_id === b.id ? "opacity-100" : "opacity-0")} />
                                                                        {b.name}
                                                                    </CommandItem>
                                                                ))}
                                                            </CommandGroup>
                                                        </CommandList>
                                                    </Command>
                                                </PopoverContent>
                                            </Popover>
                                        )}
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
                                        <div className="flex flex-col items-end gap-1">
                                            <div className="flex gap-1 items-center justify-end">
                                                <Input
                                                    type="number"
                                                    value={row.is_variant ? (row.variant_wholesale_price ?? row.base_wholesale_price) : row.base_wholesale_price}
                                                    onChange={(e) => onUpdate(index, row.is_variant ? 'variant_wholesale_price' : 'base_wholesale_price', parseFloat(e.target.value) || 0)}
                                                    className={cn(
                                                        "h-7 w-16 text-[10px] text-right p-1 border-dotted border-b border-t-0 border-x-0 rounded-none bg-transparent",
                                                        (row.diff?.includes('批發價') || row.diff?.includes('變體批發價')) && "bg-amber-500/20 text-amber-900"
                                                    )}
                                                />
                                                <span className="text-muted-foreground">/</span>
                                                <Input
                                                    type="number"
                                                    value={row.is_variant ? (row.variant_retail_price ?? row.base_retail_price) : row.base_retail_price}
                                                    onChange={(e) => onUpdate(index, row.is_variant ? 'variant_retail_price' : 'base_retail_price', parseFloat(e.target.value) || 0)}
                                                    className={cn(
                                                        "h-7 w-16 text-[10px] text-right p-1 border-dotted border-b border-t-0 border-x-0 rounded-none bg-transparent font-bold",
                                                        (row.diff?.includes('零售價') || row.diff?.includes('變體零售價')) && "bg-amber-500/20 text-amber-900"
                                                    )}
                                                />
                                            </div>
                                            <span className="text-[8px] text-muted-foreground/60 scale-90 origin-right">
                                                {row.is_variant ? '變體價格' : '主商品價格'}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="space-y-1">
                                            <div
                                                className="text-[9px] font-medium text-muted-foreground truncate max-w-[120px]"
                                                title={formatSpecValue(row.table_settings)}
                                            >
                                                {row.table_settings ? formatSpecValue(row.table_settings) : '-'}
                                            </div>
                                            <div
                                                className="text-[8px] text-primary/70 opacity-80 truncate max-w-[120px]"
                                                title={formatSpecValue(row.variant_table_settings)}
                                            >
                                                {row.variant_table_settings ? formatSpecValue(row.variant_table_settings) : ''}
                                            </div>
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
                                        {row.is_variant ? (() => {
                                            const matchedColor = allColors.find(c =>
                                                c.name.trim().toLowerCase() === (row.option_3 || '').trim().toLowerCase()
                                            );

                                            return (
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <div className={cn(
                                                            "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted/50 transition-all border",
                                                            row.is_variant && row.option_3 && !matchedColor
                                                                ? "bg-destructive/10 border-destructive/20 text-destructive"
                                                                : "border-transparent bg-muted/30"
                                                        )}>
                                                            {matchedColor ? (
                                                                <div
                                                                    className="w-3 h-3 rounded-full border border-black/10 shadow-sm shrink-0"
                                                                    style={{ backgroundColor: matchedColor.hex_code || '#808080' }}
                                                                />
                                                            ) : (
                                                                <div className="w-3 h-3 rounded-full border border-dashed border-muted-foreground/50 shrink-0" />
                                                            )}
                                                            <span className={cn(
                                                                "text-[10px] font-medium truncate",
                                                                !row.option_3 && "text-muted-foreground italic font-normal"
                                                            )}>
                                                                {row.option_3 || '點擊設定'}
                                                            </span>
                                                        </div>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="p-0 w-[240px]" align="start">
                                                        {addingColorForIndex === index ? (
                                                            <div className="p-3 space-y-3 bg-background">
                                                                <div className="flex items-center justify-between border-b pb-2 mb-2">
                                                                    <h4 className="text-xs font-bold">新增顏色</h4>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-5 w-5"
                                                                        onClick={() => setAddingColorForIndex(null)}
                                                                    >
                                                                        <X className="h-3 w-3" />
                                                                    </Button>
                                                                </div>
                                                                <div className="space-y-2">
                                                                    <div className="space-y-1">
                                                                        <label className="text-[10px] text-muted-foreground">顏色名稱</label>
                                                                        <Input
                                                                            value={newColorForm.name}
                                                                            onChange={e => setNewColorForm({ ...newColorForm, name: e.target.value })}
                                                                            placeholder="例如：奶茶色"
                                                                            className="h-8 text-xs"
                                                                        />
                                                                    </div>
                                                                    <div className="space-y-1">
                                                                        <label className="text-[10px] text-muted-foreground">顏色代碼 (SKU 用)</label>
                                                                        <Input
                                                                            value={newColorForm.code}
                                                                            onChange={e => setNewColorForm({ ...newColorForm, code: e.target.value.toUpperCase() })}
                                                                            placeholder="例如：MC"
                                                                            className="h-8 text-xs font-mono"
                                                                        />
                                                                    </div>
                                                                    <div className="space-y-1">
                                                                        <label className="text-[10px] text-muted-foreground">色標</label>
                                                                        <div className="flex gap-2">
                                                                            <input
                                                                                type="color"
                                                                                value={newColorForm.hex_code}
                                                                                onChange={e => setNewColorForm({ ...newColorForm, hex_code: e.target.value })}
                                                                                className="w-8 h-8 p-0 border-none bg-transparent cursor-pointer"
                                                                            />
                                                                            <Input
                                                                                value={newColorForm.hex_code}
                                                                                onChange={e => setNewColorForm({ ...newColorForm, hex_code: e.target.value })}
                                                                                className="h-8 text-[10px] font-mono flex-1 uppercase"
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex gap-2 pt-2">
                                                                    <Button
                                                                        className="flex-1 h-8 text-xs"
                                                                        onClick={async () => {
                                                                            if (!newColorForm.name || !newColorForm.code) {
                                                                                toast.error('名稱與代碼為必填');
                                                                                return;
                                                                            }
                                                                            try {
                                                                                const res = await addColor({
                                                                                    name: newColorForm.name,
                                                                                    code: newColorForm.code,
                                                                                    hex_code: newColorForm.hex_code,
                                                                                    sort_order: allColors.length
                                                                                });
                                                                                if (res) {
                                                                                    onUpdate(index, 'option_3', (res as any).name);
                                                                                    setAddingColorForIndex(null);
                                                                                    toast.success(`已建立顏色：${newColorForm.name}`);
                                                                                }
                                                                            } catch (err) {
                                                                                toast.error('建立失敗，名稱或代碼可能重複');
                                                                            }
                                                                        }}
                                                                    >
                                                                        建立並套用
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <Command>
                                                                <CommandInput
                                                                    placeholder="搜尋或輸入..."
                                                                    className="h-9 text-xs"
                                                                    value={searchQuery}
                                                                    onValueChange={setSearchQuery}
                                                                />
                                                                <CommandList className="max-h-[300px]">
                                                                    <CommandGroup heading="快速操作">
                                                                        <CommandItem
                                                                            onSelect={() => {
                                                                                const initialName = searchQuery || row.option_3 || '';
                                                                                setNewColorForm({
                                                                                    name: initialName,
                                                                                    code: initialName.substring(0, 2).toUpperCase(),
                                                                                    hex_code: '#808080'
                                                                                });
                                                                                setAddingColorForIndex(index);
                                                                            }}
                                                                            className="flex items-center gap-2 py-2 cursor-pointer text-primary"
                                                                        >
                                                                            <Plus className="h-3.5 w-3.5" />
                                                                            <span className="text-xs">建立新顏色 {searchQuery ? `"${searchQuery}"` : ''}</span>
                                                                        </CommandItem>
                                                                    </CommandGroup>

                                                                    <CommandEmpty className="py-3 text-xs text-center text-muted-foreground">
                                                                        找不到顏色，請點擊上方建立。
                                                                    </CommandEmpty>

                                                                    <CommandGroup heading="現有顏色庫">
                                                                        {allColors.map((c) => (
                                                                            <CommandItem
                                                                                key={c.id}
                                                                                onSelect={() => {
                                                                                    onUpdate(index, 'option_3', c.name);
                                                                                    setSearchQuery('');
                                                                                }}
                                                                                className="flex items-center gap-2 py-2 cursor-pointer"
                                                                            >
                                                                                <div
                                                                                    className="w-3.5 h-3.5 rounded-full border border-black/10 shrink-0"
                                                                                    style={{ backgroundColor: c.hex_code || '#808080' }}
                                                                                />
                                                                                <div className="flex flex-col flex-1 min-w-0">
                                                                                    <span className="text-xs font-medium truncate">{c.name}</span>
                                                                                    <span className="text-[10px] text-muted-foreground uppercase">{c.code}</span>
                                                                                </div>
                                                                                {(row.option_3 || '').trim().toLowerCase() === c.name.trim().toLowerCase() && <Check className="h-3.5 w-3.5 text-primary" />}
                                                                            </CommandItem>
                                                                        ))}
                                                                    </CommandGroup>
                                                                </CommandList>
                                                            </Command>
                                                        )}
                                                    </PopoverContent>
                                                </Popover>
                                            );
                                        })() : (
                                            <span className="text-[10px] text-muted-foreground/30 pl-2">-</span>
                                        )}
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
                                            <div className="flex gap-1 flex-wrap">
                                                {[row.option_1, row.option_2, row.option_3].filter(Boolean).map((opt, i) => (
                                                    <Badge key={i} variant="outline" className="text-[8px] px-1 h-3 opacity-60">
                                                        {opt}
                                                    </Badge>
                                                ))}
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
