export type ID = string;

export type SpecSource = 
  | { type: 'manual' }
  | { type: 'parent', id: ID }
  | { type: 'system' };

export interface SpecData {
    id: ID;
    name: string;
    type: string;
    logicConfig?: any;
    [key: string]: any;
}

export interface SelectedState {
    manual: boolean;
    sources: Set<string>;
    sortOrder: number;
}

/**
 * SpecEngine v5.4 - 工業級門面快取版
 */
export class SpecEngine {
    private specsById = new Map<ID, SpecData>();
    private idToChildren = new Map<ID, ID[]>();
    private idToParents = new Map<ID, ID[]>();
    private selectedSpecs = new Map<ID, SelectedState>();
    private executionOrder: ID[] = [];
    private listeners = new Set<() => void>();
    private sourcesCache = new Map<ID, SpecSource[]>();
    private lastSnapshot: any = { selected: {} };

    constructor(specs: SpecData[]) {
        this.initializeGraph(specs);
        this.recalculateSnapshot();
    }

    public updateDefinitions(specs: SpecData[]) {
        this.initializeGraph(specs);
        this.validateConsistency();
        this.recalculateSourcesInternal();
        this.notify();
    }

    private initializeGraph(specs: SpecData[]) {
        this.specsById.clear();
        this.idToChildren.clear();
        this.idToParents.clear();

        specs.forEach(spec => {
            this.specsById.set(spec.id, spec);
            if (!this.idToChildren.has(spec.id)) this.idToChildren.set(spec.id, []);
            if (!this.idToParents.has(spec.id)) this.idToParents.set(spec.id, []);
        });

        specs.forEach(spec => {
            const triggers = spec.logic_config?.triggers || spec.logicConfig?.triggers || [];
            triggers.forEach((t: any) => {
                const targets = t.targets || (t as any).target_ids?.map((tid: string) => ({ id: tid })) || [];
                targets.forEach((tar: any) => {
                    if (this.specsById.has(tar.id)) {
                        this.idToChildren.get(spec.id)?.push(tar.id);
                        this.idToParents.get(tar.id)?.push(spec.id);
                    }
                });
            });
        });

        this.buildTopologicalOrder();
    }

    // --- 訂閱機制 ---

    public subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify() {
        const changed = this.recalculateSnapshot();
        if (changed) {
            this.listeners.forEach(l => l());
        }
    }

    private recalculateSnapshot(): boolean {
        const selected: Record<ID, { manual: boolean, sources: string[], sortOrder: number }> = {};
        this.selectedSpecs.forEach((state, id) => {
            selected[id] = {
                manual: state.manual,
                sources: Array.from(state.sources),
                sortOrder: state.sortOrder
            };
        });
        
        const nextSnapshot = { selected };
        if (JSON.stringify(nextSnapshot) === JSON.stringify(this.lastSnapshot)) {
            return false;
        }
        
        this.lastSnapshot = nextSnapshot;
        return true;
    }

    // --- 狀態恢復 ---

    public restore(snapshot: any) {
        this.selectedSpecs.clear();
        this.sourcesCache.clear();
        
        if (snapshot?.selected) {
            Object.entries(snapshot.selected).forEach(([id, data]: [string, any]) => {
                if (this.specsById.has(id)) {
                    this.selectedSpecs.set(id, {
                        manual: data.manual,
                        sources: new Set(data.sources),
                        sortOrder: data.sortOrder || 0
                    });
                }
            });
        }
        
        this.validateConsistency();
        this.recalculateSourcesInternal();
        this.notify();
    }

    public hydrate(snapshot: any) {
        this.restore(snapshot);
    }

    // --- 內部核心邏輯 ---

    private recalculateSourcesInternal() {
        this.selectedSpecs.forEach(state => state.sources.clear());
        this.sourcesCache.clear();

        const visited = new Set<string>();
        this.executionOrder.forEach(id => {
            const state = this.selectedSpecs.get(id);
            if (state && state.manual) {
                const children = this.idToChildren.get(id) || [];
                children.forEach(childId => {
                    this.internalSelect(childId, { type: 'parent', id }, visited);
                });
            }
        });

        this.selectedSpecs.forEach((state, id) => {
            if (!state.manual && state.sources.size === 0) {
                this.selectedSpecs.delete(id);
            }
        });

        this.selectedSpecs.forEach((state, id) => {
            this.updateNodeSourcesCache(id, state);
        });
    }

    private internalSelect(id: ID, source: SpecSource, visited: Set<string>) {
        if (!this.specsById.has(id)) return;
        const state = this.getOrInitState(id);
        const serialized = this.serializeSource(source);
        const visitKey = `${id}:${serialized}`;

        if (visited.has(visitKey)) return;
        visited.add(visitKey);

        let changed = false;
        if (source.type === 'manual') {
            if (!state.manual) {
                state.manual = true;
                changed = true;
            }
        } else {
            if (!state.sources.has(serialized)) {
                state.sources.add(serialized);
                changed = true;
            }
        }

        if (changed) this.updateNodeSourcesCache(id, state);

        const children = this.idToChildren.get(id) || [];
        children.forEach(childId => {
            this.internalSelect(childId, { type: 'parent', id }, visited);
        });
        return changed;
    }

