import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWarehouses } from "@/pages/admin/inventory/hooks/useWarehouses";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Warehouse as WarehouseIcon } from "lucide-react";

interface WarehouseSelectorProps {
  value?: string;
  onChange: (warehouseId: string) => void;
  label?: string;
  className?: string;
  productId?: string;
  variantId?: string | null;
}

function useProductStock(productId?: string, variantId?: string | null) {
  const enabled = !!productId;
  return useQuery({
    queryKey: ['product-inventory-stock', productId, variantId ?? ''],
    queryFn: async () => {
      if (!productId) return {};
      let query = (supabase
        .from('product_inventory') as any)
        .select('warehouse_id, quantity')
        .eq('product_id', productId);
      if (variantId) {
        query = query.eq('variant_id', variantId);
      } else {
        query = query.is('variant_id', null);
      }
      const { data, error } = await query;
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of data || []) {
        map[row.warehouse_id] = row.quantity;
      }
      return map;
    },
    enabled,
    staleTime: 30_000,
  });
}

export function WarehouseSelector({
  value, onChange, label = "倉庫", className,
  productId, variantId,
}: WarehouseSelectorProps) {
  const { warehouses, defaultWarehouse } = useWarehouses();
  const { data: stockMap } = useProductStock(productId, variantId);
  const activeWarehouses = warehouses.filter(w => w.is_active !== false);

  return (
    <div className={className}>
      {label && <Label className="text-sm font-medium flex items-center gap-1 mb-1"><WarehouseIcon className="h-3.5 w-3.5" />{label}</Label>}
      <Select
        value={value || defaultWarehouse?.id || ""}
        onValueChange={onChange}
      >
        <SelectTrigger>
          <SelectValue placeholder="選擇倉庫" />
        </SelectTrigger>
        <SelectContent>
          {activeWarehouses.map((w) => {
            const qty = stockMap?.[w.id];
            return (
              <SelectItem key={w.id} value={w.id}>
                {w.name} ({w.code}){qty !== undefined ? ` 庫存:${qty}` : ''}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
