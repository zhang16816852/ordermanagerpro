import React, { useState } from 'react';
import { SpecDefinition } from '../../types';
import { SpecCard } from './SpecLibraryCard';
import { Zap, GripVertical, ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
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
    relationType?: 'visibility' | 'quantity';
    children: SpecTreeNode[];
}

const DEPTH_COLORS = [
    'border-l-blue-400',
    'border-l-emerald-400',
    'border-l-amber-400',
    'border-l-purple-400',
    'border-l-rose-400',
    'border-l-cyan-400',
];

const SPEC_TYPE_LABEL: Record<string, string> = {
    heading: '區段標題',
    select: '單選',
    multiselect: '多選',
    text: '文字',
    boolean: '布林',
    number_with_unit: '數值(附單位)',
    table: '表格',
};

interface TreeViewProps {
    treeData: SpecTreeNode[];
    onEdit: (spec: SpecDefinition) => void;
    onDelete: (spec: SpecDefinition, parentId?: string) => void;
    onReorder?: (updates: { id: string; sort_order: number }[]) => void;
    onSelectNode?: (node: SpecTreeNode) => void;
    selectedNodeId?: string;
    mode?: 'edit' | 'pyramid';
}

function SortableNodeWrapper({ node, level, onEdit, onDelete, onReorder, onToggleCollapse, isCollapsed, onSelectNode, selectedNodeId, isRoot = false }: any) {
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
                <GripVertical className="h-4 w-4 text-slate-400 hover:text-slate-700" aria-hidden="true" />
            </div>

            <TreeNode
                node={node}
                level={level}
                onEdit={onEdit}
                onDelete={onDelete}
                onReorder={onReorder}
                onToggleCollapse={onToggleCollapse}
                isCollapsed={isCollapsed}
                onSelectNode={onSelectNode}
                selectedNodeId={selectedNodeId}
            />
        </div>
    );
}

function TreeNode({ node, level, onEdit, onDelete, onReorder, onToggleCollapse, isCollapsed, onSelectNode, selectedNodeId }: any) {
    const hasChildren = node.children.length > 0;
    const collapsed = isCollapsed(node.id);
    const isSelected = node.id === selectedNodeId;
    const depthColor = DEPTH_COLORS[level % DEPTH_COLORS.length];

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-1.5">
                {hasChildren ? (
                    <button
                        type="button"
                        onClick={() => onToggleCollapse(node.id)}
                        className="p-0.5 rounded hover:bg-slate-200 text-slate-500"
                        title={collapsed ? '展開' : '收合'}
                    >
                        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                ) : (
                    <span className="w-5" />
                )}
                {node.onValue && (
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-orange-500/5 text-orange-600 border-orange-500/20 font-bold">
                        當值為: {node.onValue === 'input' ? '自訂輸入' : node.onValue} 時觸發
                    </Badge>
                )}
                {node.relationType === 'quantity' && (
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-blue-100 text-blue-700 border-blue-300 font-bold animate-in fade-in">
                        數量複製
                    </Badge>
                )}
            </div>

            <div
                data-node-id={node.id}
                onClick={() => onSelectNode?.(node)}
                title="點選以兩側同步高亮"
                className={cn('rounded-lg border-l-4 pl-3 cursor-pointer hover:bg-accent/40 transition-colors', node.relationType === 'quantity' ? 'border-l-blue-500 bg-blue-50/50' : depthColor, isSelected && 'ring-2 ring-primary rounded-md')}
            >
                <SpecCard
                    spec={node.spec}
                    onEdit={onEdit}
                    onDelete={(spec) => onDelete(spec, node.parentId, node.relationType)}
                    showRelations={false}
                />
            </div>

            {/* 分歧主幹：多個子節點共享一條分支線，清楚表現「從同一父節點分出」 */}
            {hasChildren && !collapsed && (
                <div className="ml-5 border-l-2 border-dashed border-primary/25 pl-5 space-y-3">
                    <SortableContext items={node.children.map((c: any) => c.id)} strategy={verticalListSortingStrategy}>
                        {node.children.map((child: any) => (
                            <SortableNodeWrapper
                                key={child.id}
                                node={child}
                                level={level + 1}
                                onEdit={onEdit}
                                onDelete={onDelete}
                                onReorder={onReorder}
                                onToggleCollapse={onToggleCollapse}
                                isCollapsed={isCollapsed}
                                onSelectNode={onSelectNode}
                                selectedNodeId={selectedNodeId}
                            />
                        ))}
                    </SortableContext>
                </div>
            )}

            {hasChildren && collapsed && (
                <button
                    type="button"
                    onClick={() => onToggleCollapse(node.id)}
                    className="ml-5 text-[11px] text-muted-foreground hover:text-primary"
                >
                    展開 {node.children.length} 個子項目
                </button>
            )}
        </div>
    );
}

