import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronRight, ChevronDown, Layers } from 'lucide-react';
import { calculatePriceRange } from '@/utils/priceUtils';
import { ProductActionsMenu } from './ProductActionsMenu';
import { SpecFormatBadge } from './ProductSpecFormatBadge';
import { PRODUCT_STATUS_LABELS, PRODUCT_STATUS_VARIANTS, getProductBrandLabel } from './productRowHelpers';
import type { Product } from './productsListTypes';

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
    const hasVariants = variants.length > 0;

    const displayBrand = getProductBrandLabel(product as any, brandMap);

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
                                <SpecFormatBadge specValues={(product as any).spec_values} />
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
                            <div className="text-muted-foreground font-mono truncate" title={displayBrand}>{displayBrand}</div>
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
                            {calculatePriceRange(undefined, variants.map(v => v.wholesale_price)).display}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                            {calculatePriceRange(undefined, variants.map(v => v.retail_price)).display}
                        </div>
                    </TableCell>
                    <TableCell className="text-center">
                        <ProductActionsMenu
                            product={product}
                            onEdit={onEdit}
                            onCopy={onCopy}
                            onDelete={onDelete}
                        />
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
                                                            <span>{v.option_values?.map((ov: any) => ov.label || ov.value).filter(Boolean).join(' / ') || v.name}</span>
                                                            {/* 變體規格格式標記 */}
                                                            <SpecFormatBadge specValues={v.spec_values} />
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
                                                        <Badge variant="outline" className={`text-[9px] px-1 h-4 ${PRODUCT_STATUS_VARIANTS[v.status] || ''}`}>
                                                            {PRODUCT_STATUS_LABELS[v.status]}
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
