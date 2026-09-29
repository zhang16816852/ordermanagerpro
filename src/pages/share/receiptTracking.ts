/** 由分享 RPC 的 shipments[] 取出追蹤單號（去重、去除空值） */
export function receiptTrackingNumbers(
  shipments?: { tracking_number?: string | null }[] | null,
): string[] {
  if (!shipments) return [];
  return Array.from(
    new Set(shipments.map((s) => s?.tracking_number).filter((n): n is string => !!n)),
  );
}
