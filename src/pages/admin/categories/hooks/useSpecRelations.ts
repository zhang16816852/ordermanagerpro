import { useMemo } from 'react';
import { SpecDefinition } from '../types';

export interface SpecRelationInfo {
    isSource: boolean;
    isTarget: boolean;
    parentNames: string[];
    parentIds: string[];
}

export interface SpecTreeNode {
    id: string;
    spec: SpecDefinition;
    children: SpecTreeNode[];
    onValue?: string; // 觸發條件
}

/**
 * v4.10 規格關聯 Hook：計算全域規格的父子與樹狀結構
 */
export function useSpecRelations(specDefinitions: SpecDefinition[]) {
    
    // 1. 計算基本關聯地圖 (Source/Target/Parents)
    const relations = useMemo(() => {
        const map = new Map<string, SpecRelationInfo>();
        
        // 初始化
        specDefinitions.forEach(s => map.set(s.id, { 
            isSource: false, 
            isTarget: false, 
            parentNames: [],
            parentIds: []
        }));

        // 遍歷所有規格的 Triggers
        specDefinitions.forEach(s => {
            const triggers = s.logic_config?.triggers || [];
            if (triggers.length > 0) {
                const info = map.get(s.id);
                if (info) info.isSource = true;

                triggers.forEach((t: any) => {
                    const targets = t.targets || t.target_ids?.map((id: string) => ({ id })) || [];
                    targets.forEach((tar: any) => {
                        const targetInfo = map.get(tar.id);
                        if (targetInfo) {
                            targetInfo.isTarget = true;
                            if (!targetInfo.parentIds.includes(s.id)) {
                                targetInfo.parentIds.push(s.id);
                                targetInfo.parentNames.push(s.name);
                            }
                        }
                    });
                });
            }
        });

        return map;
    }, [specDefinitions]);

    // 2. 構建遞迴樹狀結構 (Tree Data)
    const treeData = useMemo(() => {
        if (specDefinitions.length === 0) return [];

        const visited = new Set<string>();
        const specMap = new Map<string, SpecDefinition>();
        specDefinitions.forEach(s => specMap.set(s.id, s));

        // 遞迴構建節點
        const buildNode = (specId: string, onValue?: string): SpecTreeNode | null => {
            const spec = specMap.get(specId);
            if (!spec) return null;

            const node: SpecTreeNode = {
                id: specId,
                spec: spec,
                children: [],
                onValue
            };

            // 找該規格的所有觸發目標
            spec.logic_config?.triggers?.forEach((t: any) => {
                const targets = t.targets || t.target_ids?.map((id: string) => ({ id })) || [];
                targets.forEach((tar: any) => {
                    const childNode = buildNode(tar.id, t.on_value);
                    if (childNode) node.children.push(childNode);
                });
            });

            return node;
        };

        // 找出所有根項 (不是任何人的 Target)
        const roots = specDefinitions.filter(s => {
            const rel = relations.get(s.id);
            return !rel?.isTarget;
        });

        return roots.map(root => buildNode(root.id)).filter(Boolean) as SpecTreeNode[];
    }, [specDefinitions, relations]);

    return { relations, treeData };
}
