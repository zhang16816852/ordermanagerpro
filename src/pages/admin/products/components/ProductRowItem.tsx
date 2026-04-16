import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MoreHorizontal, Pencil, Copy, Trash2, ChevronRight, ChevronDown, Layers } from 'lucide-react';
import { Tables } from '@/integrations/supabase/types';

type Product = Tables<'products'>;

interface ProductRowItemProps {
    product: Product;
    brandMap: Record<string, string>;
    variants: any[];
    models: string[];
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
    
    // v4.9 獲取顯示品牌名稱 (優先從字典對照，無則回退至舊有 brand 欄位)
    const displayBrand = (product.brand_id ? brandMap[product.brand_id] : (product as any).brand) || '-';

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
                        <div className="flex items-center gap-2">
                            {product.name}
                            {hasVariants && (
                                <Badge variant="outline" className="ml-2 text-[10px] h-5">
                                    <Layers className="h-3 w-3 mr-1" />
                                    {variants.length} 變體
                                </Badge>
                            )}
                        </div>
                    </TableCell>
                    <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-[150px]">
                            {(product as any).category_names?.length > 0 ? (
                                (product as any).category_names.map((name: string) => (
                                    <Badge key={name} variant="outline" className="text-[10px] px-1 h-5">
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
                                    {models.map(model => (
                                        <Badge key={model} variant="secondary" className="text-[9px] px-1 h-4 bg-amber-100 text-amber-800 hover:bg-amber-100/80 border-transparent">
                                            {model}
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </div>
                    </TableCell>
                    <TableCell className="text-right">
                        <div className="text-sm font-bold">${product.base_wholesale_price}</div>
                        <div className="text-[10px] text-muted-foreground">${product.base_retail_price}</div>
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
                                                        <div>{[v.option_1, v.option_2, v.option_3].filter(Boolean).join(' / ')}</div>
                                                        {v.variant_model_links && v.variant_model_links.length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mt-1">
                                                                {v.variant_model_links.map((link: any) => (
                                                                    <Badge key={link.model_id} variant="secondary" className="text-[8px] px-1 h-3.5 bg-amber-50 text-amber-900 border-amber-200">
                                                                        {link.device_models?.name}
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
