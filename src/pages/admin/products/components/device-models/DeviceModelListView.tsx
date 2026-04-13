import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Edit, Trash2 } from 'lucide-react';
import { DeviceModel } from '../../hooks/useDeviceModels';
import { UseMutationResult } from '@tanstack/react-query';

interface DeviceModelListViewProps {
  isLoading: boolean;
  models: DeviceModel[];
  deviceBrands: any[];
  openEdit: (model: DeviceModel) => void;
  updateMutation: UseMutationResult<any, Error, { id: string; values: any }, unknown>;
  deleteMutation: UseMutationResult<void, Error, string, unknown>;
}

export function DeviceModelListView({
  isLoading,
  models,
  deviceBrands,
  openEdit,
  updateMutation,
  deleteMutation
}: DeviceModelListViewProps) {
  return (
    <div className="border rounded-lg bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>型號標籤名稱</TableHead>
            <TableHead>品牌</TableHead>
            <TableHead>類型</TableHead>
            <TableHead>尺寸</TableHead>
            <TableHead className="w-[100px] text-center">排序</TableHead>
            <TableHead className="w-[100px] text-center">狀態</TableHead>
            <TableHead className="w-[120px] text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center">載入中...</TableCell>
            </TableRow>
          ) : models.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">尚無型號資料</TableCell>
            </TableRow>
          ) : (
            models.map((model) => (
              <TableRow key={model.id} className={!model.is_active ? 'opacity-60 bg-muted/30' : ''}>
                <TableCell>
                  <div className="font-medium">{model.name}</div>
                  {model.device_series && <div className="text-[10px] text-muted-foreground">{model.device_series}</div>}
                  {model.device_remarks && <div className="text-[10px] text-muted-foreground truncate w-max max-w-[150px]" title={model.device_remarks}>{model.device_remarks}</div>}
                </TableCell>
                <TableCell className="text-muted-foreground">{model.brand_id ? deviceBrands.find((b: any) => b.id === model.brand_id)?.name || '-' : '-'}</TableCell>
                <TableCell className="text-muted-foreground">
                  <div>{model.device_type || '-'}</div>
                  {model.release_date && <div className="text-[10px] bg-muted/50 px-1 inline-block rounded">{model.release_date}</div>}
                </TableCell>
                <TableCell className="text-muted-foreground">{model.screen_size || '-'}</TableCell>
                <TableCell className="text-center">{model.sort_order}</TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={model.is_active || false}
                    onCheckedChange={(checked) => updateMutation.mutate({ id: model.id, values: { is_active: checked } })}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(model)}>
                      <Edit className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if (confirm(`確定要刪除「${model.name}」嗎？此操作不可逆。`)) {
                          deleteMutation.mutate(model.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
