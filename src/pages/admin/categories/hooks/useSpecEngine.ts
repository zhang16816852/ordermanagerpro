import { useRef, useSyncExternalStore, useCallback, useEffect } from 'react';
import { SpecEngine, SpecData, ID, SpecSource } from '@/utils/SpecEngine';

/**
 * SpecEngine 門面 Hook
 * 封裝了單一真理來源的訂閱邏輯與穩定 API
 */
export function useSpecEngine(specDefinitions: SpecData[]) {
    // 1. 穩定實例
    const engineRef = useRef<SpecEngine>(new SpecEngine(specDefinitions));

    // 2. 規格庫同步
    useEffect(() => {
        engineRef.current.updateDefinitions(specDefinitions);
    }, [specDefinitions]);

    // 3. 訂閱狀態變更 (原子化觸發)
    const engineState = useSyncExternalStore(
        useCallback((onStoreChange) => engineRef.current.subscribe(onStoreChange), []),
        useCallback(() => engineRef.current.getSnapshot(), [])
    );

    // 4. 封裝穩定 API (防止 UI 重複渲染時引用失效)
    const api = {
        select: useCallback((id: ID, source?: SpecSource) => engineRef.current.select(id, source), []),
        deselect: useCallback((id: ID, source?: SpecSource) => engineRef.current.deselect(id, source), []),
        toggle: useCallback((id: ID) => engineRef.current.toggle(id), []),
        setSortOrder: useCallback((id: ID, order: number) => engineRef.current.setSortOrder(id, order), []),
        restore: useCallback((snapshot: any) => engineRef.current.restore(snapshot), []),
        bulkUpdate: useCallback((ids: ID[]) => engineRef.current.bulkUpdate(ids), []),
        
        // 查詢類 (基於快取)
        isManual: useCallback((id: ID) => engineRef.current.isManual(id), []),
        isSelected: useCallback((id: ID) => engineRef.current.isSelected(id), []),
        getSources: useCallback((id: ID) => engineRef.current.getSources(id), []),
    };

    // 5. 導出反應式數據 (已排序且包含快取來源)
    const selectedSpecs = engineRef.current.getSelectedSpecs();
    
    // 為了讓 UI 更方便，我們預先組合包含 sources 的完整對象
    const activeConfiguration = selectedSpecs.map(spec => ({
        ...spec,
        sources: engineRef.current.getSources(spec.id)
    }));

    return {
        engine: api,
        activeConfiguration,
        // 原生數據備查
        rawState: engineState
    };
}
