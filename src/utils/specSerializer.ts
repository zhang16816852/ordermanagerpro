import { CategorySpec } from '@/hooks/useCategorySpecs';

export interface SpecEntry {
    spec_id: string;
    parent_id: string | 'root';
    instance_uuid: string;
    value: any;
}

export function generateStableUUID(seed: string): string {
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    const h = (hash >>> 0).toString(16).padStart(8, '0');
    return (
        h.substring(0, 8) + '-' +
        h.substring(0, 4) + '-4' +
        h.substring(1, 4) + '-a' +
        h.substring(2, 5) + '-' +
        (Math.abs(hash) * 9301 + 49297).toString(16).padStart(12, '0').substring(0, 12)
    );
}

export function deserializeSpecs(data: any): Record<string, any> {
    const obj: Record<string, any> = {};
    if (!data) return obj;

    if (Array.isArray(data)) {
        data.forEach((entry: any) => {
            const specId = entry.spec_id || entry.id;
            const parentId = entry.parent_id || entry.parentId || 'root';
            const instanceUuid = entry.instance_uuid || entry.instanceUuid || specId;

            const key = `${parentId}:${specId}:${instanceUuid}`;
            obj[key] = entry.value;
        });
    } else if (typeof data === 'object') {
        const keys = Object.keys(data);
        if (keys.length > 0 && keys[0].includes(':')) return { ...data };
        Object.entries(data).forEach(([id, val]) => {
            if (id === '_metadata') return;
            obj[`root:${id}:${id}`] = val;
        });
    }
    return obj;
}

export function getSpecValue(data: any, specId: string): any {
    if (!data) return undefined;
    if (Array.isArray(data)) {
        const found = data.find((s: SpecEntry) => (s as any).spec_id === specId || (s as any).id === specId);
        return found?.value;
    }
    return data[specId];
}

export function serializeSpecs(
    pathObj: Record<string, any>,
    specMap: Map<string, CategorySpec>
): any[] {
    const entries: any[] = [];
    if (!pathObj) return entries;

    Object.entries(pathObj).forEach(([pathKey, value]) => {
        if (value === undefined || value === null || value === '') return;

        const parts = pathKey.split(':');
        const parentId = parts[0];
        const specId = parts[1];
        const instanceUuid = parts[2] || specId;

        if (!specId) return;

        const spec = specMap.get(specId);
        if (!spec) return;

        entries.push({
            spec_id: specId,
            parent_id: parentId === 'root' ? null : parentId,
            instance_uuid: instanceUuid,
            value: value,
            display_order: 0
        });
    });

    return entries;
}
