import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-react';
import { DeviceModel } from '../../hooks/useDeviceModels';
import { UseMutationResult } from '@tanstack/react-query';

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

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingData?.id ? '編輯型號標籤' : '新增型號標籤'}</DialogTitle>
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
                <Label>設備廠牌 (與產品廠牌分離)</Label>
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
                    <Plus className="h-4 w-4" />
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
                <Label>出廠年月</Label>
                <Input
                  type="text"
                  placeholder="如: 2024-01"
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
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button onClick={handleSave} disabled={!editingData?.name?.trim()}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newBrandOpen} onOpenChange={setNewBrandOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>新增設備廠牌</DialogTitle></DialogHeader>
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
