import { useState } from 'react';
import { ChevronDown, Plus, Trash2, ClipboardCheck, DollarSign, Truck } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ModelPickerOption } from '@/components/repair/ModelPicker';
import { DeviceBlock } from './deviceBlockTypes';
import { DeviceFieldsSection, DeviceBlockCardTitle } from './DeviceFieldsSection';
import { IssuesFieldsSection, ChecklistFieldsSection } from './IssuesChecklistFieldsSection';
import { ItemsFieldsSection } from './ItemsFieldsSection';
import { FeesFieldsSection } from './FeesFieldsSection';

export interface DeviceBlockSectionProps {
  block: DeviceBlock;
  index: number;
  total: number;
  models: ModelPickerOption[];
  mode?: 'admin' | 'store';
  collapsed?: boolean;
  suggestions: { appearance: string[]; functional: string[] };
  onUpdate: (block: DeviceBlock) => void;
  onAddBlock: () => void;
  onRemoveBlock: (key: string) => void;
  onCreatePart?: (deviceModelId: string | null) => void;
  onNavigateToPurchase?: () => void;
  onRequestPurchase?: (block: DeviceBlock) => void;
}

export function DeviceBlockSection({
  block,
  index,
  total,
  models,
  mode = 'admin',
  collapsed = false,
  suggestions,
  onUpdate,
  onAddBlock,
  onRemoveBlock,
  onCreatePart,
  onNavigateToPurchase,
  onRequestPurchase,
}: DeviceBlockSectionProps) {
  const [open, setOpen] = useState(!collapsed);
  const showRemove = total > 1;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <DeviceBlockCardTitle block={block} index={index} models={models} />
        <div className="flex items-center gap-1">
          {showRemove && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onRemoveBlock(block.key)} aria-label="移除裝置區塊">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(o => !o)} aria-label={open ? '收合區塊' : '展開區塊'}>
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </Button>
        </div>
      </CardHeader>
      {open && (
        <>
          <DeviceFieldsSection block={block} onChange={onUpdate} models={models} showRam={mode === 'admin'} showSn={mode === 'admin'} />
          <div className="px-6 pb-1">
            <div className="border-t" />
          </div>
          <IssuesFieldsSection
            block={block}
            onChange={onUpdate}
            showDiagnostic={mode === 'admin'}
            showInternalNotes={mode === 'admin'}
          />
          <div className="px-6 pb-1">
            <div className="border-t" />
          </div>
          <div className="px-6 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-base font-semibold">
                <ClipboardCheck className="h-4 w-4" />
                外觀 / 功能檢查
              </div>
              <span className="text-xs text-muted-foreground">
                已勾選 {block.appearanceChecklist.filter(c => c.is_checked).length + block.functionalChecklist.filter(c => c.is_checked).length}
              </span>
            </div>
          </div>
          <ChecklistFieldsSection block={block} onChange={onUpdate} suggestions={suggestions} />
          <div className="px-6 pb-1">
            <div className="border-t" />
          </div>
          <div className="px-6 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-base font-semibold">
                <DollarSign className="h-4 w-4" />
                維修項目 / 費用
              </div>
              <div className="flex items-center gap-2">
                {onCreatePart && (
                  <Button variant="ghost" size="sm" className="text-muted-foreground text-xs" onClick={() => onCreatePart(block.device_model_id || null)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    建立零件
                  </Button>
                )}
                {mode === 'admin' && (onRequestPurchase || onNavigateToPurchase) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground text-xs"
                    onClick={() => onRequestPurchase ? onRequestPurchase(block) : onNavigateToPurchase?.()}
                    title="叫料 / 進貨"
                  >
                    <Truck className="h-3.5 w-3.5 mr-1" />
                    叫料/進貨
                  </Button>
                )}
              </div>
            </div>
          </div>
          <ItemsFieldsSection
            block={block}
            onChange={onUpdate}
            mode={mode}
            onCreatePart={onCreatePart}
            onNavigateToPurchase={onNavigateToPurchase}
            onRequestPurchase={onRequestPurchase}
          />
          <FeesFieldsSection block={block} onChange={onUpdate} mode={mode} />
        </>
      )}
      {index === total - 1 && (
        <CardContent className="pt-0">
          <Button variant="outline" className="w-full" onClick={onAddBlock}>
            <Plus className="h-4 w-4 mr-1" />
            新增一個裝置區塊
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-2">
            多機型拆單：每一機型各建立一張獨立維修單（共用上方客戶與指派設定）。
          </p>
        </CardContent>
      )}
    </Card>
  );
}