import type { ReactNode } from 'react';
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ShippingPoolItem } from "./shippingPoolTypes";

export function SortablePoolRow({ item, isRemoving, children }: { item: ShippingPoolItem; isRemoving?: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };
  return (
    <TableRow ref={setNodeRef} style={style} {...attributes}>
      <TableCell {...listeners} className="cursor-grab active:cursor-grabbing w-10 text-center text-muted-foreground hover:text-foreground">
        <GripVertical className="h-3.5 w-3.5 mx-auto" />
      </TableCell>
      {children}
    </TableRow>
  );
}