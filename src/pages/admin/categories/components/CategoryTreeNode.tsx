import { Button } from '@/components/ui/button';
import { Plus, Pencil, Trash2, FolderTree, ChevronRight, ChevronDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';

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
}: CategoryTreeNodeProps) {
    const queryClient = useQueryClient();
    const isExpanded = expandedIds.has(node.id);
    const hasChildren = node.children.length > 0;
    const linkedSpecsCount = categorySpecLinks.filter((l: any) => l.category_id === node.id).length;
    const uniqueKey = `${path}-${node.id}`;

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
        <div key={uniqueKey} className="space-y-1">
            <div
                className="flex items-center group py-2 px-3 hover:bg-muted/50 rounded-lg border border-transparent hover:border-border transition-colors cursor-pointer"
                style={{ marginLeft: `${level * 24}px` }}
                onClick={toggleExpand}
            >
                <div className="flex items-center gap-2 flex-1">
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
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
