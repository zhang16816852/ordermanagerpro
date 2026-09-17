import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Plus, Trash2 } from 'lucide-react';
import { StandaloneDeviceModelSelectField } from '../StandaloneDeviceModelSelectField';
import type {
  BatchEditEntry,
  FieldOption,
  OptionGroupRow,
} from '../variantManagerTypes';
import { isColorGroupName, FIELD_OPTIONS } from '../variantManagerTypes';

interface BatchEditDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entries: BatchEditEntry[];
  updateBatchEntry: (idx: number, patch: Partial<BatchEditEntry>) => void;
  removeBatchEntry: (idx: number) => void;
  addBatchEntry: () => void;
  optionGroupsData: OptionGroupRow[];
  selectedCount: number;
  onHandleBatchEdit: () => void;
  batchEditPending: boolean;
}

export function BatchEditDialog({
  open,
  onOpenChange,
  entries,
  updateBatchEntry,
  removeBatchEntry,
  addBatchEntry,
  optionGroupsData,
  selectedCount,
  onHandleBatchEdit,
  batchEditPending,
}: BatchEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>批次編輯欄位</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {entries.map((entry, idx) => {
            const opt = FIELD_OPTIONS.find(o => o.value === entry.field);
            const currentGroup = optionGroupsData.find((g) => g.id === entry.optionGroupId);
            const isColorGroup = isColorGroupName(currentGroup?.name || '');
            const customMode = entry.optionValueId === '__custom__';
            return (
              <div key={idx} className="flex items-start gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">欄位</Label>
                  <Select
                    value={entry.field}
                    onValueChange={v => updateBatchEntry(idx, {
                      field: v,
                      value: '',
                      optionGroupId: undefined,
                      optionValueId: undefined,
                      newOptionValueLabel: undefined,
                      newOptionValueHex: undefined,
                      modelRefs: undefined,
                    })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="選擇欄位" />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_OPTIONS.filter(o => !entries.some((e, i) => i !== idx && e.field === o.value)).map(o => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-[2] space-y-1">
                  <Label className="text-xs">新值</Label>
                  {opt?.type === 'select' ? (
                    <Select value={entry.value} onValueChange={v => updateBatchEntry(idx, { value: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder="選擇狀態" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">上架中</SelectItem>
                        <SelectItem value="preorder">預購中</SelectItem>
                        <SelectItem value="sold_out">售完停產</SelectItem>
                        <SelectItem value="discontinued">已停售</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : opt?.type === 'option' ? (
                    <div className="space-y-2">
                      <Select
                        value={entry.optionGroupId || ''}
                        onValueChange={v => updateBatchEntry(idx, { optionGroupId: v, optionValueId: undefined, newOptionValueLabel: undefined, newOptionValueHex: undefined })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="選擇選項群組" />
                        </SelectTrigger>
                        <SelectContent>
                          {optionGroupsData.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-muted-foreground">此產品尚無選項群組</div>
                          ) : optionGroupsData.map((g) => (
                            <SelectItem key={g.id} value={g.id}>{g.name || '（未命名群組）'}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {currentGroup && (
                        <>
                          <Select
                            value={customMode ? '__custom__' : entry.optionValueId || ''}
                            onValueChange={v => {
                              if (v === '__custom__') {
                                updateBatchEntry(idx, { optionValueId: '__custom__' });
                              } else {
                                updateBatchEntry(idx, { optionValueId: v, newOptionValueLabel: undefined, newOptionValueHex: undefined });
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={customMode ? '輸入新值' : '選擇值或輸入新值'} />
                            </SelectTrigger>
                            <SelectContent>
                              {(currentGroup.product_option_values || []).map((v) => (
                                <SelectItem key={v.id} value={v.id}>
                                  <span className="flex items-center gap-1.5">
                                    {v.hex_code ? (
                                      <span className="inline-block w-3 h-3 rounded-full border border-black/10 shrink-0" style={{ backgroundColor: v.hex_code }} />
                                    ) : null}
                                    {v.label}
                                  </span>
                                </SelectItem>
                              ))}
                              <SelectItem value="__custom__">＋ 輸入新值…</SelectItem>
                            </SelectContent>
                          </Select>
                          {customMode && (
                            <div className="flex items-center gap-2">
                              <Input
                                className="h-8 flex-1"
                                placeholder="新值名稱"
                                value={entry.newOptionValueLabel || ''}
                                onChange={e => updateBatchEntry(idx, { newOptionValueLabel: e.target.value })}
                              />
                              {isColorGroup && (
                                <>
                                  <Input
                                    className="h-8 w-[110px] font-mono"
                                    placeholder="#RRGGBB"
                                    maxLength={7}
                                    value={entry.newOptionValueHex || ''}
                                    onChange={e => updateBatchEntry(idx, { newOptionValueHex: e.target.value })}
                                  />
                                  {entry.newOptionValueHex && /^#[0-9a-fA-F]{6}$/.test(entry.newOptionValueHex) && (
                                    <span className="w-5 h-5 rounded border shrink-0" style={{ backgroundColor: entry.newOptionValueHex }} />
                                  )}
                                </>
                              )}
                            </div>
                          )}
                          {isColorGroup && (
                            <p className="text-[11px] text-muted-foreground">顏色群組：可套用既有值，或輸入新值並填色碼</p>
                          )}
                        </>
                      )}
                    </div>
                  ) : opt?.type === 'model' ? (
                    <StandaloneDeviceModelSelectField
                      selectionOrder={entry.modelRefs || []}
                      onOrderChange={refs => updateBatchEntry(idx, { modelRefs: refs })}
                    />
                  ) : (
                    <Input
                      type={opt?.type === 'number' ? 'number' : 'text'}
                      step={opt?.type === 'number' ? '0.01' : undefined}
                      placeholder="輸入新值"
                      value={entry.value}
                      onChange={e => updateBatchEntry(idx, { value: e.target.value })}
                    />
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-destructive"
                  onClick={() => removeBatchEntry(idx)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={addBatchEntry}
          >
            <Plus className="mr-1 h-4 w-4" /> 增加欄位
          </Button>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={onHandleBatchEdit} disabled={batchEditPending}>
            更新 {selectedCount} 個變體
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}