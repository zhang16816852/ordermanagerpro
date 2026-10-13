import { SalesNoteDetailDialog, type SalesNoteDetail } from "@/components/sales/SalesNoteDetailDialog";
import { SalesNoteBatchPaymentDialog, type BatchEligibleNote } from "@/components/sales/SalesNoteBatchPaymentDialog";
import { CustomerStatementDialog } from "@/components/sales/CustomerStatementDialog";
import { DocImportDialog } from "@/components/orders/DocImportDialog";
import type { SalesNoteRow } from "./salesNotesTypes";

interface SalesNotesDialogsProps {
  selectedNote: SalesNoteRow | null;
  dialogData: SalesNoteDetail | null;
  onCloseDetail: () => void;
  isRep: boolean;
  batchPaymentOpen: boolean;
  onBatchPaymentOpenChange: (open: boolean) => void;
  batchEligibleNotes: BatchEligibleNote[];
  onBatchCompleted: () => void;
  importOpen: boolean;
  onImportOpenChange: (open: boolean) => void;
  statementOpen: boolean;
  onStatementOpenChange: (open: boolean) => void;
}

export function SalesNotesDialogs({
  selectedNote,
  dialogData,
  onCloseDetail,
  isRep,
  batchPaymentOpen,
  onBatchPaymentOpenChange,
  batchEligibleNotes,
  onBatchCompleted,
  importOpen,
  onImportOpenChange,
  statementOpen,
  onStatementOpenChange,
}: SalesNotesDialogsProps) {
  return (
    <>
      <SalesNoteDetailDialog
        open={!!selectedNote}
        onOpenChange={(open) => !open && onCloseDetail()}
        note={dialogData}
        enablePayment={true}
        enableCorrect={!isRep}
        parcelEditable={!isRep}
      />

      <SalesNoteBatchPaymentDialog
        open={batchPaymentOpen}
        onOpenChange={onBatchPaymentOpenChange}
        notes={batchEligibleNotes}
        onCompleted={onBatchCompleted}
      />

      <DocImportDialog
        kind="sales"
        open={importOpen}
        onOpenChange={onImportOpenChange}
      />

      <CustomerStatementDialog
        open={statementOpen}
        onOpenChange={onStatementOpenChange}
      />
    </>
  );
}
