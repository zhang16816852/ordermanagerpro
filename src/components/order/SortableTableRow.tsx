import type { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { TableCell, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ServiceItemBadge } from './ServiceItemBadge';
import type { KeyOption, OrderItemRow, ViewMode } from './orderItemsTypes';

export function SortableTableRow({ item, index, viewMode, keyOptions, children }: { item: OrderItemRow; index: number; viewMode: ViewMode; keyOptions: KeyOption[]; children: ReactNode }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1 };
    return (
        <TableRow ref={setNodeRef} style={style} {...attributes}>
            <TableCell {...listeners} className="cursor-grab active:cursor-grabbing w-8 text-center text-muted-foreground hover:text-foreground">
                <GripVertical className="h-4 w-4 mx-auto" />
            </TableCell>
            {viewMode === 'compact' ? (
                <TableCell className="font-medium">
                    <div className="flex flex-col">
                        <span>{item.variantName || item.productName || item.sku || item.id.slice(0, 8)}</span>
                        <span className="inline-flex items-center gap-1 flex-wrap">
                            {item.selectedModelName && <span className="text-xs font-mono text-muted-foreground">{item.selectedModelName}</span>}
                            <ServiceItemBadge item={item} />
                        </span>
                    </div>
                </TableCell>
            ) : (
                <>
                    <TableCell className="font-medium">
                        {item.variantName || item.productName || item.sku || item.id.slice(0, 8)}
                        {item.isNew && <Badge variant="outline" className="ml-2 bg-green-50 text-green-700 border-green-200">新增</Badge>}
                        <ServiceItemBadge item={item} />
                    </TableCell>
                    {/* 关键选项欄位 */}
                    {keyOptions.map((opt, idx) => (
                        <TableCell key={idx} className="text-xs text-muted-foreground w-[100px]">
                            <div className="truncate">{opt.value}</div>
                            <div className="text-[10px] text-muted-foreground/70">{opt.name}</div>
                        </TableCell>
                    ))}
                </>
            )}
            {children}
        </TableRow>
    );
}