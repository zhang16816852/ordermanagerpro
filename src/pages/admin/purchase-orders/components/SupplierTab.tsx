import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, User, Phone, Mail, MapPin, FileEdit } from 'lucide-react';
import { Supplier } from '../types';

interface SupplierTabProps {
  suppliers: Supplier[];
  onAdd: () => void;
  isLoading: boolean;
}

import { useState } from 'react';
import { SupplierMappingDialog } from './SupplierMappingDialog';

export function SupplierTab({
  suppliers,
  onAdd,
  isLoading
}: SupplierTabProps) {
  const [mappingSupplier, setMappingSupplier] = useState<Supplier | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">供應商管理 ({suppliers.length})</h2>
        <Button onClick={onAdd} size="sm"><Plus className="h-4 w-4 mr-2" /> 新增供應商</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          <p className="col-span-full text-center py-12 text-muted-foreground">載入中...</p>
        ) : suppliers.map((supplier) => (
          <Card key={supplier.id} className="group hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-lg font-bold">{supplier.name}</CardTitle>
              <div className="flex gap-1 ml-auto">
                <Button variant="outline" size="sm" onClick={() => setMappingSupplier(supplier)}>
                  <FileEdit className="h-4 w-4 mr-2" />
                  對照設定
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <User className="h-4 w-4" />
                  <span>{supplier.contact_name || '無聯絡人資訊'}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  <span>{supplier.phone || '無電話'}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  <span className="truncate">{supplier.email || '無電子郵件'}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  <span className="truncate">{supplier.address || '無地址資訊'}</span>
                </div>
              </div>
              {supplier.notes && (
                <div className="pt-2 border-t mt-2">
                  <p className="text-xs text-muted-foreground line-clamp-2 italic">備註：{supplier.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {suppliers.length === 0 && !isLoading && (
          <div className="col-span-full border-2 border-dashed rounded-lg p-12 text-center text-muted-foreground">
            尚未建立任何供應商，點擊上方按鈕開始新增。
          </div>
        )}
      </div>

      <SupplierMappingDialog
        open={!!mappingSupplier}
        onOpenChange={(open) => !open && setMappingSupplier(null)}
        supplier={mappingSupplier}
      />
    </div>
  );
}
