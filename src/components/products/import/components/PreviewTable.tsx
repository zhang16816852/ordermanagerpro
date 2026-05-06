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
import { useDeviceModelStore } from '@/store/useDeviceModelStore';
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
    const { 
        models: allDeviceModels, 
        brands: allDeviceBrands, 
        groups: allDeviceGroups,
        addModel, 
        fetchData: fetchDeviceData 
    } = useDeviceModelStore();
    const [searchQuery, setSearchQuery] = useState('');

    // 顏色新增表單狀態
    const [addingColorForIndex, setAddingColorForIndex] = useState<number | null>(null);
    const [newColorForm, setNewColorForm] = useState({ name: '', code: '', hex_code: '#808080' });

    // 裝置型號新增表單狀態
    const [addingModelForIndex, setAddingModelForIndex] = useState<number | null>(null);
    const [newModelForm, setNewModelForm] = useState({ name: '', brand_id: '', device_series: '', device_type: 'smartphone' });
    console.log("匯入產品資料", data)
    React.useEffect(() => {
        fetchColors();
        fetchDeviceData();
    }, []);

    const renderDeviceModels = (value: string | undefined, isVariant: boolean = false) => {
        if (!value) return <span className="text-[10px] text-muted-foreground/50 pl-1 italic">設定型號</span>;
        
        const models = value.split(',').map(s => s.trim()).filter(Boolean);
        const displayLimit = 2;
        
        return (
            <div className="flex flex-wrap gap-1">
                {models.slice(0, displayLimit).map((part, i) => {
                    let type: 'group' | 'model' | 'exclude' = 'model';
                    let name = part;
                    let exists = false;

                    if (part.startsWith('group:')) {
                        type = 'group';
                        name = part.replace('group:', '');
                        exists = allDeviceGroups.some(g => g.name.toLowerCase() === name.toLowerCase());
                    } else if (part.startsWith('exclude:')) {
                        type = 'exclude';
                        name = part.replace('exclude:', '');
                        exists = allDeviceModels.some(m => m.name.toLowerCase() === name.toLowerCase());
                    } else if (part.startsWith('model:')) {
                        type = 'model';
                        name = part.replace('model:', '');
                        exists = allDeviceModels.some(m => m.name.toLowerCase() === name.toLowerCase());
                    } else {
                        exists = allDeviceModels.some(m => m.name.toLowerCase() === name.toLowerCase());
                    }

                    return (
                        <Badge
                            key={i}
                            variant={exists ? "secondary" : "destructive"}
                            className={cn(
                                "text-[9px] px-1 h-4 whitespace-nowrap",
                                type === 'group' && "bg-blue-100 text-blue-700 border-blue-200",
                                type === 'exclude' && "bg-rose-50 text-rose-600 border-rose-200 line-through opacity-70",
                                isVariant && type === 'model' && "bg-indigo-100 text-indigo-700 border-indigo-200"
                            )}
                        >
                            {type === 'group' && <Plus className="h-2 w-2 mr-0.5 inline" />}
                            {type === 'exclude' && <X className="h-2 w-2 mr-0.5 inline" />}
                            {name}
                        </Badge>
                    );
                })}
                {models.length > displayLimit && (
                    <Badge variant="outline" className="text-[9px] px-1 h-4 bg-background/50 border-dashed">
                        +{models.length - displayLimit}
                    </Badge>
                )}
            </div>
        );
    };

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
                                <TableHead className="w-[60px] text-center">狀態</TableHead>
                                <TableHead className="w-[100px]">變動內容</TableHead>
                                <TableHead className="w-[120px]">主產品 SKU</TableHead>
                                <TableHead className="w-[160px]">產品名稱</TableHead>
                                <TableHead className="w-[100px]">一般型號</TableHead>
                                <TableHead className="w-[110px]">適用型號 (主產品)</TableHead>
                                <TableHead className="w-[110px]">適用型號 (變體)</TableHead>
                                <TableHead className="w-[90px]">品牌</TableHead>
                                <TableHead className="w-[90px]">分類</TableHead>
                                <TableHead className="w-[150px] text-right">批發 / 零售</TableHead>
                                <TableHead className="w-[140px]">產品 / 變體規格</TableHead>
                                <TableHead className="w-[120px]">變體 SKU</TableHead>
                                <TableHead className="w-[90px]">顏色</TableHead>
                                <TableHead className="w-[120px]">其他選項</TableHead>
                                <TableHead className="w-[60px] text-center">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {data.map((row, index) => (
                                <TableRow key={index} className={!row.isValid ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-muted/50'}>
                                    <TableCell className="text-center px-1">
                                        {row.isValid ? (
                                            <div className="flex flex-col items-center gap-0.5">
                                                {row.action === 'create' ? (
                                                    <Badge className="text-[9px] px-1 h-3.5 bg-emerald-500 hover:bg-emerald-600 scale-90">新增</Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-[9px] px-1 h-3.5 border-amber-500 text-amber-600 bg-amber-50 scale-90">
                                                        更新
                                                    </Badge>
                                                )}
                                                <Badge variant="secondary" className={cn(
                                                    "text-[8px] px-1 h-3.5 scale-90",
                                                    row.is_variant ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-slate-50 text-slate-600 border-slate-200"
                                                )}>
                                                    {row.is_variant ? '變體' : '主商品'}
                                                </Badge>
                                            </div>
                                        ) : (
                                            <div className="bg-destructive/10 p-1 rounded-full inline-block">
                                                <AlertCircle className="h-3 w-3 text-destructive" />
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell className="px-1">
                                        {row.action === 'update' && row.diff && row.diff.length > 0 ? (
                                            <div className="flex flex-wrap gap-0.5 max-w-[90px]">
                                                {row.diff.map(field => (
                                                    <Badge key={field} variant="outline" className="text-[8px] px-1 h-3 bg-amber-500/5 border-amber-500/20 text-amber-700 whitespace-nowrap">
                                                        {field}
                                                    </Badge>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-[9px] text-muted-foreground/30 pl-2">-</span>
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
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <div className={cn(
                                                        "flex flex-wrap items-center gap-1 p-1 rounded-md cursor-pointer hover:bg-muted/50 transition-all border min-h-[32px]",
                                                        "border-transparent bg-muted/30"
                                                    )}>
                                                        {renderDeviceModels(row.device_models)}
                                                    </div>
                                                </PopoverTrigger>
                                                <PopoverContent className="p-0 w-[260px]" align="start" onWheel={(e) => e.stopPropagation()}>
                                                    {addingModelForIndex === index ? (
                                                        <div className="p-3 space-y-3 bg-background">
                                                            <div className="flex items-center justify-between border-b pb-2">
                                                                <h4 className="text-xs font-bold text-primary">新增裝置型號</h4>
                                                                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setAddingModelForIndex(null)}>
                                                                    <X className="h-3 w-3" />
                                                                </Button>
                                                            </div>
                                                            <div className="space-y-2">
                                                                <div className="space-y-1">
                                                                    <label className="text-[10px] text-muted-foreground">裝置名稱</label>
                                                                    <Input
                                                                        value={newModelForm.name}
                                                                        onChange={e => setNewModelForm({ ...newModelForm, name: e.target.value })}
                                                                        placeholder="例：iPhone 15 Pro"
                                                                        className="h-8 text-xs"
                                                                    />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <label className="text-[10px] text-muted-foreground">所屬品牌</label>
                                                                    <Select
                                                                        value={newModelForm.brand_id}
                                                                        onValueChange={v => setNewModelForm({ ...newModelForm, brand_id: v })}
                                                                    >
                                                                        <SelectTrigger className="h-8 text-xs">
                                                                            <SelectValue placeholder="選擇品牌" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {allDeviceBrands.map(b => (
                                                                                <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                            </div>
                                                            <Button
                                                                className="w-full h-8 text-xs"
                                                                onClick={async () => {
                                                                    if (!newModelForm.name || !newModelForm.brand_id) {
                                                                        toast.error('名稱與品牌為必填');
                                                                        return;
                                                                    }
                                                                    const res = await addModel(newModelForm);
                                                                    if (res) {
                                                                        const current = row.device_models ? row.device_models.split(',').map(s => s.trim()) : [];
                                                                        if (!current.includes(res.name)) {
                                                                            onUpdate(index, 'device_models', [...current, res.name].join(', '));
                                                                        }
                                                                        setAddingModelForIndex(null);
                                                                        toast.success(`已建立並套用：${res.name}`);
                                                                    }
                                                                }}
                                                            >
                                                                建立並套用
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <Command>
                                                            <CommandInput placeholder="搜尋型號..." className="h-9 text-xs" />
                                                            <CommandList className="max-h-[300px] overflow-y-auto">
                                                                <CommandGroup heading="快速操作">
                                                                    <CommandItem
                                                                        onSelect={() => {
                                                                            setNewModelForm({ name: searchQuery, brand_id: '', device_series: '', device_type: 'smartphone' });
                                                                            setAddingModelForIndex(index);
                                                                        }}
                                                                        className="flex items-center gap-2 py-2 cursor-pointer text-primary"
                                                                    >
                                                                        <Plus className="h-3.5 w-3.5" />
                                                                        <span className="text-xs">建立新型號 {searchQuery ? `"${searchQuery}"` : ''}</span>
                                                                    </CommandItem>
                                                                </CommandGroup>
                                                                <CommandEmpty className="py-3 text-xs text-center text-muted-foreground">
                                                                    找不到型號
                                                                </CommandEmpty>
                                                                 <CommandGroup heading="型號群組">
                                                                    {allDeviceGroups.map((g) => {
                                                                        const isSelected = row.device_models?.split(',').map(s => s.trim().toLowerCase()).includes(`group:${g.name.toLowerCase()}`);
                                                                        return (
                                                                            <CommandItem
                                                                                key={`group-${g.id}`}
                                                                                onSelect={() => {
                                                                                    const current = row.device_models ? row.device_models.split(',').map(s => s.trim()) : [];
                                                                                    const groupValue = `group:${g.name}`;
                                                                                    let next;
                                                                                    if (isSelected) {
                                                                                        next = current.filter(s => s.toLowerCase() !== groupValue.toLowerCase());
                                                                                    } else {
                                                                                        next = [...current, groupValue];
                                                                                    }
                                                                                    onUpdate(index, 'device_models', next.join(', '));
                                                                                }}
                                                                                className={cn(
                                                                                    "flex items-center gap-2 py-2 cursor-pointer",
                                                                                    isSelected && "bg-blue-50 text-blue-700 font-medium"
                                                                                )}
                                                                            >
                                                                                <div className="flex flex-col flex-1 min-w-0">
                                                                                    <span className="text-xs font-medium truncate">{g.name}</span>
                                                                                    <span className="text-[9px] text-muted-foreground">群組</span>
                                                                                </div>
                                                                                {isSelected && <Check className="h-3.5 w-3.5 text-blue-600" />}
                                                                            </CommandItem>
                                                                        );
                                                                    })}
                                                                </CommandGroup>
                                                                 <CommandGroup heading="現有型號庫">
                                                                    {[...allDeviceModels].sort((a, b) => {
                                                                        const aSel = row.device_models?.split(',').map(s => s.trim().toLowerCase()).includes(a.name.toLowerCase());
                                                                        const bSel = row.device_models?.split(',').map(s => s.trim().toLowerCase()).includes(b.name.toLowerCase());
                                                                        if (aSel && !bSel) return -1;
                                                                        if (!aSel && bSel) return 1;
                                                                        return a.name.localeCompare(b.name);
                                                                    }).map((m) => {
                                                                        const isSelected = row.device_models?.split(',').map(s => s.trim().toLowerCase()).includes(m.name.toLowerCase());
                                                                        return (
                                                                            <CommandItem
                                                                                key={m.id}
                                                                                onSelect={() => {
                                                                                    const current = row.device_models ? row.device_models.split(',').map(s => s.trim()) : [];
                                                                                    let next;
                                                                                    if (isSelected) {
                                                                                        next = current.filter(s => s.toLowerCase() !== m.name.toLowerCase());
                                                                                    } else {
                                                                                        next = [...current, m.name];
                                                                                    }
                                                                                    onUpdate(index, 'device_models', next.join(', '));
                                                                                }}
                                                                                className={cn(
                                                                                    "flex items-center gap-2 py-2 cursor-pointer",
                                                                                    isSelected && "bg-primary/5 text-primary font-medium"
                                                                                )}
                                                                            >
                                                                                <div className="flex flex-col flex-1 min-w-0">
                                                                                    <span className="text-xs font-medium truncate">{m.name}</span>
                                                                                    <span className="text-[9px] text-muted-foreground truncate">
                                                                                        {allDeviceBrands.find(b => b.id === m.brand_id)?.name} {m.device_series ? `· ${m.device_series}` : ''}
                                                                                    </span>
                                                                                </div>
                                                                                {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                                                                            </CommandItem>
                                                                        );
                                                                    })}
                                                                </CommandGroup>
                                                            </CommandList>
                                                        </Command>
                                                    )}
                                                </PopoverContent>
                                            </Popover>
                                        </div>
                                    </TableCell>

                                    {/* 變體型號 */}
                                    <TableCell>
                                        <div className="flex flex-col gap-1">
                                            {row.is_variant ? (
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <div className={cn(
                                                            "flex flex-wrap items-center gap-1 p-1 rounded-md cursor-pointer hover:bg-muted/50 transition-all border min-h-[32px]",
                                                            "border-transparent bg-indigo-50/30"
                                                        )}>
                                                            {renderDeviceModels(row.variant_device_models, true)}
                                                        </div>
                                                    </PopoverTrigger>
                                                            <PopoverContent className="p-0 w-[260px]" align="start" onWheel={(e) => e.stopPropagation()}>
                                                                <Command>
                                                                    <CommandInput placeholder="搜尋型號..." className="h-9 text-xs" />
                                                                    <CommandList className="max-h-[300px] overflow-y-auto">
                                                                        <CommandEmpty className="py-3 text-xs text-center text-muted-foreground">
                                                                            找不到型號
                                                                        </CommandEmpty>
                                                                        <CommandGroup heading="型號群組">
                                                                            {allDeviceGroups.map((g) => {
                                                                                const isSelected = row.variant_device_models?.split(',').map(s => s.trim().toLowerCase()).includes(`group:${g.name.toLowerCase()}`);
                                                                                return (
                                                                                    <CommandItem
                                                                                        key={`vgroup-${g.id}`}
                                                                                        onSelect={() => {
                                                                                            const current = row.variant_device_models ? row.variant_device_models.split(',').map(s => s.trim()) : [];
                                                                                            const groupValue = `group:${g.name}`;
                                                                                            let next;
                                                                                            if (isSelected) {
                                                                                                next = current.filter(s => s.toLowerCase() !== groupValue.toLowerCase());
                                                                                            } else {
                                                                                                next = [...current, groupValue];
                                                                                            }
                                                                                            onUpdate(index, 'variant_device_models', next.join(', '));
                                                                                        }}
                                                                                        className={cn(
                                                                                            "flex items-center gap-2 py-2 cursor-pointer",
                                                                                            isSelected && "bg-blue-50 text-blue-700 font-medium"
                                                                                        )}
                                                                                    >
                                                                                        <div className="flex flex-col flex-1 min-w-0">
                                                                                            <span className="text-xs font-medium truncate">{g.name}</span>
                                                                                            <span className="text-[9px] text-muted-foreground">群組</span>
                                                                                        </div>
                                                                                        {isSelected && <Check className="h-3.5 w-3.5 text-blue-600" />}
                                                                                    </CommandItem>
                                                                                );
                                                                            })}
                                                                        </CommandGroup>
                                                                        <CommandGroup heading="現有型號庫">
                                                                    {[...allDeviceModels].sort((a, b) => {
                                                                        const aSel = row.variant_device_models?.split(',').map(s => s.trim().toLowerCase()).includes(a.name.toLowerCase());
                                                                        const bSel = row.variant_device_models?.split(',').map(s => s.trim().toLowerCase()).includes(b.name.toLowerCase());
                                                                        if (aSel && !bSel) return -1;
                                                                        if (!aSel && bSel) return 1;
                                                                        return a.name.localeCompare(b.name);
                                                                    }).map((m) => {
                                                                        const isSelected = row.variant_device_models?.split(',').map(s => s.trim().toLowerCase()).includes(m.name.toLowerCase());
                                                                        return (
                                                                            <CommandItem
                                                                                key={m.id}
                                                                                onSelect={() => {
                                                                                    const current = row.variant_device_models ? row.variant_device_models.split(',').map(s => s.trim()) : [];
                                                                                    let next;
                                                                                    if (isSelected) {
                                                                                        next = current.filter(s => s.toLowerCase() !== m.name.toLowerCase());
                                                                                    } else {
                                                                                        next = [...current, m.name];
                                                                                    }
                                                                                    onUpdate(index, 'variant_device_models', next.join(', '));
                                                                                }}
                                                                                className={cn(
                                                                                    "flex items-center gap-2 py-2 cursor-pointer",
                                                                                    isSelected && "bg-indigo-50 text-indigo-700 font-medium"
                                                                                )}
                                                                            >
                                                                                <div className="flex flex-col flex-1 min-w-0">
                                                                                    <span className="text-xs font-medium truncate">{m.name}</span>
                                                                                </div>
                                                                                {isSelected && <Check className="h-3.5 w-3.5 text-indigo-600" />}
                                                                            </CommandItem>
                                                                        );
                                                                    })}
                                                                </CommandGroup>
                                                            </CommandList>
                                                        </Command>
                                                    </PopoverContent>
                                                </Popover>
                                            ) : (
                                                <span className="text-[9px] text-muted-foreground/20 italic pl-2">-</span>
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
                                                <PopoverContent className="p-0 w-[200px]" align="start" onWheel={(e) => e.stopPropagation()}>
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
                                    <TableCell className="px-1">
                                        <div className="flex flex-col items-end gap-0.5">
                                            <div className="flex gap-1 items-center justify-end">
                                                <div className="flex flex-col items-end">
                                                    <span className="text-[7px] text-muted-foreground/50 leading-none">批發</span>
                                                    <Input
                                                        type="number"
                                                        value={row.is_variant ? (row.variant_wholesale_price ?? row.base_wholesale_price) : row.base_wholesale_price}
                                                        onChange={(e) => onUpdate(index, row.is_variant ? 'variant_wholesale_price' : 'base_wholesale_price', parseFloat(e.target.value) || 0)}
                                                        className={cn(
                                                            "h-6 w-14 text-[10px] text-right p-1 border-dotted border-b border-t-0 border-x-0 rounded-none bg-transparent",
                                                            (row.diff?.includes('批發價') || row.diff?.includes('變體批發價')) && "bg-amber-500/20 text-amber-900"
                                                        )}
                                                    />
                                                </div>
                                                <div className="flex flex-col items-end border-l pl-1 ml-1 border-muted/30">
                                                    <span className="text-[7px] text-muted-foreground/50 leading-none">零售</span>
                                                    <Input
                                                        type="number"
                                                        value={row.is_variant ? (row.variant_retail_price ?? row.base_retail_price) : row.base_retail_price}
                                                        onChange={(e) => onUpdate(index, row.is_variant ? 'variant_retail_price' : 'base_retail_price', parseFloat(e.target.value) || 0)}
                                                        className={cn(
                                                            "h-6 w-14 text-[10px] text-right p-1 border-dotted border-b border-t-0 border-x-0 rounded-none bg-transparent font-bold",
                                                            (row.diff?.includes('零售價') || row.diff?.includes('變體零售價')) && "bg-amber-500/20 text-amber-900"
                                                        )}
                                                    />
                                                </div>
                                            </div>
                                            <span className="text-[7px] text-muted-foreground/40 italic">
                                                {row.is_variant ? '變體定義' : '主商品定價'}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="px-1">
                                        <div className="flex flex-col gap-0.5 max-w-[130px]">
                                            <div
                                                className="text-[9px] font-medium text-muted-foreground truncate"
                                                title={row._specs ? Object.entries(row._specs).map(([id, val]) => `${id}: ${val}`).join(', ') : (row.table_settings ? formatSpecValue(row.table_settings) : '-')}
                                            >
                                                {row._specs && Object.keys(row._specs).length > 0 
                                                    ? Object.entries(row._specs).map(([id, val]) => `${id}: ${val}`).join(', ') 
                                                    : (row.table_settings ? formatSpecValue(row.table_settings) : '-')}
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
                                                    <PopoverContent className="p-0 w-[240px]" align="start" onWheel={(e) => e.stopPropagation()}>
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
                                                                <CommandList className="max-h-[300px] overflow-y-auto">
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
