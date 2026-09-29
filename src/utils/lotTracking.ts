export type TrackingMode = 'none' | 'serial' | 'batch';

export type LotInput =
  | { mode: 'serial'; serials: string[] }
  | { mode: 'batch'; batch_number: string; unit_cost?: number };

export const TRACKING_MODE_LABELS: Record<TrackingMode, string> = {
  none: '不追蹤',
  serial: '一機一號（序號）',
  batch: '批號',
};

export function trackingModeOf(variant?: { tracking_mode?: TrackingMode } | null): TrackingMode {
  if (!variant?.tracking_mode) return 'none';
  return variant.tracking_mode;
}

export function parseSerials(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function isLotValid(input: LotInput | null | undefined, trackingMode: TrackingMode, quantity: number): boolean {
  if (!input) return false;
  if (trackingMode === 'serial') {
    return input.mode === 'serial' && Array.isArray(input.serials) && input.serials.length === quantity && input.serials.every((s) => s.trim().length > 0);
  }
  if (trackingMode === 'batch') {
    return input.mode === 'batch' && input.batch_number.trim().length > 0;
  }
  return true;
}