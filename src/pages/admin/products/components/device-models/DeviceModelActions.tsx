import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Plus, Upload, Download, Filter } from 'lucide-react';
import { useRef } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface DeviceModelActionsProps {
  search: string;
  setSearch: (val: string) => void;
  typeFilter: string;
  setTypeFilter: (val: string) => void;
  uniqueTypes: string[];
  openEdit: () => void;
  isImporting: boolean;
  handleImport: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleExport: () => void;
}

export function DeviceModelActions({
  search,
  setSearch,
  typeFilter,
  setTypeFilter,
  uniqueTypes,
  openEdit,
  isImporting,
  handleImport,
  handleExport
}: DeviceModelActionsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col sm:flex-row justify-between gap-4">
      <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜尋型號名稱..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="w-full sm:w-40 flex items-center gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger>
              <Filter className="w-4 h-4 mr-2 opacity-50" />
              <SelectValue placeholder="篩選類型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有類型</SelectItem>
              {uniqueTypes.map(type => (
                <SelectItem key={type} value={type}>{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleImport} />
        <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
          <Upload className="h-4 w-4 mr-2" />
          {isImporting ? '匯入中...' : '匯入'}
        </Button>
        <Button variant="outline" onClick={handleExport}>
          <Download className="h-4 w-4 mr-2" />
          匯出
        </Button>
        <Button onClick={() => openEdit()}>
          <Plus className="h-4 w-4 mr-2" />
          新增型號
        </Button>
      </div>
    </div>
  );
}
