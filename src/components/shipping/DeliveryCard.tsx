import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronUp, Home } from "lucide-react";
import { DeliveryMethodPicker, DeliveryMethodOption } from "./DeliveryMethodPicker";
import { ShippingAddressFields, ShippingAddressValue } from "./ShippingAddressFields";
import type { PanelState } from "@/components/order/OrderItemsPanel";

interface DeliveryCardProps {
  methods: DeliveryMethodOption[];
  value: string | null;
  onValueChange: (id: string | null) => void;
  address: ShippingAddressValue;
  onAddressChange: (v: ShippingAddressValue) => void;
  onApplyStoreAddress: () => void;
  className?: string;
  activePanel?: PanelState;
  onTogglePanel?: () => void;
  collapsed?: boolean;
}

// 配送資訊卡片：方式下拉 + 收件地址（縣市/鄉鎮/郵區/地址）+「套用店家最新地址」
export function DeliveryCard({
  methods,
  value,
  onValueChange,
  address,
  onAddressChange,
  onApplyStoreAddress,
  className,
  activePanel,
  onTogglePanel,
  collapsed = false,
}: DeliveryCardProps) {
  return (
    <Card className={className}>
      <CardHeader
        className={`sticky top-0 bg-background z-10 shrink-0 py-3 px-4 ${onTogglePanel ? 'cursor-pointer select-none' : ''}`}
        onClick={onTogglePanel}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Home className="h-4 w-4" />
            配送資訊
          </CardTitle>
          {onTogglePanel && (
            <div className="flex items-center gap-1 text-muted-foreground">
              {activePanel === 'delivery' && !collapsed ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </div>
          )}
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent className="p-4 pt-0 space-y-3" onClick={(e) => e.stopPropagation()}>
          <div className="space-y-1.5">
            <Label>配送方式</Label>
            <DeliveryMethodPicker
              value={value}
              onValueChange={onValueChange}
              methods={methods}
              allowNone
              className="w-full"
            />
          </div>
          <ShippingAddressFields value={address} onChange={onAddressChange} prefix="order-ship" />
          <Button type="button" variant="outline" size="sm" onClick={onApplyStoreAddress} className="w-full">
            套用店家最新地址
          </Button>
        </CardContent>
      )}
    </Card>
  );
}