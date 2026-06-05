import { CategorySpec } from '@/hooks/useCategorySpecs';
import { deserializeSpecs } from './specSerializer';

export function formatSpecValue(val: any, spec?: CategorySpec, allSpecs?: CategorySpec[] | Map<string, CategorySpec>): string {
    if (val === null || val === undefined || val === '') return '';

    if (Array.isArray(val)) {
        if (val.length > 0 && typeof val[0] === 'object' && val[0] !== null && !Array.isArray(val[0])) {
            const config = spec?.configuration;
            const colSep = config?.columnSeparator || '/';
            const rowSep = config?.rowSeparator || ', ';

            return val.map((row: any) => {
                return (config?.columns || []).map((col: any) => {
                    const colVal = row[col.id || col.name];
                    if (colVal === undefined || colVal === null || colVal === '') return null;

                    let cellSuffix = col.suffix || '';
                    if (col.type === 'link' && col.linkedSpecId && allSpecs && !cellSuffix) {
                        const linkedSpec = Array.isArray(allSpecs)
                            ? allSpecs.find((s: any) => s.id === col.linkedSpecId)
                            : allSpecs.get(col.linkedSpecId);

                        if (linkedSpec && linkedSpec.type === 'number_with_unit' && linkedSpec.options?.length > 0) {
                            const unitMatch = linkedSpec.options[0].match(/(.+?)\((.+?)\)/);
                            cellSuffix = unitMatch ? unitMatch[2] : linkedSpec.options[0];
                        }
                    }

                    const formattedColVal = Array.isArray(colVal) ? colVal.join(',') : colVal;
                    return `${col.prefix || ''}${formattedColVal}${cellSuffix}`;
                }).filter(Boolean).join(colSep);
            }).filter((s: string) => s !== '').join(rowSep);
        }
        return val.join('/');
    }

    if (typeof val === 'object' && val !== null) {
        return Object.entries(val)
            .map(([label, value]) => {
                if (!value && value !== 0) return null;

                const unitMatch = label.match(/(.+?)\((.+?)\)/);
                if (unitMatch) {
                    const displayName = unitMatch[1];
                    const unit = unitMatch[2];
                    return `${displayName}:${value}${unit}`;
                }

                return `${label}:${value}`;
            })
            .filter(Boolean)
            .join(' / ');
    }

    if (val === 'true' || val === true || val === 'on') return '支援';
    if (val === 'false' || val === false) return '不支援';

    return String(val);
}

export function formatSpecsToCondensedString(
    settings: any,
    specNameMap: Record<string, string> = {},
    delimiter: string = ', '
): string {
    if (!settings) return '';

    const flatMap = deserializeSpecs(settings);

    return Object.entries(flatMap)
        .map(([pathKey, val]) => {
            const specId = pathKey.includes(':') ? pathKey.split(':').pop()! : pathKey;
            const name = specNameMap[specId] || specId;
            const formattedVal = formatSpecValue(val);

            if (!formattedVal) return null;
            return `${name}:${formattedVal}`;
        })
        .filter(Boolean)
        .join(delimiter);
}

export function getStaticSpecTree(specDefinitions: any[]): { spec: any; level: number; id: string }[] {
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

    const roots = specDefinitions.filter(s => !childToParent.has(s.id));

    const getChildren = (parentId: string): any[] => {
        return specDefinitions.filter(s => childToParent.get(s.id) === parentId);
    };

    const sorted: { spec: any; level: number; id: string }[] = [];
    const visited = new Set<string>();

    const traverse = (nodes: any[], level: number = 0, path: string = '') => {
        const sortedNodes = [...nodes].sort((a, b) => {
            if (a.sort_order !== b.sort_order) {
                return (a.sort_order || 0) - (b.sort_order || 0);
            }
            return a.name.localeCompare(b.name);
        });

        sortedNodes.forEach(node => {
            const currentPath = path ? `${path}>${node.id}` : node.id;

            const visitKey = `${currentPath}`;
            if (visited.has(visitKey)) return;
            visited.add(visitKey);

            sorted.push({ spec: node, level, id: currentPath });

            const children = getChildren(node.id);
            if (children.length > 0) {
                traverse(children, level + 1, currentPath);
            }
        });
    };

    traverse(roots, 0);
    return sorted;
}
