import React from 'react';
import { SpecDefinition } from '../../types';
import { SpecTreeNode } from '../../hooks/useSpecRelations';
import { SpecCard } from './SpecCard';
import { CornerDownRight, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface TreeViewProps {
    treeData: SpecTreeNode[];
    onEdit: (spec: SpecDefinition) => void;
    onDelete: (spec: SpecDefinition) => void;
}

/**
 * v4.10 規格樹節點元件 (遞迴渲染)
 */
function TreeNode({ node, level, onEdit, onDelete }: { 
    node: SpecTreeNode; 
    level: number; 
    onEdit: (spec: SpecDefinition) => void; 
    onDelete: (spec: SpecDefinition) => void;
}) {
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
                            onDelete={onDelete} 
                            showRelations={false} // 樹狀模式下不需要 Badge Relations
                        />
                    </div>
                    
                    {/* 遞迴渲染子節點 */}
                    {node.children.length > 0 && (
                        <div className="pt-2 animate-in fade-in duration-500">
                            {node.children.map((child, idx) => (
                                <TreeNode 
                                    key={`${child.id}-${idx}`} 
                                    node={child} 
                                    level={level + 1} 
                                    onEdit={onEdit} 
                                    onDelete={onDelete} 
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export function TreeView({ treeData, onEdit, onDelete }: TreeViewProps) {
    if (treeData.length === 0) {
        return <div className="py-20 text-center animate-pulse text-muted-foreground">目前查無規格邏輯樹。</div>;
    }

    return (
        <div className="space-y-12 pb-20 animate-in fade-in zoom-in-95 duration-400">
            {treeData.map((root, idx) => (
                <div key={`${root.id}-${idx}`} className="p-6 border rounded-2xl bg-muted/5 shadow-inner">
                    <div className="mb-6 flex items-center gap-2">
                        <Badge className="bg-primary/10 text-primary border-primary/20">獨立邏輯根節點</Badge>
                    </div>
                    <TreeNode node={root} level={0} onEdit={onEdit} onDelete={onDelete} />
                </div>
            ))}
        </div>
    );
}
