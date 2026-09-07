import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, X, Package } from 'lucide-react';
import { FullDeviceModel as DeviceModel } from '@/types/device-models';
import { UseMutationResult } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

interface DeviceModelDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  editingData: Partial<DeviceModel> | null;
  setEditingData: React.Dispatch<React.SetStateAction<Partial<DeviceModel> | null>>;
  deviceBrands: any[];
  createBrandMutation: UseMutationResult<any, Error, string, unknown>;
  handleSave: () => void;
  uniqueSeriesByBrand?: string[];
}

type SpecAspectKey = 'colors' | 'storage_options' | 'ram_options' | 'cpu_options';

interface VersionRow {
  version_name: string;
  color: string;
  storage: string;
  ram: string;
  cpu: string;
  is_default: boolean;
}

const ASPECT_FIELDS: { key: SpecAspectKey; label: string; example: string }[] = [
  { key: 'colors', label: '顏色', example: '太空黑' },
  { key: 'storage_options', label: '儲存空間', example: '256GB' },
  { key: 'ram_options', label: 'RAM', example: '8GB' },
  { key: 'cpu_options', label: 'CPU', example: 'A17 Pro' },
];

function useSpecs(editingData: Partial<DeviceModel> | null, setEditingData: DeviceModelDialogProps['setEditingData']) {
  const specs = editingData?.specifications || {};
  const get = (key: SpecAspectKey): string[] => (Array.isArray(specs[key]) ? specs[key] as string[] : []);
  const set = (key: SpecAspectKey, values: string[]) => {
    setEditingData(prev => ({
      ...prev!,
      specifications: { ...(prev?.specifications || {}), [key]: values },
    }));
  };
  const versions: VersionRow[] = Array.isArray(specs.versions) ? specs.versions as VersionRow[] : [];
  const setVersions = (rows: VersionRow[]) => {
    setEditingData(prev => ({
      ...prev!,
      specifications: { ...(prev?.specifications || {}), versions: rows },
    }));
  };
  return { get, set, versions, setVersions, specs };
}

