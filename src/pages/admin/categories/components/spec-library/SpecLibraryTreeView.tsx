import React from 'react';
import { SpecDefinition } from '../../types';
import { SpecCard } from './SpecLibraryCard';
import { CornerDownRight, Zap, GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface SpecTreeNode {
    id: string;

    specId: string;
    spec: SpecDefinition;
    onValue?: string;
    parentId?: string;
    children: SpecTreeNode[];
}

interface TreeViewProps {
    treeData: SpecTreeNode[];
    onEdit: (spec: SpecDefinition) => void;
    onDelete: (spec: SpecDefinition, parentId?: string) => void;
    onReorder?: (updates: { id: string; sort_order: number }[]) => void;
}

function SortableNodeWrapper({ node, level, onEdit, onDelete, onReorder, isRoot = false }: any) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: node.id, data: { parentId: node.parentId || 'root' } });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        position: 'relative' as const,
        zIndex: isDragging ? 50 : 'auto',
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`relative group/node ${isRoot ? 'p-6 border rounded-2xl bg-muted/5 shadow-inner' : ''}`}
        >
            {/* 拖曳手把 */}
            <div
                className={`absolute ${isRoot ? 'left-2 top-2' : '-left-6 top-2'} p-1 opacity-0 group-hover/node:opacity-100 transition-opacity cursor-grab active:cursor-grabbing hover:bg-slate-200 rounded z-10`}
                {...attributes}
                {...listeners}
            >
                <GripVertical className="h-4 w-4 text-slate-400 hover:text-slate-700" />
            </div>

            <TreeNode node={node} level={level} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />
        </div>
    );
}

function TreeNode({ node, level, onEdit, onDelete, onReorder }: any) {
    return (
        <div className="space-y-4">
            <div className="flex gap-4">
                {/* 視覺引導：左側邊界線與箭頭 */}
                {level > 0 && (
                    <div className="flex flex-col items-center w-8 shrink-0">
                        <div className="w-px h-6 bg-primary/20" />
                        <CornerDownRight className="h-4 w-4 text-primary/30" />
                        {node.children.length > 0 && <div className="w-px grow bg-primary/20" />}
                    </div>
                )}

                <div className="flex-1 space-y-2">
                    {/* 觸發條件提示 */}
                    {node.onValue && (
                        <div className="flex items-center gap-1.5 mb-1 animate-in fade-in slide-in-from-left-2 transition-all">
                            <Zap className="h-3 w-3 text-orange-500 fill-current" />
                            <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-orange-500/5 text-orange-600 border-orange-500/20 font-bold">
                                當值為: {node.onValue} 時觸發
                            </Badge>
                        </div>
                    )}

                    <div className="max-w-md">
                        <SpecCard
                            spec={node.spec}
                            onEdit={onEdit}
                            onDelete={(spec) => onDelete(spec, node.parentId)}
                            showRelations={false}
                        />
                    </div>

                    {/* 遞迴渲染子節點 */}
                    {node.children.length > 0 && (
                        <div className="pt-2">
                            <SortableContext items={node.children.map((c: any) => c.id)} strategy={verticalListSortingStrategy}>
                                <div className="space-y-4">
                                    {node.children.map((child: any) => (
                                        <SortableNodeWrapper
                                            key={child.id}
                                            node={child}
                                            level={level + 1}
                                            onEdit={onEdit}
                                            onDelete={onDelete}
                                            onReorder={onReorder}
                                        />
                                    ))}
                                </div>
                            </SortableContext>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export function TreeView({ treeData, onEdit, onDelete, onReorder }: TreeViewProps) {
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id || !onReorder) return;

        // 確保只能在同一個父層級互換
        if (active.data.current?.parentId !== over.data.current?.parentId) return;

        // 尋找包含這個節點的陣列清單
        const findList = (nodes: SpecTreeNode[]): SpecTreeNode[] | null => {
            if (nodes.some(n => n.id === active.id)) return nodes;
            for (const node of nodes) {
                const found = findList(node.children);
                if (found) return found;
            }
            return null;
        };

        const list = findList(treeData);
        if (!list) return;

        const oldIndex = list.findIndex(n => n.id === active.id);
        const newIndex = list.findIndex(n => n.id === over.id);

        const newArray = arrayMove(list, oldIndex, newIndex);

        // 產生新的 sort_order 列表 (從 0 開始遞增)
        const updates = newArray.map((node, index) => ({
            id: node.specId, // 這裡必須用資料庫的 specId (UUID)
            sort_order: index
        }));

        onReorder?.(updates);
    };

    if (treeData.length === 0) {
        return <div className="py-20 text-center animate-pulse text-muted-foreground">目前查無規格邏輯樹。</div>;
    }

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <div className="space-y-6 pb-20 animate-in fade-in zoom-in-95 duration-400">
                <SortableContext items={treeData.map(r => r.id)} strategy={verticalListSortingStrategy}>
                    {treeData.map((root) => (
                        <SortableNodeWrapper
                            key={root.id}
                            node={root}
                            level={0}
                            onEdit={onEdit}
                            onDelete={onDelete}
                            onReorder={onReorder}
                            isRoot
                        />
                    ))}
                </SortableContext>
            </div>
        </DndContext>
    );
}
