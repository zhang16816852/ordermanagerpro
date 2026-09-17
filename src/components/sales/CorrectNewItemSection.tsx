import { useState, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PackagePlus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/formatters";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { CorrectNewItem } from "./salesNoteCorrectTypes";

interface CorrectNewItemSectionProps {
    products: any[];
    newItems: CorrectNewItem[];
    onAddItem: (item: CorrectNewItem) => void;
    onRemoveItem: (index: number) => void;
}

export function CorrectNewItemSection({ products, newItems, onAddItem, onRemoveItem }: CorrectNewItemSectionProps) {
    const [newItemDraft, setNewItemDraft] = useState<CorrectNewItem>({
        product_id: "",
        variant_id: null,
        quantity: 1,
        unit_price: 0,
    });

    // ─── 產品快取 → 新品項選項（排除維修零件/運費/隱藏） ───
    const newItemOptions = useMemo(() => {
        const visible = products.filter((p: any) => {
            const itemType = p.item_type;
            return itemType !== "repair_part" && itemType !== "shipping" && !p.is_hidden;
        });
        const options: { id: string; name: string; subLabel?: string; badge?: string; group?: string }[] = [];
        visible.forEach((p: any) => {
            if (p.variants && p.variants.length > 0) {
                p.variants.forEach((v: any) => {
                    options.push({
                        id: v.id,
                        name: `${p.name} · ${v.name}`,
                        subLabel: `${v.sku || ""}${p.code ? ` (${p.code})` : ""}`,
                        group: p.name,
                    });
                });
            } else {
                options.push({
                    id: p.id,
                    name: p.name,
                    subLabel: p.code || undefined,
                });
            }
        });
        return options;
    }, [products]);

    const handleAddNewItem = () => {
        if (!newItemDraft.product_id) {
            toast.error("請選擇要新增的產品");
            return;
        }
        if (!newItemDraft.quantity || newItemDraft.quantity < 1) {
            toast.error("請輸入有效數量");
            return;
        }
        onAddItem({ ...newItemDraft });
        setNewItemDraft({ product_id: "", variant_id: null, quantity: 1, unit_price: 0 });
    };

    return (
        <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
                <PackagePlus className="h-4 w-4 text-emerald-500" /> 新增品項（完全新品）
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-6 space-y-1">
                    <Label className="text-xs text-muted-foreground">產品／變體</Label>
                    <SearchableSelect
                        options={newItemOptions}
                        value={newItemDraft.variant_id || newItemDraft.product_id || null}
                        onChange={(id) => {
                            if (!id) {
                                setNewItemDraft((prev) => ({ ...prev, product_id: "", variant_id: null }));
                                return;
                            }
                            const opt = newItemOptions.find((o) => o.id === id);
                            const foundProduct = products.find((p: any) =>
                                p.id === id || (p.variants || []).some((v: any) => v.id === id)
                            );
                            const isVariant = foundProduct && id !== foundProduct.id;
                            const basePrice = isVariant
                                ? (foundProduct.variants || []).find((v: any) => v.id === id)?.retail_price || 0
                                : (foundProduct as any)?.unified_retail_price || 0;
                            setNewItemDraft((prev) => ({
                                ...prev,
                                product_id: foundProduct?.id || "",
                                variant_id: isVariant ? id : null,
                                quantity: prev.quantity || 1,
                                unit_price: basePrice || 0,
                            }));
                        }}
                        placeholder="搜尋產品／變體..."
                        searchPlaceholder="輸入產品名稱、SKU、料號..."
                        emptyText="找不到產品"
                    />
                </div>
                <div className="md:col-span-2 space-y-1">
                    <Label className="text-xs text-muted-foreground">數量</Label>
                    <Input
                        type="number"
                        min={1}
                        className="h-9"
                        value={newItemDraft.quantity || ""}
                        onChange={(e) =>
                            setNewItemDraft((prev) => ({ ...prev, quantity: Math.max(1, Number(e.target.value) || 1) }))
                        }
                    />
                </div>
                <div className="md:col-span-2 space-y-1">
                    <Label className="text-xs text-muted-foreground">單價</Label>
                    <Input
                        type="number"
                        min={0}
                        className="h-9"
                        value={newItemDraft.unit_price || ""}
                        onChange={(e) =>
                            setNewItemDraft((prev) => ({ ...prev, unit_price: Math.max(0, Number(e.target.value) || 0) }))
                        }
                    />
                </div>
                <div className="md:col-span-2">
                    <Button
                        type="button"
                        className="w-full"
                        onClick={handleAddNewItem}
                        disabled={!newItemDraft.product_id}
                    >
                        <Plus className="h-4 w-4 mr-1" /> 加入
                    </Button>
                </div>
            </div>

            {newItems.length > 0 && (
                <div className="rounded-md border overflow-hidden">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead>產品名稱</TableHead>
                                <TableHead className="text-right">數量</TableHead>
                                <TableHead className="text-right">單價</TableHead>
                                <TableHead className="text-right">小計</TableHead>
                                <TableHead className="w-10"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {newItems.map((it, idx) => {
                                const opt = newItemOptions.find((o) => o.id === (it.variant_id || it.product_id));
                                return (
                                    <TableRow key={`${it.variant_id || it.product_id}-${idx}`}>
                                        <TableCell className="font-medium text-sm">{opt?.name || "未知品項"}</TableCell>
                                        <TableCell className="text-right">{it.quantity}</TableCell>
                                        <TableCell className="text-right text-muted-foreground">{formatCurrency(it.unit_price)}</TableCell>
                                        <TableCell className="text-right">{formatCurrency(it.quantity * it.unit_price)}</TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onRemoveItem(idx)}>
                                                <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}