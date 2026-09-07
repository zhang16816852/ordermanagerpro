import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Package, Plus, Check, Loader2, X } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';

export interface RepairPartSelection {
  product_id: string | null;
  variant_id: string | null;
  part_name: string;
  unit_cost: number;
}

export interface RepairPartOption {
  id: string;
  productId: string;
  variantId: string | null;
  name: string;
  productName: string;
  variantName: string | null;
  code?: string;
  sku?: string;
  stock: number;
  unitCost: number;
}

interface RepairPartSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selection: RepairPartSelection) => void;
  currentValue?: { product_id: string | null; variant_id: string | null } | null;
  onCreatePart?: () => void;
}

interface StockEntry {
  product_id: string;
  variant_id: string | null;
  quantity: number;
}

export function RepairPartSelectDialog({
  open,
  onOpenChange,
  onSelect,
  currentValue,
  onCreatePart,
}: RepairPartSelectDialogProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(false);

  const { data: partsData, isLoading } = useQuery<{ products: any[]; stock: StockEntry[] } | undefined>({
    queryKey: ['repair_parts_catalog'],
    queryFn: async () => {
      const { data: products, error } = await (supabase as any)
        .from('products')
        .select('id, name, code, unified_wholesale_price, variants:product_variants(id, name, sku, wholesale_price)')
        .eq('item_type', 'repair_part')
        .order('name');
      if (error) throw error;

      const ids = (products || []).map((p: any) => p.id);
      let stock: StockEntry[] = [];
      if (ids.length > 0) {
        const { data: inv, error: invError } = await (supabase as any)
          .from('product_inventory')
          .select('product_id, variant_id, quantity, warehouse:warehouse_id(code, type)')
          .in('product_id', ids);
        if (invError) throw invError;
        stock = (inv || [])
          .filter((r: any) => r.warehouse && (r.warehouse.code === 'own' || r.warehouse.type === '自有倉'))
          .map((r: any) => ({
            product_id: r.product_id,
            variant_id: r.variant_id || null,
            quantity: Number(r.quantity) || 0,
          }));
      }

      return { products: products || [], stock };
    },
    enabled: open,
  });

  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    (partsData?.stock || []).forEach((s) => {
      const key = `${s.product_id}|${s.variant_id || ''}`;
      map.set(key, (map.get(key) || 0) + s.quantity);
    });
    return map;
  }, [partsData]);

  const stockOf = (productId: string, variantId: string | null) =>
    stockMap.get(`${productId}|${variantId || ''}`) || 0;

  const partOptions = useMemo(() => {
    const opts: RepairPartOption[] = [];
    (partsData?.products || []).forEach((p: any) => {
      const pName = p.name || '未命名商品';
      if (p.variants && p.variants.length > 0) {
        p.variants.forEach((v: any) => {
          const vName = v.name || '';
          const fullName = vName || pName;
          const stock = stockOf(p.id, v.id);
          const cost = Number(v.wholesale_price ?? p.unified_wholesale_price ?? 0) || 0;

          opts.push({
            id: `${p.id}__${v.id}`,
            productId: p.id,
            variantId: v.id,
            name: fullName,
            productName: pName,
            variantName: vName || null,
            code: p.code || undefined,
            sku: v.sku || undefined,
            stock,
            unitCost: cost,
          });
        });
      } else {
        const stock = stockOf(p.id, null);
        const cost = Number(p.unified_wholesale_price ?? 0) || 0;

        opts.push({
          id: `${p.id}__`,
          productId: p.id,
          variantId: null,
          name: pName,
          productName: pName,
          variantName: null,
          code: p.code || undefined,
          sku: undefined,
          stock,
          unitCost: cost,
        });
      }
    });
    return opts;
  }, [partsData, stockMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredOptions = useMemo(() => {
    let list = partOptions;
    if (onlyInStock) {
      list = list.filter((item) => item.stock > 0);
    }
    const q = searchTerm.trim().toLowerCase();
    if (!q) return list;

    return list.filter((item) => {
      if (item.name.toLowerCase().includes(q)) return true;
      if (item.productName.toLowerCase().includes(q)) return true;
      if (item.variantName && item.variantName.toLowerCase().includes(q)) return true;
      if (item.code && item.code.toLowerCase().includes(q)) return true;
      if (item.sku && item.sku.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [partOptions, searchTerm, onlyInStock]);

  const handleSelectOption = (opt: RepairPartOption) => {
    onSelect({
      product_id: opt.productId,
      variant_id: opt.variantId,
      part_name: opt.variantName || opt.name,
      unit_cost: opt.unitCost,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden sm:rounded-xl">
        <DialogHeader className="p-4 pb-3 border-b bg-muted/20">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-semibold flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                選擇維修零件
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                從商品庫存中挑選維修材料，支援名稱、規格、商品編號即時搜尋
              </DialogDescription>
            </div>
            {onCreatePart && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={() => {
                  onOpenChange(false);
                  onCreatePart();
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                建立新零件商品
              </Button>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜尋產品名稱、規格、編號或 SKU..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-8 h-9 text-sm"
                autoFocus
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <Button
              type="button"
              variant={onlyInStock ? 'default' : 'outline'}
              size="sm"
              className="h-9 text-xs shrink-0"
              onClick={() => setOnlyInStock(!onlyInStock)}
            >
              僅看有庫存
            </Button>
          </div>
        </DialogHeader>

        <div className="p-2">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-xs">載入維修零件庫存中...</span>
            </div>
          ) : filteredOptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center px-4">
              <Package className="h-10 w-10 text-muted-foreground/40 mb-2" />
              <p className="text-sm font-medium text-foreground">找不到符合條件的維修零件</p>
              <p className="text-xs text-muted-foreground mt-1">
                {searchTerm ? '請嘗試更換搜尋關鍵字' : '目前尚無維修零件，可先建立零件商品'}
              </p>
              {onCreatePart && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 text-xs gap-1"
                  onClick={() => {
                    onOpenChange(false);
                    onCreatePart();
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  前往建立零件
                </Button>
              )}
            </div>
          ) : (
            <ScrollArea className="h-[360px] pr-2">
              <div className="space-y-1">
                {filteredOptions.map((opt) => {
                  const isSelected =
                    currentValue?.product_id === opt.productId &&
                    (currentValue?.variant_id || null) === opt.variantId;

                  return (
                    <div
                      key={opt.id}
                      onClick={() => handleSelectOption(opt)}
                      className={`flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer hover:border-primary/50 hover:bg-accent/40 ${isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : 'border-border/60 bg-card'
                        }`}
                    >
                      <div className="min-w-0 flex-1 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground truncate">
                            {opt.variantName || opt.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          {opt.sku && <span className="font-mono">SKU: {opt.sku}</span>}
                          {opt.code && <span className="font-mono">編號: {opt.code}</span>}
                          <span>進貨成本: {formatCurrency(opt.unitCost)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <Badge
                          variant={opt.stock > 0 ? 'default' : 'secondary'}
                          className={`text-xs px-2 py-0.5 ${opt.stock > 0
                            ? 'bg-emerald-600 hover:bg-emerald-600 text-white'
                            : 'bg-muted text-muted-foreground'
                            }`}
                        >
                          庫存 {opt.stock}
                        </Badge>

                        <Button
                          type="button"
                          variant={isSelected ? 'default' : 'outline'}
                          size="sm"
                          className="h-8 px-3 text-xs"
                        >
                          {isSelected ? (
                            <>
                              <Check className="h-3.5 w-3.5 mr-1" />
                              已選
                            </>
                          ) : (
                            '選擇'
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="p-3 bg-muted/20 border-t flex items-center justify-between text-xs text-muted-foreground">
          <span>共 {filteredOptions.length} 個維修零件項目</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onOpenChange(false)}
          >
            關閉
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
