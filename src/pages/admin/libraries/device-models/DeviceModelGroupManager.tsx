import { useState, useMemo } from 'react';
import { useDeviceModelGroups, DeviceModelGroup } from '../../products/hooks/useDeviceModelGroups';
import { useDeviceModels } from '../../products/hooks/useDeviceModels';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Plus, Search, Edit2, Trash2, Users, Layers, 
  ChevronRight, ArrowRight, Loader2, Info, AlertTriangle 
} from 'lucide-react';
import { 
  Dialog, DialogContent, DialogDescription, DialogFooter, 
  DialogHeader, DialogTitle, DialogTrigger 
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import Papa from 'papaparse';
import { Download, Upload, FileUp } from 'lucide-react';
import { useRef } from 'react';

export function DeviceModelGroupManager() {
  const { groups, isLoading, createGroupMutation, updateGroupMutation, deleteGroupMutation, addItemsMutation, removeItemsMutation, useGroupItems, useGroupUsage } = useDeviceModelGroups();
  const { models } = useDeviceModels();
  
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Partial<DeviceModelGroup> | null>(null);
  
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 當前選中群組的成員與統計
  const { data: currentItems = [], isLoading: isLoadingItems } = useGroupItems(selectedGroupId || '');
  const { data: usage = { products: 0, variants: 0 } } = useGroupUsage(selectedGroupId || '');

  const handleSaveGroup = async () => {
    if (!editingGroup?.name) return;
    
    if (editingGroup.id) {
      await updateGroupMutation.mutateAsync({ id: editingGroup.id, values: editingGroup });
    } else {
      await createGroupMutation.mutateAsync(editingGroup);
    }
    setIsEditModalOpen(false);
    setEditingGroup(null);
  };

  const handleDeleteGroup = async (group: DeviceModelGroup) => {
    if (confirm(`確定要刪除群組「${group.name}」嗎？這將會影響 ${usage.products} 個產品。`)) {
      await deleteGroupMutation.mutateAsync(group.id);
    }
  };

  const toggleModelInGroup = async (modelId: string, isInGroup: boolean) => {
    if (!selectedGroupId) return;
    
    if (isInGroup) {
      await removeItemsMutation.mutateAsync({ groupId: selectedGroupId, modelIds: [modelId] });
    } else {
      await addItemsMutation.mutateAsync({ groupId: selectedGroupId, modelIds: [modelId] });
    }
  };

  const handleExport = async () => {
    try {
      toast.loading('正在準備匯出資料...');
      const { data: allItems, error } = await supabase
        .from('device_model_group_items')
        .select(`
          group_id,
          device_model_groups(name, description),
          device_models(name)
        `);
      
      if (error) throw error;

      // 按群組彙整
      const groupMap = new Map<string, { id: string, name: string, description: string, models: string[] }>();
      
      // 先把所有現有群組加入 Map (確保沒型號的群組也被匯出)
      groups.forEach(g => {
        groupMap.set(g.id, { id: g.id, name: g.name, description: g.description || '', models: [] });
      });

      // 填入型號
      allItems?.forEach((item: any) => {
        const entry = groupMap.get(item.group_id);
        if (entry && item.device_models?.name) {
          entry.models.push(item.device_models.name);
        }
      });

      const exportData = Array.from(groupMap.values()).map(g => ({
        '群組ID': g.id, // 放第一欄作為識別
        '群組名稱': g.name,
        '群組描述': g.description,
        '適用型號': g.models.join(', ')
      }));

      const csv = Papa.unparse(exportData);
      const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `型號群組匯出_${new Date().toLocaleDateString()}.csv`;
      link.click();
      toast.dismiss();
      toast.success('匯出完成');
    } catch (err: any) {
      toast.dismiss();
      toast.error(`匯出失敗: ${err.message}`);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const rows = results.data as any[];
          if (rows.length === 0) return;

          toast.loading(`正在處理 ${rows.length} 筆群組資料...`);
          
          // 1. 建立名稱到 ID 的映射 (用於型號解析)
          const modelMap = new Map(models.map(m => [m.name.toLowerCase(), m.id]));

          // 提前取得現有的型號關聯，用來做差異比對
          const { data: allExistingItems } = await supabase.from('device_model_group_items').select('group_id, model_id');
          const existingGroupItemsMap = new Map<string, Set<string>>();
          allExistingItems?.forEach(item => {
            if (!existingGroupItemsMap.has(item.group_id)) {
              existingGroupItemsMap.set(item.group_id, new Set());
            }
            existingGroupItemsMap.get(item.group_id)!.add(item.model_id);
          });

          let updatedCount = 0;
          let addedCount = 0;

          for (const row of rows) {
            const groupIdFromCsv = row['群組ID'];
            const groupName = row['群組名稱'];
            const description = row['群組描述'] || '';
            const modelsStr = row['適用型號'] || '';

            if (!groupName) continue;

            // 2. 建立或更新群組
            let groupId;
            // 優先使用 UUID(群組ID) 識別，若無則降級使用名稱匹配
            let existingGroup = null;
            if (groupIdFromCsv) {
              existingGroup = groups.find(g => g.id === groupIdFromCsv);
            }
            if (!existingGroup) {
              existingGroup = groups.find(g => g.name === groupName);
            }
            
            if (existingGroup) {
              groupId = existingGroup.id;
              // 差異化更新：只有名稱或描述有變更時才打 API
              if (existingGroup.name !== groupName || (existingGroup.description || '') !== description) {
                await updateGroupMutation.mutateAsync({ id: groupId, values: { name: groupName, description } });
                updatedCount++;
              }
            } else {
              const newGroup = await createGroupMutation.mutateAsync({ name: groupName, description });
              groupId = newGroup.id;
              addedCount++;
            }

            // 3. 處理型號關聯 (差異化比對)
            const modelNames = modelsStr.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
            const modelIdsToLink = modelNames.map((name: string) => modelMap.get(name)).filter(Boolean) as string[];

            const existingModelIds = existingGroupItemsMap.get(groupId) || new Set<string>();
            const newModelIds = new Set(modelIdsToLink);

            // 計算要新增和刪除的項目
            const toAdd = [...newModelIds].filter(id => !existingModelIds.has(id));
            const toRemove = [...existingModelIds].filter(id => !newModelIds.has(id));

            if (toRemove.length > 0) {
              await removeItemsMutation.mutateAsync({ groupId, modelIds: toRemove });
              if (existingGroup && updatedCount === 0) updatedCount++; // 若有改變關聯也算作更新
            }
            
            if (toAdd.length > 0) {
              await addItemsMutation.mutateAsync({ groupId, modelIds: toAdd });
              if (existingGroup && updatedCount === 0) updatedCount++;
            }
          }

          toast.dismiss();
          toast.success(`匯入完成: 新增 ${addedCount} 筆，更新 ${updatedCount} 筆`);
          e.target.value = ''; // 清除 input
        } catch (err: any) {
          toast.dismiss();
          toast.error(`匯入失敗: ${err.message}`);
        }
      }
    });
  };

  const filteredModels = useMemo(() => {
    const base = models.filter(m => 
      m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
      (m.device_series || '').toLowerCase().includes(modelSearch.toLowerCase())
    );

    return [...base].sort((a, b) => {
      const aIn = currentItems.some(item => item.model_id === a.id) ? 1 : 0;
      const bIn = currentItems.some(item => item.model_id === b.id) ? 1 : 0;
      if (aIn !== bIn) return bIn - aIn;
      return 0;
    });
  }, [models, modelSearch, currentItems]);

  if (isLoading) return <div className="p-8 text-center"><Loader2 className="animate-spin h-8 w-8 mx-auto opacity-20" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">型號群組管理</h2>
          <p className="text-muted-foreground text-sm">建立共用型號集，一次更新，全站同步。</p>
        </div>
        <div className="flex gap-2">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImport} 
            accept=".csv" 
            className="hidden" 
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="shadow-sm">
            <Upload className="mr-2 h-4 w-4" /> 匯入 CSV
          </Button>
          <Button variant="outline" onClick={handleExport} className="shadow-sm">
            <Download className="mr-2 h-4 w-4" /> 匯出 CSV
          </Button>
          <Button onClick={() => { setEditingGroup({ name: '', description: '' }); setIsEditModalOpen(true); }} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> 建立新群組
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.map(group => (
          <GroupCard 
            key={group.id} 
            group={group} 
            onEdit={() => { setEditingGroup(group); setIsEditModalOpen(true); }}
            onDelete={() => handleDeleteGroup(group)}
            onManageMembers={() => { setSelectedGroupId(group.id); setIsMemberModalOpen(true); }}
            useGroupItems={useGroupItems}
            useGroupUsage={useGroupUsage}
          />
        ))}

        {groups.length === 0 && (
          <div className="col-span-full py-12 border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-muted-foreground bg-muted/5">
            <Layers className="h-12 w-12 mb-4 opacity-10" />
            <p>尚未建立任何型號群組</p>
            <Button variant="link" onClick={() => { setEditingGroup({ name: '', description: '' }); setIsEditModalOpen(true); }}>立即建立</Button>
          </div>
        )}
      </div>

      {/* 建立/編輯群組彈窗 */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGroup?.id ? '編輯群組' : '建立型號群組'}</DialogTitle>
            <DialogDescription>請輸入群組名稱與描述，方便後續在產品編輯時快速選擇。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>群組名稱 (必填)</Label>
              <Input 
                value={editingGroup?.name || ''} 
                onChange={e => setEditingGroup(prev => ({ ...prev, name: e.target.value }))}
                placeholder="例如：iPhone 15 系列"
              />
            </div>
            <div className="space-y-2">
              <Label>群組描述</Label>
              <Textarea 
                value={editingGroup?.description || ''} 
                onChange={e => setEditingGroup(prev => ({ ...prev, description: e.target.value }))}
                placeholder="說明此群組包含哪些型號或適用範圍..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditModalOpen(false)}>取消</Button>
            <Button onClick={handleSaveGroup} disabled={createGroupMutation.isPending || updateGroupMutation.isPending}>
              儲存群組
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 成員管理彈窗 */}
      <Dialog open={isMemberModalOpen} onOpenChange={setIsMemberModalOpen}>
        <DialogContent className="max-w-2xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              管理群組成員: <span className="text-primary">{groups.find(g => g.id === selectedGroupId)?.name}</span>
            </DialogTitle>
            <DialogDescription>勾選以將型號加入此群組。已選中的型號將同步至所有連結此群組的產品。</DialogDescription>
          </DialogHeader>
          
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="搜尋型號或系列..." 
              value={modelSearch} 
              onChange={e => setModelSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          <ScrollArea className="flex-1 mt-4 border rounded-md p-4">
            {isLoadingItems ? (
              <div className="flex justify-center p-8"><Loader2 className="animate-spin h-6 w-6 opacity-20" /></div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {filteredModels.map(model => {
                  const isInGroup = currentItems.some(item => item.model_id === model.id);
                  return (
                    <div 
                      key={model.id} 
                      className={`flex items-center space-x-3 p-2 rounded-lg border transition-colors cursor-pointer hover:bg-muted/50 ${isInGroup ? 'border-primary/50 bg-primary/5' : 'border-transparent'}`}
                      onClick={() => toggleModelInGroup(model.id, isInGroup)}
                    >
                      <Checkbox checked={isInGroup} onCheckedChange={() => toggleModelInGroup(model.id, isInGroup)} />
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium truncate">{model.name}</span>
                        <span className="text-[10px] text-muted-foreground">{model.device_series || '無系列'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg flex gap-3 items-start">
            <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 dark:text-amber-200">
              <p className="font-bold mb-1">注意：動態同步機制已啟用</p>
              在此處新增或移除型號，將立即影響所有已連結「{groups.find(g => g.id === selectedGroupId)?.name}」的產品相容性顯示。
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button onClick={() => setIsMemberModalOpen(false)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface GroupCardProps {
  group: DeviceModelGroup;
  onEdit: () => void;
  onDelete: () => void;
  onManageMembers: () => void;
  useGroupItems: (id: string) => any;
  useGroupUsage: (id: string) => any;
}

function GroupCard({ group, onEdit, onDelete, onManageMembers, useGroupItems, useGroupUsage }: GroupCardProps) {
  const { data: items = [] } = useGroupItems(group.id);
  const { data: usage = { products: 0, variants: 0 } } = useGroupUsage(group.id);
  
  return (
    <Card className="hover:shadow-md transition-shadow group">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <CardTitle className="text-lg">{group.name}</CardTitle>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
              <Edit2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <CardDescription className="line-clamp-1">{group.description || '尚無描述'}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4 text-xs text-muted-foreground bg-muted/30 p-2 rounded-lg">
            <div className="flex items-center gap-1">
              <Layers className="h-3 w-3" /> {items.length} 型號
            </div>
            <div className="flex items-center gap-1">
              <Users className="h-3 w-3" /> 受影響: {usage.products} 產品
            </div>
          </div>
          <Button variant="secondary" size="sm" className="w-full" onClick={onManageMembers}>
            管理成員 <ChevronRight className="ml-1 h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
