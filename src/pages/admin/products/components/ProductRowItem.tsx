import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MoreHorizontal, Pencil, Copy, Trash2, ChevronRight, ChevronDown, Layers, Database, AlertCircle, CheckCircle2 } from 'lucide-react';
import { calculatePriceRange } from '@/utils/priceUtils';
import { Tables } from '@/integrations/supabase/types';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

type Product = Tables<'products'>;

// 判斷規格資料格式 (用於管理員辨識)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getSpecFormatInfo(specValues: any, hasSyncedToNewTable?: boolean): {
    label: string;
    color: string;
    icon: 'new' | 'legacy' | 'empty';
    tip: string;
} {
    // 已同步至新表 product_spec_values
    if (hasSyncedToNewTable) {
        return { label: '新格式', color: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: 'new', tip: '規格已同步至新版關聯資料表' };
    }
    if (!specValues) {
        return { label: '無規格', color: 'text-slate-400 bg-slate-50 border-slate-200', icon: 'empty', tip: '此產品/變體尚未設定規格' };
    }
    
    // v6 格式是字典物件且包含 ":" 路徑 key
    if (typeof specValues === 'object' && !Array.isArray(specValues)) {
        const keys = Object.keys(specValues).filter(k => k !== '_metadata');
        if (keys.length === 0) {
            return { label: '無規格', color: 'text-slate-400 bg-slate-50 border-slate-200', icon: 'empty', tip: '規格為空' };
        }
        const isV6 = keys.some(k => k.includes(':'));
        if (isV6) {
            return { label: '新格式', color: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: 'new', tip: '規格已符合 v6 標準' };
        }
        return { label: '待遷移', color: 'text-amber-600 bg-amber-50 border-amber-200', icon: 'legacy', tip: '規格使用舊版物件格式，重新儲存即可自動升級' };
    }

    if (Array.isArray(specValues)) {
        return { label: '舊格式', color: 'text-amber-600 bg-amber-50 border-amber-200', icon: 'legacy', tip: '規格仍為舊版陣列格式' };
    }

    return { label: '未知', color: 'text-slate-400 bg-slate-50 border-slate-200', icon: 'empty', tip: '格式不明' };
}

