import React from 'react';
import { Settings2, Link as LinkIcon, X, GripVertical, ChevronRight, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface SortableConfigItemProps {
    node: any;
    specDefinitions: any[];
    index: number;
    onToggle: (id: string) => void;
    onSortOrderChange: (id: string, order: number) => void;
    isRoot?: boolean;
}

const SortableConfigItem = ({ node, specDefinitions, index, onToggle, onSortOrderChange, isRoot }: SortableConfigItemProps) => {
    const { config, spec, children } = node;
    const [isExpanded, setIsExpanded] = React.useState(false); // 預設展開

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: config.id, disabled: !isRoot });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : 0,
        opacity: isDragging ? 0.5 : 1,
    };

    const hasChildren = children.length > 0;

    return (
        <div ref={setNodeRef} style={style} className="flex flex-col border-b last:border-b-0 bg-white">
            <div className="flex items-center gap-4 p-4 hover:bg-slate-50 transition-colors group">
                <div className="flex items-center gap-3">
                    {isRoot ? (
                        <div
                            {...attributes}
                            {...listeners}
                            className="p-1 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-600 transition-colors"
                        >
                            <GripVertical className="h-4 w-4" />
                        </div>
                    ) : (
                        <div className="w-6 h-6 flex items-center justify-center">
                            <LinkIcon className="h-3 w-3 text-slate-300" />
                        </div>
                    )}
                    <div className="flex flex-col items-center gap-1 min-w-[2.5rem]">
                        <span className="text-[10px] font-mono text-slate-400">#{index + 1}</span>
                        {isRoot && (
                            <Input
                                type="number"
                                className="h-7 w-14 text-center text-xs p-1"
                                value={config.sortOrder}
                                onChange={(e) => onSortOrderChange(config.id, parseInt(e.target.value) || 0)}
                            />
                        )}
                    </div>
                </div>

                <div className="flex-1 min-w-0 flex items-center gap-2">
                    {/* 展開收合按鈕 */}
                    {hasChildren && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-slate-400 hover:text-slate-600"
                            onClick={() => setIsExpanded(!isExpanded)}
                        >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                    )}

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <h4 className={`font-semibold truncate ${isRoot ? 'text-slate-900' : 'text-slate-600 text-sm'}`}>
                                {spec.name}
                            </h4>
                            {config.isManual ? (
                                <Badge variant="outline" className="text-[10px] h-4 px-1 border-blue-200 text-blue-600 bg-blue-50">MANUAL</Badge>
                            ) : (
                                <Badge variant="outline" className="text-[10px] h-4 px-1">PASSIVE</Badge>
                            )}
                        </div>
                        {isRoot && config.sources.length > 0 && config.sources.some((s: any) => s.type !== 'manual') && (
                            <div className="flex flex-wrap gap-1 mt-1">
                                {config.sources.map((src: any, i: number) => {
                                    if (src.type === 'manual') return null;
                                    return (
                                        <span key={i} className="inline-flex items-center text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                            <LinkIcon className="h-2 w-2 mr-1" />
                                            {src.name || 'Link'}
                                        </span>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-400 hover:text-destructive"
                        onClick={() => onToggle(config.id)}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* 子項目遞迴顯示 (受 isExpanded 控制) */}
            {hasChildren && isExpanded && (
                <div className="pl-12 pb-2 bg-slate-50/30 border-l-2 border-slate-100 ml-6 mb-2">
                    {children.map((childNode: any, childIdx: number) => (
                        <SortableConfigItem
                            key={childNode.config.id}
                            node={childNode}
                            specDefinitions={specDefinitions}
                            index={childIdx}
                            onToggle={onToggle}
                            onSortOrderChange={onSortOrderChange}
                            isRoot={false}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

interface CategorySelectedConfigTabProps {
    activeConfiguration: any[];
    specDefinitions: any[];
    engine: {
        toggle: (id: string) => void;
        setSortOrder: (id: string, order: number) => void;
        reorder: (newConfigs: any[]) => void;
    };
}

export const CategorySelectedConfigTab = ({
    activeConfiguration,
    specDefinitions,
    engine
}: CategorySelectedConfigTabProps) => {
    // 建立已選規格的樹狀結構
    const selectedTree = React.useMemo(() => {
        // 1. 獲取所有已選取規格的 ID 集合
        const selectedIds = new Set(activeConfiguration.map(c => c.id));

        const buildNode = (config: any): any => {
            const spec = specDefinitions.find(s => s.id === config.id);
            if (!spec) return null;

            // 2. 找出此規格的所有子規格（根據資料庫定義）
            const childrenSpecs = specDefinitions.filter(s => {
                const triggers = s.logic_config?.triggers || s.logicConfig?.triggers || [];
                return triggers.some((t: any) => {
                    const targets = t.targets || t.target_ids?.map((tid: string) => ({ id: tid })) || [];
                    return targets.some((tar: any) => tar.id === spec.id); // 這裡邏輯反了，應該是找以 spec 為 parent 的子項目
                });
            });

            // 修正：找出以目前 spec 為父節點的已選取規格
            const children = activeConfiguration
                .filter(c => {
                    const childSpec = specDefinitions.find(s => s.id === c.id);
                    const triggers = spec.logic_config?.triggers || spec.logicConfig?.triggers || [];
                    return triggers.some((t: any) => {
                        const targets = t.targets || t.target_ids?.map((tid: string) => ({ id: tid })) || [];
                        return targets.some((tar: any) => tar.id === c.id);
                    });
                })
                .map(c => buildNode(c))
                .filter(Boolean);

            return { config, spec, children };
        };

        // 3. 找出所有「在已選取集合中沒有父節點」的規格作為根節點
        return activeConfiguration
            .filter(c => {
                // 檢查是否有任何「已選取」的規格是我的父節點
                const hasSelectedParent = activeConfiguration.some(other => {
                    if (other.id === c.id) return false;
                    const parentSpec = specDefinitions.find(s => s.id === other.id);
                    const triggers = parentSpec?.logic_config?.triggers || parentSpec?.logicConfig?.triggers || [];
                    return triggers.some((t: any) => {
                        const targets = t.targets || t.target_ids?.map((tid: string) => ({ id: tid })) || [];
                        return targets.some((tar: any) => tar.id === c.id);
                    });
                });
                return !hasSelectedParent;
            })
            .map(c => buildNode(c))
            .filter(Boolean);
    }, [activeConfiguration, specDefinitions]);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5,
            },
        })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            // 1. 獲取目前樹狀結構中的根節點配置
            const rootConfigs = selectedTree.map(n => n.config);
            const oldIndex = rootConfigs.findIndex((i) => i.id === active.id);
            const newIndex = rootConfigs.findIndex((i) => i.id === over.id);

            // 2. 移動根節點
            const reorderedRoots = arrayMove(rootConfigs, oldIndex, newIndex);

            // 3. 更新所有受影響根節點的 sortOrder
            const updatedRoots = reorderedRoots.map((item, idx) => ({
                ...item,
                sortOrder: idx
            }));

            // 4. 找出所有非根節點的規格 (保持原樣，它們會根據樹狀邏輯自動跟隨父級)
            const rootIds = new Set(updatedRoots.map(r => r.id));
            const childConfigs = activeConfiguration.filter(c => !rootIds.has(c.id));

            // 5. 合併回完整的配置列表並通知引擎
            engine.reorder([...updatedRoots, ...childConfigs]);
        }
    };

    if (activeConfiguration.length === 0) {
        return (
            <div className="p-12 text-center text-muted-foreground space-y-2">
                <Settings2 className="h-12 w-12 mx-auto opacity-20" />
                <p>尚未選擇任何規格</p>
            </div>
        );
    }

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
        >
            <div className="max-h-[400px] overflow-y-auto">
                <SortableContext
                    items={selectedTree.map(n => n.config.id)}
                    strategy={verticalListSortingStrategy}
                >
                    <div className="flex flex-col">
                        {selectedTree.map((node, index) => (
                            <SortableConfigItem
                                key={node.config.id}
                                node={node}
                                specDefinitions={specDefinitions}
                                index={index}
                                onToggle={engine.toggle}
                                onSortOrderChange={engine.setSortOrder}
                                isRoot={true}
                            />
                        ))}
                    </div>
                </SortableContext>
            </div>
        </DndContext>
    );
};
