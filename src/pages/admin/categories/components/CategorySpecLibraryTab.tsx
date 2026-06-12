import React, { useState, useMemo } from 'react';
import { Check, Link as LinkIcon, ChevronRight, ChevronDown, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface CategorySpecLibraryTabProps {
    specDefinitions: any[];
    engine: {
        isSelected: (id: string) => boolean;
        isManual: (id: string) => boolean;
        toggle: (id: string) => void;
    };
}

interface TreeNode {
    spec: any;
    children: TreeNode[];
}

function buildSpecTree(specDefinitions: any[]): TreeNode[] {
    const childToParent = new Map<string, string>();
    specDefinitions.forEach(spec => {
        const triggers = spec.logic_config?.triggers || spec.logicConfig?.triggers;
        triggers?.forEach((t: any) => {
            const targets = t.targets || (t as any).target_ids?.map((tid: string) => ({ id: tid })) || [];
            targets.forEach((tar: any) => {
                if (!childToParent.has(tar.id)) {
                    childToParent.set(tar.id, spec.id);
                }
            });
        });
    });

    const roots = specDefinitions
        .filter(s => !childToParent.has(s.id))
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));

    const getChildren = (parentId: string): any[] =>
        specDefinitions
            .filter(s => childToParent.get(s.id) === parentId)
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));

    const buildTree = (specs: any[]): TreeNode[] =>
        specs.map(spec => ({ spec, children: buildTree(getChildren(spec.id)) }));

    return buildTree(roots);
}

function nodeOrDescendantMatches(node: TreeNode, searchLower: string): boolean {
    if (!searchLower) return true;
    if (node.spec.name.toLowerCase().includes(searchLower)) return true;
    return node.children.some(child => nodeOrDescendantMatches(child, searchLower));
}

const SpecTreeNode = ({ node, level, engine, searchLower, expandedIds, onToggleExpand }: {
    node: TreeNode;
    level: number;
    engine: any;
    searchLower: string;
    expandedIds: Set<string>;
    onToggleExpand: (id: string) => void;
}) => {
    const { spec, children } = node;
    const isSelected = engine.isSelected(spec.id);
    const isManual = engine.isManual(spec.id);
    const hasChildren = children.length > 0;
    const isRoot = level === 0;
    const isExpanded = expandedIds.has(spec.id);

    if (searchLower && !nodeOrDescendantMatches(node, searchLower)) return null;

    const visibleChildren = searchLower
        ? children.filter(c => nodeOrDescendantMatches(c, searchLower))
        : children;

    return (
        <div>
            <div
                onClick={() => isRoot && engine.toggle(spec.id)}
                className={`
                    flex items-center justify-between p-3 rounded-lg border transition-all mb-0.5
                    ${isSelected
                        ? (isManual ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-100' : 'bg-slate-100 border-slate-200 opacity-80')
                        : 'bg-white hover:border-slate-300 hover:shadow-sm'
                    }
                    ${isRoot ? 'cursor-pointer' : ''}
                `}
            >
                <div className="flex items-center gap-2 min-w-0">
                    {hasChildren ? (
                        <button
                            onClick={(e) => { e.stopPropagation(); onToggleExpand(spec.id); }}
                            className="p-0.5 hover:bg-slate-100 rounded shrink-0"
                        >
                            {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                        </button>
                    ) : (
                        <div className="w-5 h-5 shrink-0" />
                    )}
                    {!isRoot && <LinkIcon className="h-3 w-3 text-slate-300 shrink-0" />}
                    <div className="flex flex-col min-w-0">
                        <span className={`text-sm font-medium truncate ${isSelected && isManual ? 'text-blue-700' : 'text-slate-700'}`}>
                            {spec.name}
                        </span>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider truncate">
                            {spec.type}
                            {!isRoot && ' (連動)'}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {isSelected && (
                        isManual ? <Check className="h-4 w-4 text-blue-600" /> : <LinkIcon className="h-3 w-3 text-slate-400 animate-pulse" />
                    )}
                </div>
            </div>
            {hasChildren && isExpanded && visibleChildren.length > 0 && (
                <div className="ml-5 pl-2 border-l-2 border-slate-100 mb-0.5">
                    {visibleChildren.map(child => (
                        <SpecTreeNode
                            key={child.spec.id}
                            node={child}
                            level={level + 1}
                            engine={engine}
                            searchLower={searchLower}
                            expandedIds={expandedIds}
                            onToggleExpand={onToggleExpand}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export const CategorySpecLibraryTab = ({ specDefinitions, engine }: CategorySpecLibraryTabProps) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    const tree = useMemo(() => buildSpecTree(specDefinitions), [specDefinitions]);

    const toggleExpand = (id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const searchLower = searchQuery.toLowerCase();

    const effectiveExpandedIds = useMemo(() => {
        if (!searchLower) return expandedIds;
        const ids = new Set(expandedIds);
        const traverse = (nodes: TreeNode[]) => {
            nodes.forEach(node => {
                if (node.children.some(c => nodeOrDescendantMatches(c, searchLower))) {
                    ids.add(node.spec.id);
                    traverse(node.children);
                }
            });
        };
        traverse(tree);
        return ids;
    }, [searchLower, tree, expandedIds]);

    const hasVisibleResults = !searchLower || tree.some(node => nodeOrDescendantMatches(node, searchLower));

    return (
        <div className="flex flex-col gap-1 p-4 flex-1 min-h-0 overflow-y-auto bg-slate-50/30">
            <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                    placeholder="搜尋規格..."
                    className="pl-8 h-9 text-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                    <X
                        className="absolute right-2.5 top-2.5 h-4 w-4 text-slate-400 cursor-pointer hover:text-slate-600"
                        onClick={() => setSearchQuery('')}
                    />
                )}
            </div>
            <div className="flex flex-col">
                {tree.map(node => (
                    <SpecTreeNode
                        key={node.spec.id}
                        node={node}
                        level={0}
                        engine={engine}
                        searchLower={searchLower}
                        expandedIds={effectiveExpandedIds}
                        onToggleExpand={toggleExpand}
                    />
                ))}
            </div>
            {specDefinitions.length === 0 && (
                <div className="p-12 text-center text-muted-foreground italic">尚未建立任何規格定義</div>
            )}
            {specDefinitions.length > 0 && !hasVisibleResults && (
                <div className="p-12 text-center text-muted-foreground italic">無符合的規格</div>
            )}
        </div>
    );
};
