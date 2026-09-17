import { useState } from "react";
import { ChevronRight, ChevronDown, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionSkeleton, EmptyState } from "./sidebarPrimitives";
import { CategoryFilterSectionProps } from "./catalogSidebarTypes";

export function CategoryFilterSection({
    open,
    onOpenChange,
    specsLoading,
    categories,
    categoryTree,
    selectedCategory,
    onCategoryChange,
}: CategoryFilterSectionProps) {
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

    const toggleExpand = (id: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const renderCategoryNode = (node: any, level = 0, path = "root") => {
        const isSelected = selectedCategory === node.id;
        const isExpanded = expandedCategories.has(node.id);
        const hasChildren = node.children.length > 0;
        const uniqueKey = `${path}-${node.id}`;
        return (
            <div key={uniqueKey} className="space-y-1">
                <div className="flex items-center gap-1 group">
                    {hasChildren ? (
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => toggleExpand(node.id)}>
                            <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", !isExpanded && "-rotate-90")} />
                        </Button>
                    ) : (
                        <div className="w-6" />
                    )}
                    <button
                        onClick={() => onCategoryChange(node.id)}
                        className={cn(
                            "flex-1 flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors",
                            isSelected
                                ? "bg-primary text-primary-foreground font-medium"
                                : "hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <span className="truncate">{node.name}</span>
                        {isSelected && <ChevronRight className="h-3 w-3" />}
                    </button>
                </div>
                {isExpanded && hasChildren && (
                    <div className="pl-4 border-l ml-6 space-y-1">
                        {node.children.map((child: any) => renderCategoryNode(child, level + 1, node.id))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <Collapsible open={open} onOpenChange={onOpenChange}>
            <div className="pb-2">
                <SectionHeader
                    label="產品分類"
                    isOpen={open}
                    icon={FolderOpen}
                />
            </div>
            <CollapsibleContent>
                {specsLoading && categories.length === 0 ? (
                    <SectionSkeleton rows={5} />
                ) : (
                    <div className="space-y-1 pb-3">
                        <button
                            onClick={() => onCategoryChange(null)}
                            className={cn(
                                "w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors mb-1",
                                selectedCategory === null
                                    ? "bg-primary text-primary-foreground font-medium"
                                    : "hover:bg-muted/60 text-muted-foreground hover:text-foreground border border-transparent"
                            )}
                        >
                            <span>全部產品</span>
                            {selectedCategory === null && <ChevronRight className="h-3 w-3" />}
                        </button>
                        {categoryTree.map((node) => renderCategoryNode(node))}
                        {categories.length === 0 && (
                            <EmptyState icon={FolderOpen} text="尚未建立分類" />
                        )}
                    </div>
                )}
            </CollapsibleContent>
            <Separator />
        </Collapsible>
    );
}