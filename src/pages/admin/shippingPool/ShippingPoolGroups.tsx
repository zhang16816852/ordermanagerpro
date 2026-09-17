import type { ReactNode } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowUp, ArrowDown, ArrowUpDown, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { formatCurrency } from '@/lib/formatters';
import { format } from "date-fns";
import { SortablePoolRow } from "./SortablePoolRow";
import { getDisplayName, GroupedByStore, PoolSortDir, PoolSortField } from "./shippingPoolTypes";

interface ShippingPoolGroupsProps {
  isLoading: boolean;
  groups: GroupedByStore[];
  selectedStores: Set<string>;
  onToggleStore: (storeId: string) => void;
  selectedPoolItemIds: Set<string>;
  onTogglePoolItem: (poolId: string) => void;
  onToggleAllInGroup: (group: GroupedByStore) => void;
  onDragEnd: (storeId: string, event: DragEndEvent) => void;
  sortField: PoolSortField;
  sortDir: PoolSortDir;
  onSort: (field: PoolSortField) => void;
}

export function ShippingPoolGroups({
  isLoading,
  groups,
  selectedStores,
  onToggleStore,
  selectedPoolItemIds,
  onTogglePoolItem,
  onToggleAllInGroup,
  onDragEnd,
  sortField,
  sortDir,
  onSort,
}: ShippingPoolGroupsProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const SortableHead = ({ field, children, className }: { field: PoolSortField; children: ReactNode; className?: string }) => (
    <TableHead className={className}>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-1 -ml-1 font-medium text-muted-foreground hover:text-foreground"
        onClick={() => onSort(field)}
      >
        {children}
        {sortField === field ? (
          sortDir === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
        ) : (
          <ArrowUpDown className="ml-1 h-3 w-3 opacity-30" />
        )}
      </Button>
    </TableHead>
  );

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">載入中...</div>;
  }

  if (groups.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        目前沒有待出貨的項目
      </div>
    );
  }

  return (
    <Accordion type="multiple" defaultValue={groups.map(g => g.storeId)} className="space-y-4">
      {groups.map((group) => {
        const isSelected = selectedStores.has(group.storeId);

        return (
          <AccordionItem key={group.storeId} value={group.storeId} className="border rounded-lg">
            <AccordionTrigger className="px-4 hover:no-underline">
              <div className="flex items-center gap-4 flex-1">
                <div
                  role="checkbox"
                  aria-checked={isSelected}
                  onClick={(e) => { onToggleStore(group.storeId); e.stopPropagation(); }}
                  className={`w-4 h-4 border rounded ${isSelected ? 'bg-primary' : ''}`}
                />
                <Store className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1 text-left">
                  <span className="font-medium">{group.storeName}</span>
                  {group.storeCode && (
                    <span className="text-muted-foreground ml-2">({group.storeCode})</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Badge variant="secondary">{group.items.length} 項</Badge>
                  <Badge variant="outline">共 {group.totalQuantity} 件</Badge>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => onDragEnd(group.storeId, e)}>
                <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={group.items.length > 0 && group.items.every(i => selectedPoolItemIds.has(i.id))}
                        onCheckedChange={() => onToggleAllInGroup(group)}
                        aria-label="全選此店家品項"
                      />
                    </TableHead>
                    <SortableHead field="product">商品</SortableHead>
                    <SortableHead field="quantity" className="text-right">出貨數量</SortableHead>
                    <SortableHead field="unit_price" className="text-right">單價</SortableHead>
                    <SortableHead field="subtotal" className="text-right">小計</SortableHead>
                    <SortableHead field="created_at">加入時間</SortableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <SortableContext items={group.items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                      {group.items.map((item) => (
                        <SortablePoolRow key={item.id} item={item}>
                          <TableCell className="flex items-center gap-2">
                            <Checkbox
                              checked={selectedPoolItemIds.has(item.id)}
                              onCheckedChange={() => onTogglePoolItem(item.id)}
                              aria-label="選取此品項"
                            />
                          </TableCell>
                          <TableCell className="text-sm">
                            <span className="font-medium">
                              {getDisplayName(item)}
                            </span>
                            <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                              來源單號: {item.order_item?.order?.code || item.order_item?.order_id.slice(0, 8)}
                              {item.order_item?.order?.consignment_mode && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">寄賣</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(item.order_item?.unit_price)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(item.quantity * (item.order_item?.unit_price || 0))}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {format(new Date(item.created_at), "MM/dd HH:mm")}
                          </TableCell>
                        </SortablePoolRow>
                      ))}
                    </SortableContext>
                  </TableBody>
                </Table>
              </DndContext>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}