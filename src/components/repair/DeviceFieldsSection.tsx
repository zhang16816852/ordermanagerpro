import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { CardContent, CardTitle } from '@/components/ui/card';
import { Smartphone } from 'lucide-react';
import { ModelPicker, ModelPickerOption } from '@/components/repair/ModelPicker';
import { LockInput } from '@/components/repair/LockInput';
import { DeviceBlock, BlockUpdateProps } from './deviceBlockTypes';

export interface DeviceFieldsSectionProps extends BlockUpdateProps {
  models: ModelPickerOption[];
  showRam?: boolean;
  showSn?: boolean;
}

export function DeviceFieldsSection({ block, onChange, models, showRam = true, showSn = true }: DeviceFieldsSectionProps) {
  const selectedModel = models.find((m) => m.id === block.device_model_id);
  const selectedModelSpecs = selectedModel?.specifications || {};
  const modelVersions: any[] = Array.isArray(selectedModelSpecs.versions) ? selectedModelSpecs.versions : [];
  const set = (patch: Partial<DeviceBlock>) => onChange({ ...block, ...patch });

  const handleModelChange = (modelId: string | null) => {
    set({
      device_model_id: modelId || '',
      device_color: '',
      device_storage: '',
      device_ram: '',
      device_cpu: '',
    });
  };

  const applyVersion = (version: any) => {
    if (!version) return;
    set({
      device_color: version.color || '',
      device_storage: version.storage || '',
      device_ram: version.ram || '',
      device_cpu: version.cpu || '',
    });
  };

  return (
    <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2 md:col-span-2">
        <Label>型號</Label>
        <ModelPicker
          models={models}
          value={block.device_model_id || null}
          onChange={handleModelChange}
        />
        {modelVersions.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <Label className="shrink-0 text-xs text-muted-foreground">快速套用版本</Label>
            <Select value="" onValueChange={(v) => applyVersion(modelVersions.find((ver) => ver.version_name === v))}>
              <SelectTrigger className="h-8 flex-1 text-xs">
                <SelectValue placeholder="選擇版本組合..." />
              </SelectTrigger>
              <SelectContent>
                {modelVersions.map((ver) => (
                  <SelectItem key={ver.version_name} value={ver.version_name}>
                    {ver.version_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <Label>顏色</Label>
        {selectedModelSpecs.colors?.length ? (
          <Select value={block.device_color} onValueChange={(v) => set({ device_color: v })}>
            <SelectTrigger>
              <SelectValue placeholder="選擇顏色..." />
            </SelectTrigger>
            <SelectContent>
              {(selectedModelSpecs.colors as string[]).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input value={block.device_color} onChange={(e) => set({ device_color: e.target.value })} placeholder="例: 太空黑" />
        )}
      </div>
      <div className="space-y-2">
        <Label>儲存空間</Label>
        {selectedModelSpecs.storage_options?.length ? (
          <Select value={block.device_storage} onValueChange={(v) => set({ device_storage: v })}>
            <SelectTrigger>
              <SelectValue placeholder="選擇容量..." />
            </SelectTrigger>
            <SelectContent>
              {(selectedModelSpecs.storage_options as string[]).map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input value={block.device_storage} onChange={(e) => set({ device_storage: e.target.value })} placeholder="例: 256GB" />
        )}
      </div>
      {showRam && (
        <div className="space-y-2">
          <Label>RAM</Label>
          {selectedModelSpecs.ram_options?.length ? (
            <Select value={block.device_ram} onValueChange={(v) => set({ device_ram: v })}>
              <SelectTrigger>
                <SelectValue placeholder="選擇 RAM..." />
              </SelectTrigger>
              <SelectContent>
                {(selectedModelSpecs.ram_options as string[]).map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input value={block.device_ram} onChange={(e) => set({ device_ram: e.target.value })} placeholder="例: 8GB" />
          )}
        </div>
      )}
      <div className="space-y-2">
        <Label>CPU</Label>
        {selectedModelSpecs.cpu_options?.length ? (
          <Select value={block.device_cpu} onValueChange={(v) => set({ device_cpu: v })}>
            <SelectTrigger>
              <SelectValue placeholder="選擇 CPU..." />
            </SelectTrigger>
            <SelectContent>
              {(selectedModelSpecs.cpu_options as string[]).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input value={block.device_cpu} onChange={(e) => set({ device_cpu: e.target.value })} placeholder="例: A17 Pro" />
        )}
      </div>
      <div className="space-y-2">
        <Label>IMEI</Label>
        <Input value={block.device_imei} onChange={(e) => set({ device_imei: e.target.value })} placeholder="IMEI 號碼" />
      </div>
      {showSn && (
        <div className="space-y-2">
          <Label>序號 (SN)</Label>
          <Input value={block.device_sn} onChange={(e) => set({ device_sn: e.target.value })} placeholder="序號" />
        </div>
      )}
      <div className="space-y-2 md:col-span-2">
        <LockInput
          lockType={block.device_lock_type}
          onLockTypeChange={(t) => set({ device_lock_type: t })}
          passcode={block.device_passcode}
          onPasscodeChange={(code) => set({ device_passcode: code })}
          pattern={block.device_passcode_pattern}
          onPatternChange={(pattern) => set({ device_passcode_pattern: pattern })}
        />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label>外觀狀況</Label>
        <Input value={block.device_condition} onChange={(e) => set({ device_condition: e.target.value })} placeholder="例: 螢幕破裂、背蓋有刮痕" />
      </div>
    </CardContent>
  );
}

export function DeviceBlockCardTitle({ block, index, models }: { block: DeviceBlock; index: number; models: ModelPickerOption[] }) {
  const modelName = models.find((m) => m.id === block.device_model_id)?.name;
  return (
    <CardTitle className="flex items-center gap-2 text-base">
      <Smartphone className="h-4 w-4 shrink-0" />
      <span className="shrink-0">裝置區塊 {index + 1}</span>
      {modelName && (
        <Badge variant="outline" className="text-xs font-normal truncate max-w-[200px]">{modelName}</Badge>
      )}
    </CardTitle>
  );
}