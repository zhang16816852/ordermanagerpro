import { PurchaseOrderBatchBar } from './PurchaseOrderBatchBar';

interface Props {
  batchMode: boolean;
  onBatchModeChange: (on: boolean) => void;
  selectedCount: number;
  orderableCount: number;
  receivableCount: number;
  payableCount: number;
  canPay: boolean;
  isOrdering: boolean;
  isReceiving: boolean;
  isPaying: boolean;
  onOrder: () => void;
  onReceive: () => void;
  onPay: () => void;
  onClear: () => void;
}

export function PurchaseOrdersPageBatchSection(props: Props) {
  return <PurchaseOrderBatchBar {...props} />;
}