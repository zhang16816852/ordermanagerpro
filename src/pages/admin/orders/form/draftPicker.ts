import type { OrderDraft } from '@/store/useOrderDraftStore';

export type DraftKind = 'sales' | 'purchase' | 'consignment_receive' | 'consignment_send';

const NEW_PREFIX = '_admin_new_';
const EDIT_PREFIX = '_edit_';
const KINDS: DraftKind[] = ['sales', 'purchase', 'consignment_receive', 'consignment_send'];

export const DRAFT_KIND_LABELS: Record<DraftKind, string> = {
  sales: '銷售訂單',
  purchase: '採購單',
  consignment_receive: '寄賣收貨',
  consignment_send: '寄賣出貨',
};

export interface DraftContext {
  key: string;
  kind: DraftKind;
  storeId?: string;
}

export interface DraftRow {
  key: string;
  context: DraftContext;
  draft: OrderDraft;
  itemCount: number;
  totalAmount: number;
  isStoreDraft: boolean;
}

// 由 draftKey 推導所屬情境；`_edit_*` 為暫時性草稿，不列入清單
export function parseDraftKey(key: string): DraftContext | null {
  if (key.startsWith(EDIT_PREFIX)) return null;
  if (key.startsWith(NEW_PREFIX)) {
    const kind = key.slice(NEW_PREFIX.length) as DraftKind;
    return KINDS.includes(kind) ? { key, kind } : null;
  }
  return { key, kind: 'sales', storeId: key };
}

export function draftTotal(draft: OrderDraft): number {
  return draft.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

// 過濾空草稿（切換分頁產生的噪音），依 updatedAt 新→舊排序
export function selectDraftRows(drafts: Record<string, OrderDraft>): DraftRow[] {
  return Object.entries(drafts)
    .map(([key, draft]) => ({ key, context: parseDraftKey(key), draft }))
    .filter(
      (r): r is { key: string; context: DraftContext; draft: OrderDraft } => r.context !== null,
    )
    .filter((r) => r.draft.items.length > 0 || r.draft.notes.trim() !== '')
    .map((r) => ({
      key: r.key,
      context: r.context,
      draft: r.draft,
      itemCount: r.draft.items.reduce((sum, item) => sum + item.quantity, 0),
      totalAmount: draftTotal(r.draft),
      isStoreDraft: !!r.context.storeId,
    }))
    .sort((a, b) => b.draft.updatedAt - a.draft.updatedAt);
}
