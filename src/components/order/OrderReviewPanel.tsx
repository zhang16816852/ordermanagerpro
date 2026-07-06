import { useState, useCallback, useMemo } from "react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { OrderDraftItem } from "@/store/useOrderDraftStore";

interface OrderReviewPanelProps {
  storeId: string;
  storeName: string;
  storeCode: string;
  items: OrderDraftItem[];
  notes: string;
  priceSyncMap: Record<string, boolean>;
  onItemsChange: (items: OrderDraftItem[]) => void;
  onNotesChange: (notes: string) => void;
  onPriceSyncMapChange: (map: Record<string, boolean>) => void;
  onSubmit: (mode: "pending" | "shipped_with_sales_note") => void;
  isSubmitting: boolean;
}

function SortableRow({
  item,
  index,
  priceSync,
  onTabNav,
  onPriceSyncChange,
  onPriceChange,
  onQuantityChange,
}: {
  item: OrderDraftItem;
  index: number;
  priceSync: boolean;
  onTabNav: (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: "qty" | "price") => void;
  onPriceSyncChange: (checked: boolean) => void;
  onPriceChange: (price: number) => void;
  onQuantityChange: (qty: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TableRow ref={setNodeRef} style={style}>
      <TableCell className="w-8">
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
          <GripVertical className="h-4 w-4" />
        </button>
      </TableCell>
      <TableCell className="text-muted-foreground text-xs w-8">{index + 1}</TableCell>
      <TableCell>
        <div className="font-medium text-sm">{item.productName || item.name}</div>
        {item.variantName && (
          <div className="text-xs text-muted-foreground">{item.variantName}</div>
        )}
        <div className="text-xs text-muted-foreground font-mono">{item.sku}</div>
      </TableCell>
      <TableCell className="w-20">
        <Input
          type="number"
          value={item.quantity}
          onChange={(e) => onQuantityChange(Math.max(1, Number(e.target.value)))}
          onKeyDown={(e) => onTabNav(e, index, "qty")}
          data-row={index}
          data-col="qty"
          className="h-8 text-center"
          min={1}
          step={1}
        />
      </TableCell>
      <TableCell className="w-28">
        <Input
          type="number"
          value={item.price}
          onChange={(e) => onPriceChange(Number(e.target.value))}
          onKeyDown={(e) => onTabNav(e, index, "price")}
          data-row={index}
          data-col="price"
          className="h-8 text-right"
          min={0}
          step={1}
        />
      </TableCell>
      <TableCell className="text-right font-mono text-sm w-28">
        ${(item.price * item.quantity).toLocaleString()}
      </TableCell>
      <TableCell className="w-12 text-center">
        <Checkbox checked={priceSync} onCheckedChange={(v) => onPriceSyncChange(!!v)} />
      </TableCell>
    </TableRow>
  );
}

export default function OrderReviewPanel({
  storeId: _storeId,
  storeName,
  storeCode,
  items,
  notes,
  priceSyncMap,
  onItemsChange,
  onNotesChange,
  onPriceSyncMapChange,
  onSubmit,
  isSubmitting,
}: OrderReviewPanelProps) {

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const itemIds = useMemo(() => items.map((i) => i.id), [items]);

  const totalAmount = useMemo(
    () => items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [items]
  );

  const totalQuantity = useMemo(
    () => items.reduce((sum, i) => sum + i.quantity, 0),
    [items]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = items.findIndex((i) => i.id === active.id);
      const newIndex = items.findIndex((i) => i.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      onItemsChange(arrayMove(items, oldIndex, newIndex));
    },
    [items, onItemsChange]
  );

  const handlePriceChange = useCallback(
    (itemId: string, price: number) => {
      onItemsChange(
        items.map((i) => (i.id === itemId ? { ...i, price } : i))
      );
      onPriceSyncMapChange({ ...priceSyncMap, [itemId]: true });
    },
    [items, onItemsChange, priceSyncMap, onPriceSyncMapChange]
  );

  const handleQuantityChange = useCallback(
    (itemId: string, qty: number) => {
      onItemsChange(
        items.map((i) => (i.id === itemId ? { ...i, quantity: qty } : i))
      );
    },
    [items, onItemsChange]
  );

  const handlePriceSyncChange = useCallback(
    (itemId: string, checked: boolean) => {
      onPriceSyncMapChange({ ...priceSyncMap, [itemId]: checked });
    },
    [priceSyncMap, onPriceSyncMapChange]
  );

  const handleTabNav = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, currentRow: number, col: "qty" | "price") => {
      if (e.key !== "Tab") return;
      e.preventDefault();
      const total = items.length;
      if (total === 0) return;
      const isShift = e.shiftKey;
      let nextRow: number;
      let nextCol: "qty" | "price";

      if (isShift) {
        if (col === "qty") {
          if (currentRow > 0) { nextRow = currentRow - 1; nextCol = "qty"; }
          else { nextRow = total - 1; nextCol = "price"; }
        } else {
          if (currentRow > 0) { nextRow = currentRow - 1; nextCol = "price"; }
          else { nextRow = total - 1; nextCol = "qty"; }
        }
      } else {
        if (col === "qty") {
          if (currentRow < total - 1) { nextRow = currentRow + 1; nextCol = "qty"; }
          else { nextRow = 0; nextCol = "price"; }
        } else {
          if (currentRow < total - 1) { nextRow = currentRow + 1; nextCol = "price"; }
          else { nextRow = 0; nextCol = "qty"; }
        }
      }

      const target = document.querySelector<HTMLInputElement>(`input[data-row="${nextRow}"][data-col="${nextCol}"]`);
      target?.focus();
      target?.select();
    },
    [items.length]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">訂單確認</h1>
        <div className="flex items-center gap-2 mt-1 text-muted-foreground">
          <span>店家：{storeName}</span>
          <span className="text-xs">({storeCode})</span>
        </div>
      </div>

      <div className="hidden md:block rounded-lg border bg-card">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>商品</TableHead>
                  <TableHead className="w-20 text-center">數量</TableHead>
                  <TableHead className="w-28 text-right">單價</TableHead>
                  <TableHead className="w-28 text-right">小計</TableHead>
                  <TableHead className="w-12 text-center text-xs">存為店價</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <SortableRow
                    key={item.id}
                    item={item}
                    index={index}
                    priceSync={!!priceSyncMap[item.id]}
                    onTabNav={handleTabNav}
                    onPriceSyncChange={(v) => handlePriceSyncChange(item.id, v)}
                    onPriceChange={(v) => handlePriceChange(item.id, v)}
                    onQuantityChange={(v) => handleQuantityChange(item.id, v)}
                  />
                ))}
              </TableBody>
            </Table>
          </SortableContext>
        </DndContext>
      </div>

      <div className="md:hidden space-y-3">
        {items.map((item, index) => (
          <div key={item.id} className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{item.productName || item.name}</div>
                {item.variantName && (
                  <div className="text-xs text-muted-foreground">{item.variantName}</div>
                )}
              </div>
              <span className="text-xs text-muted-foreground shrink-0 ml-2">#{index + 1}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">數量</Label>
                <Input
                  type="number"
                  value={item.quantity}
                  onChange={(e) => handleQuantityChange(item.id, Math.max(1, Number(e.target.value)))}
                  onKeyDown={(e) => handleTabNav(e, index, "qty")}
                  data-row={index}
                  data-col="qty"
                  className="h-8 text-center"
                  min={1}
                  step={1}
                />
              </div>
              <div>
                <Label className="text-xs">單價</Label>
                <Input
                  type="number"
                  value={item.price}
                  onChange={(e) => handlePriceChange(item.id, Number(e.target.value))}
                  onKeyDown={(e) => handleTabNav(e, index, "price")}
                  data-row={index}
                  data-col="price"
                  className="h-8 text-right"
                  min={0}
                  step={1}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`sync-${item.id}`}
                  checked={!!priceSyncMap[item.id]}
                  onCheckedChange={(v) => handlePriceSyncChange(item.id, !!v)}
                />
                <Label htmlFor={`sync-${item.id}`} className="text-xs cursor-pointer">存為店價</Label>
              </div>
              <span className="font-mono font-medium">${(item.price * item.quantity).toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Label>備註</Label>
        <Textarea
          placeholder="訂單備註..."
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={3}
        />
      </div>

      <div className="flex items-center justify-between text-lg font-bold border-t pt-4">
        <span>總計 <span className="text-base font-normal text-muted-foreground">（{totalQuantity} 件）</span></span>
        <span>${totalAmount.toLocaleString()}</span>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          size="lg"
          className="flex-1"
          onClick={() => onSubmit("pending")}
          disabled={isSubmitting || items.length === 0}
        >
          建立訂單
        </Button>
        <Button
          size="lg"
          variant="default"
          className="flex-1"
          onClick={() => onSubmit("shipped_with_sales_note")}
          disabled={isSubmitting || items.length === 0}
        >
          建立訂單並開立銷貨單
        </Button>
      </div>
    </div>
  );
}