    private internalDeselect(id: ID, source: SpecSource, visited: Set<string>) {
        if (!this.specsById.has(id)) return;
        const state = this.getOrInitState(id);
        const serialized = this.serializeSource(source);
        const visitKey = `${id}:${serialized}`;

        if (visited.has(visitKey)) return;
        visited.add(visitKey);

        let changed = false;
        if (source.type === 'manual') {
            if (state.manual) {
                state.manual = false;
                changed = true;
            }
        } else {
            if (state.sources.has(serialized)) {
                state.sources.delete(serialized);
                changed = true;
            }
        }

        const isOrphan = !state.manual && state.sources.size === 0;
        if (changed || isOrphan) {
            if (isOrphan) {
                this.selectedSpecs.delete(id);
                this.sourcesCache.delete(id);
            } else {
                this.updateNodeSourcesCache(id, state);
            }
            const children = this.idToChildren.get(id) || [];
            children.forEach(childId => {
                this.internalDeselect(childId, { type: 'parent', id }, visited);
            });
        }
        return changed;
    }

    private updateNodeSourcesCache(id: ID, state: SelectedState) {
        const sources: SpecSource[] = [];
        if (state.manual) sources.push({ type: 'manual' });
        state.sources.forEach(s => sources.push(this.deserializeSource(s)));
        this.sourcesCache.set(id, sources);
    }

    // --- 外部 API ---

    public select(id: ID, source: SpecSource = { type: 'manual' }) {
        if (this.internalSelect(id, source, new Set())) this.notify();
    }

    public deselect(id: ID, source: SpecSource = { type: 'manual' }) {
        if (this.internalDeselect(id, source, new Set())) this.notify();
    }

    public bulkUpdate(manualIds: ID[]) {
        this.selectedSpecs.forEach(state => state.manual = false);
        const visited = new Set<string>();
        manualIds.forEach(id => this.internalSelect(id, { type: 'manual' }, visited));
        this.recalculateSourcesInternal();
        this.notify();
    }

    public toggle(id: ID) {
        this.isManual(id) ? this.deselect(id) : this.select(id);
    }

    public setSortOrder(id: ID, order: number) {
        const state = this.selectedSpecs.get(id);
        if (state) {
            state.sortOrder = order;
            this.notify();
        }
    }

    public isSelected(id: ID): boolean {
        return this.selectedSpecs.has(id);
    }

    public isManual(id: ID): boolean {
        return this.selectedSpecs.get(id)?.manual || false;
    }

    public getSources(id: ID): SpecSource[] {
        return this.sourcesCache.get(id) || [];
    }

    public getSelectedSpecs() {
        return Array.from(this.selectedSpecs.keys())
            .map(id => ({
                id,
                isManual: this.selectedSpecs.get(id)!.manual,
                sortOrder: this.selectedSpecs.get(id)!.sortOrder
            }))
            .sort((a, b) => a.sortOrder - b.sortOrder);
    }

    public getSnapshot() {
        return this.lastSnapshot;
    }

    private validateConsistency() {
        const allIds = new Set(this.specsById.keys());
        this.selectedSpecs.forEach((_, id) => {
            if (!allIds.has(id)) {
                this.selectedSpecs.delete(id);
                this.sourcesCache.delete(id);
            }
        });
    }

    private getOrInitState(id: ID): SelectedState {
        let state = this.selectedSpecs.get(id);
        if (!state) {
            const currentMax = this.selectedSpecs.size > 0 
                ? Math.max(...Array.from(this.selectedSpecs.values()).map(s => s.sortOrder))
                : -1;
            state = { manual: false, sources: new Set(), sortOrder: currentMax + 1 };
            this.selectedSpecs.set(id, state);
        }
        return state;
    }

    private serializeSource(s: SpecSource): string {
        if (s.type === 'manual') return 'm:';
        if (s.type === 'system') return 's:';
        return `p:${(s as any).id}`;
    }

    private deserializeSource(s: string): SpecSource {
        if (s === 'm:') return { type: 'manual' };
        if (s === 's:') return { type: 'system' };
        if (s.startsWith('p:')) return { type: 'parent', id: s.substring(2) } as SpecSource;
        return { type: 'system' };
    }

    private buildTopologicalOrder() {
        const inDegree = new Map<ID, number>();
        const queue: ID[] = [];
        const order: ID[] = [];
        this.specsById.forEach((_, id) => inDegree.set(id, 0));
        this.idToChildren.forEach((children) => {
            children.forEach(childId => {
                inDegree.set(childId, (inDegree.get(childId) || 0) + 1);
            });
        });
        inDegree.forEach((degree, id) => {
            if (degree === 0) queue.push(id);
        });
        while (queue.length > 0) {
            const u = queue.shift()!;
            order.push(u);
            const children = this.idToChildren.get(u) || [];
            children.forEach(v => {
                const newDegree = inDegree.get(v)! - 1;
                inDegree.set(v, newDegree);
                if (newDegree === 0) queue.push(v);
            });
        }
        this.executionOrder = order;
    }
}
