// src/components/order/CartPanel.tsx
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Plus, Minus, Trash2, ArrowRight } from "lucide-react";
import { useStoreDraft } from "@/stores/useOrderDraftStore";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface CartPanelProps {
  storeId: string;
  /** 是否顯示「去結帳」按鈕 */
  showCheckoutButton?: boolean;
  /** 結帳路徑（預設 /cart） */
  checkoutPath?: string;
}

export default function CartPanel({
  storeId,
  showCheckoutButton = true,
  checkoutPath = "/cart",
}: CartPanelProps) {
  const navigate = useNavigate();
  const { items, totalItems, totalAmount, updateQuantity, removeItem } = useStoreDraft(storeId);
  console.log(items);
  if (items.length === 0) {
    return (
      <Card className="sticky top-4">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              購物車
            </span>
            <Badge variant="secondary">0</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground py-12">
            購物車是空的
            <br />
            <span className="text-sm">快去選購商品吧！</span>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="sticky top-4">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            購物車
          </span>
          <Badge variant="secondary">{totalItems}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ScrollArea className="max-h-[50vh]">
          <div className="space-y-3">
            {/* Mobile View (Card List) */}
            <div className="md:hidden space-y-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="p-3 border rounded-lg bg-background space-y-3"
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm break-words leading-tight">
                        {item.options && item.options.length > 0 ? item.options.join(' / ') : (item.variantName || item.name)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 font-mono">
                        {item.sku}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0 -mr-1 -mt-1"
                      onClick={() => removeItem(item.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    {/* 單價 */}
                    <div className="text-xs text-muted-foreground">
                      ${item.price.toLocaleString()}
                    </div>

                    {/* 數量控制 */}
                    <div className="flex items-center border rounded-md h-7 shadow-sm">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 rounded-none px-0"
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-8 text-center text-sm font-medium tabular-nums border-x h-full flex items-center justify-center bg-muted/20">
                        {item.quantity}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 rounded-none px-0"
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>

                    {/* 小計 */}
                    <div className="text-sm font-medium tabular-nums text-right min-w-[60px]">
                      ${(item.price * item.quantity).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop View (Table) */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead >商品名稱</TableHead>
                    <TableHead className="w-[140px] text-center">單價 / 數量</TableHead>
                    <TableHead className="w-[100px] text-right">小計</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="w-[140px] font-medium text-sm">
                          {item.options && item.options.length > 0 ? item.options.join(' / ') : (item.variantName || item.name)}
                        </div>

                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-center gap-2">

                          {/* 單價 */}
                          <div className="text-sm font-medium">
                            ${item.price.toLocaleString()}
                          </div>

                          {/* 數量控制 */}
                          <div className="flex items-center border rounded-md h-8 shadow-sm">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 rounded-none px-0"
                              onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>

                            <span className="w-10 text-center text-sm font-medium tabular-nums border-x h-full flex items-center justify-center bg-muted/20">
                              {item.quantity}
                            </span>

                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 rounded-none px-0"
                              onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>

                        </div>
                      </TableCell>
                      <TableCell className="text-right font-lg ">
                        ${(item.price * item.quantity).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => removeItem(item.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </ScrollArea>

        <Separator />

        <div className="space-y-4">
          <div className="flex justify-between text-lg font-semibold">
            <span>總計</span>
            <span>${totalAmount.toLocaleString()}</span>
          </div>

          {showCheckoutButton && (
            <Button
              size="lg"
              className="w-full"
              onClick={() => navigate(checkoutPath)}
            >
              去結帳
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
