import { Button } from '@/components/ui/button';
import { Plus, Pencil, Trash2, FolderTree, ChevronRight, ChevronDown, GripVertical } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useSortable, arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';

// Badge 簡易元件（避免與 shadcn Badge 衝突）
function InlineBadge({ children, variant = 'default', className = '' }: any) {
    const variants: any = {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        outline: 'text-foreground border border-input',
    };
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${variants[variant]} ${className}`}>
            {children}
        </span>
    );
}

interface CategoryTreeNodeProps {
    node: any;
    level?: number;
    path?: string;
    expandedIds: Set<string>;
    setExpandedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
    categorySpecLinks: any[];
    openDialog: (cat?: any | null, defaultParentId?: string | null) => void;
    // 新增排序所需 props
    onReorder: (updates: { id: string, sort_order: number, name: string }[]) => void;
    categoryHierarchy: any[];
    allCategories: any[];
}

// 單一分類樹狀節點（遞迴渲染）
export function CategoryTreeNode({
    node,
    level = 0,
    path = 'root',
    expandedIds,
    setExpandedIds,
    categorySpecLinks,
    openDialog,
    onReorder,
    categoryHierarchy,
    allCategories,
}: CategoryTreeNodeProps) {
    const queryClient = useQueryClient();
    
    // dnd-kit Sortable Hook
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: node.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : undefined,
        opacity: isDragging ? 0.5 : 1,
    };

    const isExpanded = expandedIds.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    const linkedSpecsCount = categorySpecLinks.filter((l: any) => l.category_id === node.id).length;
    const uniqueKey = `${path}-${node.id}`;

    // DnD Sensors for nested children
    const sensors = useSensors(useSensor(PointerSensor));

    const handleChildDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const oldIndex = node.children.findIndex((c: any) => c.id === active.id);
        const newIndex = node.children.findIndex((c: any) => c.id === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
            const newChildrenOrder = arrayMove(node.children, oldIndex, newIndex);
            const updates = newChildrenOrder.map((c: any, idx: number) => ({
                id: c.id,
                sort_order: idx,
                name: c.name
            }));
            onReorder(updates);
        }
    };
    // 切換展開/收合
    const toggleExpand = () => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(node.id)) next.delete(node.id);
            else next.add(node.id);
            return next;
        });
    };

    // 刪除分類
    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm(`確定要刪除「${node.name}」嗎？`)) {
            supabase.from('categories').delete().eq('id', node.id).then(() => {
                queryClient.invalidateQueries({ queryKey: ['categories'] });
            });
        }
    };

    return (
        <div 
            ref={setNodeRef} 
            style={style} 
            key={uniqueKey} 
            className="space-y-1"
        >
            <div
                className="flex items-center group py-2 px-3 hover:bg-muted/50 rounded-lg border border-transparent hover:border-border transition-colors cursor-pointer"
                style={{ marginLeft: `${level * 24}px` }}
                onClick={toggleExpand}
            >
                <div className="flex items-center gap-2 flex-1">
                    {/* 拖移手把 */}
                    <div 
                        {...attributes} 
                        {...listeners}
                        className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <GripVertical className="h-4 w-4 text-muted-foreground/50" />
                    </div>

                    {hasChildren ? (
                        isExpanded
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    ) : (
                        <div className="w-4" />
                    )}
                    <FolderTree className="h-4 w-4 text-primary/70" />
                    <span className="font-medium text-sm">{node.name}</span>
                    {linkedSpecsCount > 0 && (
                        <InlineBadge variant="secondary" className="text-[10px] py-0 h-4">
                            {linkedSpecsCount} 個規格
                        </InlineBadge>
                    )}
                </div>

                {/* 懸停操作按鈕 */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        title="新增子分類"
                        onClick={(e) => { e.stopPropagation(); openDialog(null, node.id); }}
                    >
                        <Plus className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        title="編輯"
                        onClick={(e) => { e.stopPropagation(); openDialog(node); }}
                    >
                        <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                        title="刪除"
                        onClick={handleDelete}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>

            {/* 遞迴渲染子分類 */}
            {isExpanded && hasChildren && (
                <div className="space-y-1">
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleChildDragEnd}
                    >
                        <SortableContext
                            items={node.children.map((c: any) => c.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            {node.children.map((child: any) => (
                                <CategoryTreeNode
                                    key={`${node.id}-${child.id}`}
                                    node={child}
                                    level={level + 1}
                                    path={node.id}
                                    expandedIds={expandedIds}
                                    setExpandedIds={setExpandedIds}
                                    categorySpecLinks={categorySpecLinks}
                                    openDialog={openDialog}
                                    onReorder={onReorder}
                                    categoryHierarchy={categoryHierarchy}
                                    allCategories={allCategories}
                                />
                            ))}
                        </SortableContext>
                    </DndContext>
                </div>
            )}
        </div>
    );
}
