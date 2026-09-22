import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronUp, Home } from "lucide-react";
import { DeliveryType, DeliveryTypePicker, TYPE_LABEL } from "./DeliveryMethodPicker";
import type { PanelState } from "@/components/order/OrderItemsPanel";

interface DeliveryTypeCardProps {
  value: DeliveryType | null;
  onValueChange: (value: DeliveryType | null) => void;
  className?: string;
  activePanel?: PanelState;
  onTogglePanel?: () => void;
  collapsed?: boolean;
}

// 配送類型卡片：只選類型（配送層次只要類型），方法/包裹細節於出貨時建立
export function DeliveryTypeCard({
  value,
  onValueChange,
  className,
  activePanel,
  onTogglePanel,
  collapsed = false,
}: DeliveryTypeCardProps) {
  return (
    <Card className={className}>
      <CardHeader
        className={`sticky top-0 bg-background z-10 shrink-0 py-3 px-4 ${onTogglePanel ? 'cursor-pointer select-none' : ''}`}
        onClick={onTogglePanel}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Home className="h-4 w-4" />
            配送類型
          </CardTitle>
          {onTogglePanel && (
            <div className="flex items-center gap-1 text-muted-foreground">
              {value ? (TYPE_LABEL[value] || value) : '未設定'}
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
          <DeliveryTypePicker value={value} onValueChange={onValueChange} className="w-full" />
        </CardContent>
      )}
    </Card>
  );
}