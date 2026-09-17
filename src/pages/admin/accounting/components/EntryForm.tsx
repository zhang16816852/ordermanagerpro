import { useEntryFormController } from './useEntryFormController';
import { EntryFormProps } from './EntryFormTypes';
import { EntryViewSwitcher } from './EntryViewSwitcher';
import { EntryPaymentModeFields } from './EntryPaymentModeFields';
import { EntryTransferFields } from './EntryTransferFields';
import { EntryDocListFields } from './EntryDocListFields';
import { EntryPayoutFields } from './EntryPayoutFields';
import { EntryShippingFields } from './EntryShippingFields';
import { EntryRepairFields } from './EntryRepairFields';
import { EntryCommonFields } from './EntryCommonFields';

export function EntryForm(props: EntryFormProps) {
  const ctl = useEntryFormController(props);

  return (
    <div className="space-y-4">
      {!ctl.isPaymentMode && <EntryViewSwitcher ctl={ctl} />}
      {ctl.isPaymentMode && ctl.paymentEntry && <EntryPaymentModeFields ctl={ctl} />}
      {ctl.isTransferLike && <EntryTransferFields ctl={ctl} />}
      {ctl.isList && <EntryDocListFields ctl={ctl} />}
      {ctl.isPayout && <EntryPayoutFields ctl={ctl} />}
      {ctl.isShipping && <EntryShippingFields ctl={ctl} />}
      {ctl.isRepair && <EntryRepairFields ctl={ctl} />}
      <EntryCommonFields ctl={ctl} />
    </div>
  );
}

export type {
  RepairAccountingSubType,
  RepairAccountingPrefill,
  EntryPrefill,
  PayoutSubmission,
  BatchPayoutSubmission,
  ShippingSettlementSubmission,
  DocType,
  DocItem,
  FormView,
} from './EntryFormTypes';