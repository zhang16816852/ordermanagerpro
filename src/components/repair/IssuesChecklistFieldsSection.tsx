import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CardContent } from '@/components/ui/card';
import { ChecklistEditor } from '@/components/repair/ChecklistEditor';
import { DeviceBlock, BlockUpdateProps } from './deviceBlockTypes';

export interface IssuesFieldsSectionProps extends BlockUpdateProps {
  showDiagnostic?: boolean;
  showInternalNotes?: boolean;
}

export function IssuesFieldsSection({ block, onChange, showDiagnostic = true, showInternalNotes = true }: IssuesFieldsSectionProps) {
  const set = (patch: Partial<DeviceBlock>) => onChange({ ...block, ...patch });
  return (
    <CardContent className="space-y-4">
      <div className="space-y-2">
        <Label>客戶描述問題</Label>
        <Textarea value={block.reported_issue} onChange={(e) => set({ reported_issue: e.target.value })} rows={3} placeholder="客戶描述的故障情況..." />
      </div>
      {showDiagnostic && (
        <div className="space-y-2">
          <Label>檢測結果</Label>
          <Textarea value={block.diagnostic_result} onChange={(e) => set({ diagnostic_result: e.target.value })} rows={3} placeholder="工程師檢測結果..." />
        </div>
      )}
      {showInternalNotes && (
        <div className="space-y-2">
          <Label>內部備註</Label>
          <Textarea value={block.internal_notes} onChange={(e) => set({ internal_notes: e.target.value })} rows={2} placeholder="不顯示在收據上的內部備註..." />
        </div>
      )}
    </CardContent>
  );
}

export interface ChecklistFieldsSectionProps extends BlockUpdateProps {
  suggestions: { appearance: string[]; functional: string[] };
}

export function ChecklistFieldsSection({ block, onChange, suggestions }: ChecklistFieldsSectionProps) {
  return (
    <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-2">
        <Label>外觀檢查</Label>
        <ChecklistEditor
          category="appearance"
          title="外觀檢查"
          items={block.appearanceChecklist}
          onItemsChange={(items) => onChange({ ...block, appearanceChecklist: items })}
          suggestions={suggestions.appearance}
        />
      </div>
      <div className="space-y-2">
        <Label>功能檢查</Label>
        <ChecklistEditor
          category="functional"
          title="功能檢查"
          items={block.functionalChecklist}
          onItemsChange={(items) => onChange({ ...block, functionalChecklist: items })}
          suggestions={suggestions.functional}
        />
      </div>
    </CardContent>
  );
}