function SpecFormatBadge({ specValues, hasSynced }: { specValues: any; hasSynced?: boolean }) {
    const info = getSpecFormatInfo(specValues, hasSynced);
    if (info.icon === 'empty') return null;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1 h-4 rounded border cursor-help ${info.color}`}>
                    {info.icon === 'new'
                        ? <CheckCircle2 className="h-2.5 w-2.5" />
                        : <AlertCircle className="h-2.5 w-2.5" />}
                    {info.label}
                </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-[200px]">
                {info.tip}
            </TooltipContent>
        </Tooltip>
    );
}

interface ProductRowItemProps {
    product: Product;
    brandMap: Record<string, string>;
    variants: any[];
    models: string[];
    modelGroups: string[];
    isExpanded: boolean;
    isSelected: boolean;
    onToggleExpand: () => void;
    onToggleSelect: () => void;
    onEdit: (p: Product) => void;
    onCopy: (p: Product) => void;
    onDelete: (p: Product) => void;
    onUpdateVariant: (id: string, updates: any) => void;
}

const STATUS_LABELS: Record<string, string> = {
    active: '上架中',
    discontinued: '已停售',
    preorder: '預購中',
    sold_out: '售完停產',
};

const STATUS_VARIANTS: Record<string, string> = {
    active: 'bg-success text-success-foreground',
    preorder: 'bg-blue-500 text-white',
    sold_out: 'bg-orange-500 text-white',
    discontinued: '',
};

export function ProductRowItem({
    product,
    brandMap,
    variants,
    models,
    modelGroups,
    isExpanded,
    isSelected,
    onToggleExpand,
    onToggleSelect,
    onEdit,
    onCopy,
    onDelete,
    onUpdateVariant
}: ProductRowItemProps) {
    const hasVariants = product.has_variants && variants.length > 0;
    
    const displayBrand = (product as any).primary_brand_name || ((product as any).brand_ids?.length > 0 ? (product as any).brand_ids.map((id: string) => brandMap[id]).filter(Boolean).join(', ') : null) || '-';

    return (
        <Collapsible open={isExpanded} onOpenChange={onToggleExpand} asChild>
            <>
                <TableRow className={`hover:bg-muted/30 transition-colors ${isSelected ? 'bg-muted/50' : ''}`}>
                    <TableCell className="w-[40px]">
                        <Checkbox
                            checked={isSelected}
                            onCheckedChange={onToggleSelect}
                            aria-label="Select row"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </TableCell>
                    <TableCell>
                        {hasVariants && (
                            <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </Button>
                            </CollapsibleTrigger>
                        )}
                    </TableCell>
                    <TableCell className="font-medium">
                        <div className="flex items-center gap-2 flex-wrap">
                            {product.name}
                            {hasVariants && (
                                <Badge variant="outline" className="ml-2 text-[10px] h-5">
                                    <Layers className="h-3 w-3 mr-1" />
                                    {variants.length} 變體
                                </Badge>
                            )}
                            {/* 規格格式標記 (管理員用) */}
                            {!hasVariants && (
                                <TooltipProvider>
                                    <SpecFormatBadge specValues={(product as any).spec_values} />
                                </TooltipProvider>
                            )}
                        </div>
                    </TableCell>
                    <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-[150px]">
                            {(product as any).category_names?.length > 0 ? (
                                (product as any).category_names.map((name: string, idx: number) => (
                                    <Badge key={`${product.id}-cat-${idx}`} variant="outline" className="text-[10px] px-1 h-5">
                                        {name}
                                    </Badge>
                                ))
                            ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                            )}
                        </div>
                    </TableCell>
                    <TableCell className="text-xs">
                        <div className="flex flex-col gap-1 max-w-[150px]">
                            <div className="flex items-center flex-wrap">
                                <span className="text-muted-foreground font-mono truncate" title={displayBrand}>{displayBrand}</span>
                                <span className="mx-1 text-slate-300">/</span>
                                <span className="text-slate-500 truncate">{product.model || '-'}</span>
                            </div>
                            {models.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {models.map((model, idx) => (
                                        <Badge key={`${product.id}-model-${idx}`} variant="secondary" className="text-[9px] px-1 h-4 bg-amber-100 text-amber-800 hover:bg-amber-100/80 border-transparent">
                                            {model}
                                        </Badge>
                                    ))}
                                </div>
                            )}
                            {modelGroups.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {modelGroups.map((name, idx) => (
                                        <Badge key={`${product.id}-group-${idx}`} variant="secondary" className="text-[9px] px-1 h-4 bg-blue-100 text-blue-800 hover:bg-blue-100/80 border-transparent">
                                            {name}
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </div>
                    </TableCell>
                    <TableCell className="text-right">
                        <div className="text-sm font-bold">
                            {calculatePriceRange(product.base_wholesale_price, variants.map(v => v.wholesale_price)).display}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                            {calculatePriceRange(product.base_retail_price, variants.map(v => v.retail_price)).display}
                        </div>
                    </TableCell>
                    <TableCell>
                        <Badge
                            variant="outline"
                            className={`${STATUS_VARIANTS[product.status] || ''} border-none font-normal text-xs`}
                        >
                            {STATUS_LABELS[product.status] || product.status}
                        </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-32">
                                <DropdownMenuItem onClick={() => onEdit(product)}>
                                    <Pencil className="mr-2 h-4 w-4" /> 編輯詳情
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onCopy(product)}>
                                    <Copy className="mr-2 h-4 w-4" /> 複製產品
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-destructive" onClick={() => onDelete(product)}>
                                    <Trash2 className="mr-2 h-4 w-4" /> 刪除產品
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </TableCell>
                </TableRow>

                {hasVariants && (
                    <CollapsibleContent asChild>
                        <TableRow className="bg-muted/5 hover:bg-muted/10 border-t-0">
                            <TableCell colSpan={8} className="p-0">
                                <div className="py-2 px-4 pl-14">
                                    <Table>
                                        <TableHeader className="bg-transparent border-b">
                                            <TableRow className="hover:bg-transparent border-none">
                                                <TableHead className="h-8 text-[11px]">變體名稱</TableHead>
                                                <TableHead className="h-8 text-[11px]">規格</TableHead>
                                                <TableHead className="h-8 text-[11px] text-right">狀態</TableHead>
                                                <TableHead className="h-8 text-[11px] text-right">批發價</TableHead>
                                                <TableHead className="h-8 text-[11px] text-right">零售價</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {variants.map((v) => (
                                                <TableRow key={v.id} className="hover:bg-background border-none">
                                                    <TableCell className="py-1 text-xs font-medium">{v.name}</TableCell>
                                                    <TableCell className="py-1 text-[10px] text-muted-foreground">
                                                        <div className="flex items-center gap-1.5">
                                                            <span>{[v.option_1, v.option_2, v.option_3].filter(Boolean).join(' / ')}</span>
                                                            {/* 變體規格格式標記 */}
                                                            <TooltipProvider>
                                                                <SpecFormatBadge specValues={v.spec_values} />
                                                            </TooltipProvider>
                                                        </div>
                                                        {v.device_models && v.device_models.length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mt-1">
                                                                {v.device_models.map((m: any, idx: number) => (
                                                                    <Badge key={m.id || idx} variant="secondary" className="text-[8px] px-1 h-3.5 bg-amber-50 text-amber-900 border-amber-200">
                                                                        {m.name}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="py-1 text-right">
                                                        <Badge variant="outline" className={`text-[9px] px-1 h-4 ${STATUS_VARIANTS[v.status] || ''}`}>
                                                            {STATUS_LABELS[v.status]}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="py-1 text-right">
                                                        <Input
                                                            type="number"
                                                            className="h-7 w-20 text-right text-xs ml-auto border-dashed"
                                                            defaultValue={v.wholesale_price}
                                                            onBlur={(e) => {
                                                                const val = parseFloat(e.target.value);
                                                                if (!isNaN(val) && val !== v.wholesale_price) {
                                                                    onUpdateVariant(v.id, { wholesale_price: val });
                                                                }
                                                            }}
                                                        />
                                                    </TableCell>
                                                    <TableCell className="py-1 text-right">
                                                        <Input
                                                            type="number"
                                                            className="h-7 w-20 text-right text-xs ml-auto border-dashed"
                                                            defaultValue={v.retail_price}
                                                            onBlur={(e) => {
                                                                const val = parseFloat(e.target.value);
                                                                if (!isNaN(val) && val !== v.retail_price) {
                                                                    onUpdateVariant(v.id, { retail_price: val });
                                                                }
                                                            }}
                                                        />
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </TableCell>
                        </TableRow>
                    </CollapsibleContent>
                )}
            </>
        </Collapsible>
    );
}
