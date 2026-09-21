import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters";

export interface DeliveryMethodOption {
  id: string;
  code: string;
  name: string;
  type: "delivery" | "logistics" | "pickup";
  price: number;
  cost: number;
  fee_payment: string;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
  supplier_id: string | null;
  tracking_url_template: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  delivery: "送貨",
  logistics: "物流",
  pickup: "自取",
};

// 全站共用：取得啟用中的配送方式（依 is_default → sort_order 排序）
export function useDeliveryMethods(options?: { includeInactive?: boolean }) {
  return useQuery({
    queryKey: ["delivery-methods"],
    queryFn: async () => {
      let q = (supabase as any)
        .from("delivery_methods")
        .select("id, code, name, type, price, cost, fee_payment, is_default, supplier_id, tracking_url_template, sort_order, is_active")
        .order("sort_order", { ascending: true });
      if (!options?.includeInactive) {
        q = q.eq("is_active", true);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as DeliveryMethodOption[];
    },
    staleTime: 60_000,
  });
}

interface DeliveryMethodPickerProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  methods: DeliveryMethodOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  allowNone?: boolean;
}

// 配送方式下拉（可選 none）
export function DeliveryMethodPicker({
  value,
  onValueChange,
  methods,
  placeholder = "選擇配送方式",
  disabled,
  className,
  allowNone = false,
}: DeliveryMethodPickerProps) {
  return (
    <Select
      value={value || undefined}
      onValueChange={(v) => onValueChange(v === "__none__" ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger className={cn("h-9", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && (
          <SelectItem value="__none__">（無）</SelectItem>
        )}
        {(methods || []).map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
            {m.price > 0 ? ` · ${formatCurrency(m.price)}` : ""}
            {m.is_default ? "（預設）" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function getDeliveryMethodTypeLabel(type: string): string {
  return TYPE_LABEL[type] || type;
}

export function getMethodPrice(methods: DeliveryMethodOption[] | undefined, id: string | null): number | null {
  if (!id || !methods) return null;
  const m = methods.find((x) => x.id === id);
  return m ? m.price : null;
}