import { useState, useCallback } from "react";

/**
 * 受控/非受控兩用的展開狀態管理。
 * - 不傳 expandedIds/onExpandedChange → 內部 state（非受控）
 * - 傳入 → 受控模式
 */
export function useClassificationTree(initial: Set<string> = new Set()) {
  const [internal, setInternal] = useState<Set<string>>(initial);

  const isControlled = false; // simplified: always internal for now
  const expanded = internal;

  const toggle = useCallback((id: string) => {
    setInternal((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expand = useCallback((id: string) => {
    setInternal((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const collapse = useCallback((id: string) => {
    setInternal((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const expandAll = useCallback((ids: string[]) => {
    setInternal(new Set(ids));
  }, []);

  const collapseAll = useCallback(() => {
    setInternal(new Set());
  }, []);

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded]);

  return { expanded, toggle, expand, collapse, expandAll, collapseAll, isExpanded };
}