export function TreeView({ treeData, onEdit, onDelete, onReorder, onSelectNode, selectedNodeId, mode = 'edit' }: TreeViewProps) {
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
    );
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

    const toggleCollapse = (id: string) => {
        setCollapsedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };
    const isCollapsed = (id: string) => collapsedIds.has(id);

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

    if (mode === 'pyramid') {
        return (
            <div className="pb-10 animate-in fade-in zoom-in-95 duration-400">
                <PyramidView
                    treeData={treeData}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onReorder={onReorder}
                    onSelectNode={onSelectNode}
                    selectedNodeId={selectedNodeId}
                    isCollapsed={isCollapsed}
                    onToggleCollapse={toggleCollapse}
                />
            </div>
        );
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
                            onToggleCollapse={toggleCollapse}
                            isCollapsed={isCollapsed}
                            onSelectNode={onSelectNode}
                            selectedNodeId={selectedNodeId}
                            isRoot
                        />
                    ))}
                </SortableContext>
            </div>
        </DndContext>
    );
}

function PyramidNode({ node, level, onEdit, onDelete, onReorder, onToggleCollapse, isCollapsed, onSelectNode, selectedNodeId }: any) {
    const hasChildren = node.children.length > 0;
    const collapsed = isCollapsed(node.id);
    const isSelected = node.id === selectedNodeId;
    const depthColor = DEPTH_COLORS[level % DEPTH_COLORS.length];

    return (
        <div className="flex flex-col items-center">
            <div className="flex items-center gap-1.5">
                {hasChildren ? (
                    <button
                        type="button"
                        onClick={() => onToggleCollapse(node.id)}
                        className="p-0.5 rounded hover:bg-slate-200 text-slate-500"
                        title={collapsed ? '展開' : '收合'}
                    >
                        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                ) : (
                    <span className="w-5" />
                )}
                {node.onValue && (
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-orange-500/5 text-orange-600 border-orange-500/20 font-bold">
                        當值為: {node.onValue === 'input' ? '自訂輸入' : node.onValue} 時觸發
                    </Badge>
                )}
                {node.relationType === 'quantity' && (
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-blue-100 text-blue-700 border-blue-300 font-bold animate-in fade-in">
                        數量複製
                    </Badge>
                )}
            </div>

            <div
                data-node-id={node.id}
                onClick={() => onSelectNode?.(node)}
                title="點選以兩側同步高亮"
                className={cn('rounded-lg border-l-4 pl-3 cursor-pointer hover:bg-accent/40 transition-colors', node.relationType === 'quantity' ? 'border-l-blue-500 bg-blue-50/50' : depthColor, isSelected && 'ring-2 ring-primary rounded-md')}
            >
                <SpecCard
                    spec={node.spec}
                    onEdit={onEdit}
                    onDelete={(spec) => onDelete(spec, node.parentId, node.relationType)}
                    showRelations={false}
                />
            </div>

            {hasChildren && !collapsed && (
                <>
                    <div className="w-px h-4 bg-primary/30" />
                    <div className="relative flex items-start justify-center gap-6">
                        {/* 水平連接線：連接到每個子節點頂端的垂直線 */}
                        <div className="absolute top-0 left-0 right-0 h-px bg-primary/30" />
                        {node.children.map((child: any) => (
                            <div key={child.id} className="relative flex flex-col items-center pt-4">
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-4 bg-primary/30" />
                                <PyramidNode
                                    node={child}
                                    level={level + 1}
                                    onEdit={onEdit}
                                    onDelete={onDelete}
                                    onReorder={onReorder}
                                    onToggleCollapse={onToggleCollapse}
                                    isCollapsed={isCollapsed}
                                    onSelectNode={onSelectNode}
                                    selectedNodeId={selectedNodeId}
                                />
                            </div>
                        ))}
                    </div>
                </>
            )}

            {hasChildren && collapsed && (
                <button
                    type="button"
                    onClick={() => onToggleCollapse(node.id)}
                    className="mt-1 text-[11px] text-muted-foreground hover:text-primary"
                >
                    展開 {node.children.length} 個子項目
                </button>
            )}
        </div>
    );
}

function PyramidView({ treeData, onEdit, onDelete, onReorder, onSelectNode, selectedNodeId, isCollapsed, onToggleCollapse }: any) {
    return (
        <div className="min-w-max mx-auto flex flex-col items-center">
            {treeData.map((root: any) => (
                <PyramidNode
                    key={root.id}
                    node={root}
                    level={0}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onReorder={onReorder}
                    onToggleCollapse={onToggleCollapse}
                    isCollapsed={isCollapsed}
                    onSelectNode={onSelectNode}
                    selectedNodeId={selectedNodeId}
                />
            ))}
        </div>
    );
}