function TagEditor({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const addTag = (val: string) => {
    const t = val.trim();
    if (t && !values.includes(t)) onChange([...values, t]);
  };
  return (
    <div className="flex flex-wrap gap-2 p-2 border rounded-md bg-muted/5 min-h-[42px]">
      {values.map((v, index) => (
        <div key={index} className="flex items-center gap-1 bg-primary/10 text-primary px-2 py-1 rounded text-sm border border-primary/20">
          {v}
          <X
            className="h-3 w-3 cursor-pointer hover:text-destructive"
            onClick={() => onChange(values.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <input
        className="flex-1 bg-transparent border-none outline-none text-sm min-w-[120px]"
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addTag((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).value = '';
          }
        }}
        onBlur={(e) => {
          if (e.target.value.trim()) {
            addTag(e.target.value);
            e.target.value = '';
          }
        }}
      />
    </div>
  );
}

function VersionEditor({ versions, onChange }: { versions: VersionRow[]; onChange: (rows: VersionRow[]) => void }) {
  const setRow = (index: number, patch: Partial<VersionRow>) => {
    onChange(versions.map((r, i) => i === index ? { ...r, ...patch } : r));
  };
  const addRow = () => {
    onChange([...versions, { version_name: '', color: '', storage: '', ram: '', cpu: '', is_default: versions.length === 0 }]);
  };
  return (
    <div className="space-y-2">
      {versions.map((v, index) => (
        <div key={index} className={cn('p-2 border rounded-md space-y-2', v.is_default && 'border-primary bg-primary/5')}>
          <div className="flex items-center gap-2">
            <Input
              value={v.version_name}
              onChange={(e) => setRow(index, { version_name: e.target.value })}
              placeholder="版本名稱（例：港版 128G）"
              className="flex-1 h-8 text-sm"
            />
            <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
              <Checkbox
                checked={v.is_default}
                onCheckedChange={(checked) => {
                  onChange(versions.map((r, i) => ({ ...r, is_default: i === index ? checked === true : false })));
                }}
              />
              預設
            </label>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onChange(versions.filter((_, i) => i !== index))} aria-label="刪除版本">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Input value={v.color} onChange={(e) => setRow(index, { color: e.target.value })} placeholder="顏色" className="h-8 text-sm" />
            <Input value={v.storage} onChange={(e) => setRow(index, { storage: e.target.value })} placeholder="容量" className="h-8 text-sm" />
            <Input value={v.ram} onChange={(e) => setRow(index, { ram: e.target.value })} placeholder="RAM" className="h-8 text-sm" />
            <Input value={v.cpu} onChange={(e) => setRow(index, { cpu: e.target.value })} placeholder="CPU" className="h-8 text-sm" />
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addRow}>
        <Plus className="h-4 w-4 mr-1" />
        新增版本組合
      </Button>
    </div>
  );
}

export function DeviceModelDialog({
  isOpen,
  onOpenChange,
  editingData,
  setEditingData,
  deviceBrands,
  createBrandMutation,
  handleSave,
  uniqueSeriesByBrand = []
}: DeviceModelDialogProps) {
  const [newBrandOpen, setNewBrandOpen] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const { get, set, versions, setVersions } = useSpecs(editingData, setEditingData);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingData?.id ? '編輯型號標籤' : '新增型號標籤'}</DialogTitle>
            <DialogDescription>
              請定義設備型號的詳細資訊，包含廠牌、系列、規格選項與版本組合。型號標籤可用於維修單型號選擇與變體快速選取。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>型號名稱 *</Label>
              <Input
                placeholder="例如: iPhone 15 Pro"
                value={editingData?.name || ''}
                onChange={(e) => setEditingData(prev => ({ ...prev!, name: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>設備廠牌</Label>
                <div className="flex gap-2">
                  <Select
                    value={editingData?.brand_id || 'none'}
                    onValueChange={(val) => setEditingData(prev => ({ ...prev!, brand_id: val === 'none' ? null : val }))}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="選擇廠牌名稱" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-- 無 --</SelectItem>
                      {deviceBrands?.map((brand: any) => (
                        <SelectItem key={brand.id} value={brand.id}>
                          {brand.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" onClick={() => setNewBrandOpen(true)} title="快速新增廠牌">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>設備類型</Label>
                <Input
                  placeholder="如: 手機、平板"
                  value={editingData?.device_type || ''}
                  onChange={(e) => setEditingData(prev => ({ ...prev!, device_type: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>設備系列</Label>
                <div className="relative">
                  <Input
                    list="seriesSuggestions"
                    placeholder="如: Galaxy S"
                    value={editingData?.device_series || ''}
                    onChange={(e) => setEditingData(prev => ({ ...prev!, device_series: e.target.value }))}
                  />
                  <datalist id="seriesSuggestions">
                    {uniqueSeriesByBrand.map(series => (
                      <option key={series} value={series} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="space-y-2">
                <Label>出廠日期</Label>
                <Input
                  type="date"
                  value={editingData?.release_date || ''}
                  onChange={(e) => setEditingData(prev => ({ ...prev!, release_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>設備備註</Label>
              <Input
                placeholder="任何此設備的特殊備註"
                value={editingData?.device_remarks || ''}
                onChange={(e) => setEditingData(prev => ({ ...prev!, device_remarks: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>別名設定 (TAG 風格)</Label>
              <div className="flex flex-wrap gap-2 p-2 border rounded-md bg-muted/5 min-h-[42px]">
                {(editingData?.aliases || []).map((alias, index) => (
                  <div key={index} className="flex items-center gap-1 bg-primary/10 text-primary px-2 py-1 rounded text-sm border border-primary/20">
                    {alias}
                    <X 
                      className="h-3 w-3 cursor-pointer hover:text-destructive" 
                      onClick={() => {
                        const next = (editingData?.aliases || []).filter((_, i) => i !== index);
                        setEditingData(prev => ({ ...prev!, aliases: next }));
                      }}
                    />
                  </div>
                ))}
                <input
                  className="flex-1 bg-transparent border-none outline-none text-sm min-w-[120px]"
                  placeholder="輸入別名後按 Enter..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const val = (e.target as HTMLInputElement).value.trim();
                      if (val && !(editingData?.aliases || []).includes(val)) {
                        setEditingData(prev => ({ 
                          ...prev!, 
                          aliases: [...(prev?.aliases || []), val] 
                        }));
                        (e.target as HTMLInputElement).value = '';
                      }
                    }
                  }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">例如：ZS661, SM-X230 (輸入後按 Enter 即可)</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>螢幕 / 規格尺寸</Label>
                <Input
                  placeholder="如: 6.1吋"
                  value={editingData?.screen_size || ''}
                  onChange={(e) => setEditingData(prev => ({ ...prev!, screen_size: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>列表排序</Label>
                <Input
                  type="number"
                  value={editingData?.sort_order || 0}
                  onChange={(e) => setEditingData(prev => ({ ...prev!, sort_order: Number(e.target.value) }))}
                />
              </div>
            </div>

            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Package className="h-4 w-4 text-primary" />
                規格選項與版本組合
              </div>
              <p className="text-xs text-muted-foreground">
                定義可選的顏色／容量／RAM／CPU 清單（用於維修單快速選擇），並可建立預先定義好的版本組合。
              </p>

              <Tabs defaultValue="colors">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="colors">顏色</TabsTrigger>
                  <TabsTrigger value="storage">容量</TabsTrigger>
                  <TabsTrigger value="ram">RAM</TabsTrigger>
                  <TabsTrigger value="cpu">CPU</TabsTrigger>
                </TabsList>
                {ASPECT_FIELDS.map(({ key, label, example }) => (
                  <TabsContent key={key} value={key.replace('_options', '').replace('colors', 'colors')} className="mt-2">
                    <TagEditor
                      values={get(key as SpecAspectKey)}
                      onChange={(values) => set(key as SpecAspectKey, values)}
                      placeholder={`輸入${label}後按 Enter...`}
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">例如: {example}（輸入後按 Enter 即可）</p>
                  </TabsContent>
                ))}
              </Tabs>

              <div className="space-y-2 pt-2">
                <Label>版本組合（同硬體不同配色／規格）</Label>
                <VersionEditor versions={versions} onChange={setVersions} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button onClick={handleSave} disabled={!editingData?.name?.trim()}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newBrandOpen} onOpenChange={setNewBrandOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新增設備廠牌</DialogTitle>
            <DialogDescription>
              輸入新的設備廠牌名稱（例如：Apple, Samsung），新增後可立即套用。
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="如: Apple, Samsung..."
              value={newBrandName}
              onChange={e => setNewBrandName(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewBrandOpen(false)}>取消</Button>
            <Button
              onClick={() => {
                if (newBrandName.trim()) {
                  createBrandMutation.mutate(newBrandName.trim(), {
                    onSuccess: (data) => {
                      setEditingData(prev => ({ ...prev!, brand_id: data.id }));
                      setNewBrandOpen(false);
                      setNewBrandName('');
                    }
                  })
                }
              }}
              disabled={!newBrandName.trim() || createBrandMutation.isPending}
            >
              {createBrandMutation.isPending ? "新增中..." : "確認新增"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}