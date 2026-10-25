
import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Globe, Plus, Search, ArrowLeft, Package, Truck, FileText, X, Trash2 } from 'lucide-react';

interface LinkedPO { id: string; poCode: string; poDate: string; supplier: string; itemCount: number; totalQty: number; status: 'linked' | 'confirmed'; }
interface TrackingNumber { id: string; trackingNumber: string; carrier: string; shipDate: string; weight: number | null; note: string; linkedPOs: LinkedPO[]; }
interface ConsolidationShipment { id: string; code: string; name: string; date: string; status: 'draft' | 'pending' | 'shipped' | 'received' | 'cancelled'; createdBy: string; createdAt: string; trackingNumbers: TrackingNumber[]; }

const MOCK_SHIPMENTS: ConsolidationShipment[] = [
  { id: 'cs-1', code: 'CON-20261026-001', name: '10月底深圳集運', date: '2026-10-26', status: 'shipped', createdBy: 'admin', createdAt: '2026-10-26 09:00', trackingNumbers: [
    { id: 'tn-1', trackingNumber: 'SF123456789CN', carrier: '順豐速運', shipDate: '2026-10-26', weight: 12.5, note: '', linkedPOs: [
      { id: 'po-1', poCode: 'PO-20261020-001', poDate: '2026-10-20', supplier: '深圳電子', itemCount: 3, totalQty: 50, status: 'confirmed' },
      { id: 'po-2', poCode: 'PO-20261021-002', poDate: '2026-10-21', supplier: '廣州配件', itemCount: 2, totalQty: 30, status: 'confirmed' },
    ]},
    { id: 'tn-2', trackingNumber: 'YT987654321CN', carrier: '圓通速遞', shipDate: '2026-10-27', weight: 8.3, note: '第二批', linkedPOs: [
      { id: 'po-4', poCode: 'PO-20261023-004', poDate: '2026-10-23', supplier: '佛山五金', itemCount: 2, totalQty: 20, status: 'confirmed' },
    ]},
  ]},
  { id: 'cs-2', code: 'CON-20261020-002', name: '10月中深圳集運', date: '2026-10-20', status: 'received', createdBy: 'admin', createdAt: '2026-10-20 14:00', trackingNumbers: [
    { id: 'tn-3', trackingNumber: 'ZT111222333CN', carrier: '中通快遞', shipDate: '2026-10-20', weight: 15.0, note: '', linkedPOs: [
      { id: 'po-6', poCode: 'PO-20261015-006', poDate: '2026-10-15', supplier: '深圳電子', itemCount: 5, totalQty: 100, status: 'confirmed' },
    ]},
  ]},
  { id: 'cs-3', code: 'CON-20261015-003', name: '10月初集運', date: '2026-10-15', status: 'draft', createdBy: 'admin', createdAt: '2026-10-15 10:00', trackingNumbers: [] },
];

const MOCK_POS = [
  { id: 'po-7', poCode: 'PO-20261025-007', poDate: '2026-10-25', supplier: '東莞塑膠', itemCount: 4, totalQty: 60, status: 'ordered' },
  { id: 'po-8', poCode: 'PO-20261025-008', poDate: '2026-10-25', supplier: '佛山五金', itemCount: 2, totalQty: 25, status: 'ordered' },
];

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  draft: { label: '草稿', variant: 'secondary' },
  pending: { label: '集運中', variant: 'outline' },
  shipped: { label: '已出倉', variant: 'default' },
  received: { label: '已完成', variant: 'default' },
  cancelled: { label: '已取消', variant: 'destructive' },
};

const CARRIERS = ['順豐速運', '圓通速遞', '中通快遞', '韻達快遞', '申通快遞', 'EMS'];

export default function CrossBorderPage() {
  const [view, setView] = useState<'list' | 'detail' | 'tracking'>('list');
  const [selectedShipment, setSelectedShipment] = useState<ConsolidationShipment | null>(null);
  const [selectedTracking, setSelectedTracking] = useState<TrackingNumber | null>(null);
  const [shipments, setShipments] = useState<ConsolidationShipment[]>(MOCK_SHIPMENTS);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [addTrackingOpen, setAddTrackingOpen] = useState(false);
  const [addPoOpen, setAddPoOpen] = useState(false);
  const [poSearch, setPoSearch] = useState('');
  const [newShipment, setNewShipment] = useState({ name: '', date: new Date().toISOString().slice(0, 10) });
  const [newTracking, setNewTracking] = useState({ trackingNumber: '', carrier: CARRIERS[0], shipDate: new Date().toISOString().slice(0, 10), weight: '', note: '' });

  const filtered = useMemo(() => {
    let list = [...shipments];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(s => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.trackingNumbers.some(t => t.trackingNumber.toLowerCase().includes(q)));
    }
    if (statusFilter !== 'all') list = list.filter(s => s.status === statusFilter);
    return list;
  }, [shipments, searchQuery, statusFilter]);

  const totalTracking = (s: ConsolidationShipment) => s.trackingNumbers.length;
  const totalPOs = (s: ConsolidationShipment) => s.trackingNumbers.reduce((sum, t) => sum + t.linkedPOs.length, 0);
  const totalItems = (s: ConsolidationShipment) => s.trackingNumbers.reduce((sum, t) => sum + t.linkedPOs.reduce((s2, po) => s2 + po.itemCount, 0), 0);

  const handleCreate = () => {
    if (!newShipment.name.trim()) { toast.error('請輸入集運單名稱'); return; }
    const code = 'CON-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(shipments.length + 1).padStart(3, '0');
    const sh: ConsolidationShipment = { id: 'cs-' + Date.now(), code, name: newShipment.name, date: newShipment.date, status: 'draft', createdBy: 'admin', createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '), trackingNumbers: [] };
    setShipments(prev => [sh, ...prev]);
    setCreateOpen(false);
    setNewShipment({ name: '', date: new Date().toISOString().slice(0, 10) });
    toast.success('集運單已建立');
  };

  const handleAddTracking = () => {
    if (!selectedShipment) return;
    if (!newTracking.trackingNumber.trim()) { toast.error('請輸入快遞單號'); return; }
    const tn: TrackingNumber = { id: 'tn-' + Date.now(), trackingNumber: newTracking.trackingNumber.trim(), carrier: newTracking.carrier, shipDate: newTracking.shipDate, weight: newTracking.weight ? Number(newTracking.weight) : null, note: newTracking.note, linkedPOs: [] };
    setShipments(prev => prev.map(s => s.id === selectedShipment.id ? { ...s, trackingNumbers: [...s.trackingNumbers, tn] } : s));
    setSelectedShipment(prev => prev ? { ...prev, trackingNumbers: [...prev.trackingNumbers, tn] } : null);
    setAddTrackingOpen(false);
    setNewTracking({ trackingNumber: '', carrier: CARRIERS[0], shipDate: new Date().toISOString().slice(0, 10), weight: '', note: '' });
    toast.success('快遞單號已新增');
  };

  const handleAddPO = (po: typeof MOCK_POS[0]) => {
    if (!selectedTracking) return;
    if (selectedTracking.linkedPOs.some(p => p.id === po.id)) { toast.error('此採購單已關聯'); return; }
    const linked: LinkedPO = { id: po.id, poCode: po.poCode, poDate: po.poDate, supplier: po.supplier, itemCount: po.itemCount, totalQty: po.totalQty, status: 'linked' };
    const updated = { ...selectedTracking, linkedPOs: [...selectedTracking.linkedPOs, linked] };
    setShipments(prev => prev.map(s => s.id === selectedShipment!.id ? { ...s, trackingNumbers: s.trackingNumbers.map(t => t.id === selectedTracking.id ? updated : t) } : s));
    setSelectedShipment(prev => prev ? { ...prev, trackingNumbers: prev.trackingNumbers.map(t => t.id === selectedTracking.id ? updated : t) } : null);
    setSelectedTracking(updated);
    toast.success('已關聯採購單');
  };

  const handleUnlinkPO = (poId: string) => {
    if (!selectedTracking) return;
    if (!window.confirm('確定要解除此採購單的關聯嗎？（原始採購單不會被刪除）')) return;
    const updated = { ...selectedTracking, linkedPOs: selectedTracking.linkedPOs.filter(p => p.id !== poId) };
    setShipments(prev => prev.map(s => s.id === selectedShipment!.id ? { ...s, trackingNumbers: s.trackingNumbers.map(t => t.id === selectedTracking.id ? updated : t) } : s));
    setSelectedShipment(prev => prev ? { ...prev, trackingNumbers: prev.trackingNumbers.map(t => t.id === selectedTracking.id ? updated : t) } : null);
    setSelectedTracking(updated);
    toast.success('已解除關聯');
  };

  const handleDeleteTracking = (tnId: string) => {
    if (!selectedShipment) return;
    const tn = selectedShipment.trackingNumbers.find(t => t.id === tnId);
    if (!tn) return;
    if (tn.linkedPOs.length > 0) { toast.error('此快遞單號已關聯採購單，請先解除所有關聯'); return; }
    if (!window.confirm('確定要刪除此快遞單號嗎？')) return;
    setShipments(prev => prev.map(s => s.id === selectedShipment.id ? { ...s, trackingNumbers: s.trackingNumbers.filter(t => t.id !== tnId) } : s));
    setSelectedShipment(prev => prev ? { ...prev, trackingNumbers: prev.trackingNumbers.filter(t => t.id !== tnId) } : null);
    toast.success('已刪除快遞單號');
  };

  const statusLabel = (s: string) => ({ draft: '草稿', pending: '集運中', shipped: '已出倉', received: '已完成', cancelled: '已取消' }[s] ?? s);
  const statusVariant = (s: string): 'default' | 'secondary' | 'outline' | 'destructive' => ({ draft: 'secondary', pending: 'outline', shipped: 'default', received: 'default', cancelled: 'destructive' }[s] as any ?? 'secondary');

  // ---- Layer 3: Tracking number detail ----
  if (view === 'tracking' && selectedShipment && selectedTracking) {
    const availablePOs = MOCK_POS.filter(po => !selectedTracking.linkedPOs.some(p => p.id === po.id));
    const filteredPOs = poSearch.trim() ? availablePOs.filter(po => po.poCode.toLowerCase().includes(poSearch.toLowerCase()) || po.supplier.toLowerCase().includes(poSearch.toLowerCase())) : availablePOs;

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setView('detail')}><ArrowLeft className="h-4 w-4 mr-1" />返回集運單</Button>
          <Package className="h-6 w-6" />
          <h1 className="text-2xl font-bold">快遞單號明細 — {selectedTracking.trackingNumber}</h1>
        </div>
        <Card>
          <CardHeader><CardTitle>快遞單號資訊</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-muted-foreground">快遞單號：</span>{selectedTracking.trackingNumber}</div>
            <div><span className="text-muted-foreground">快遞公司：</span>{selectedTracking.carrier}</div>
            <div><span className="text-muted-foreground">寄件日期：</span>{selectedTracking.shipDate}</div>
            <div><span className="text-muted-foreground">重量：</span>{selectedTracking.weight != null ? `${selectedTracking.weight} kg` : '未輸入'}</div>
            {selectedTracking.note && <div className="col-span-2"><span className="text-muted-foreground">備註：</span>{selectedTracking.note}</div>}
          </CardContent>
        </Card>
        <Dialog open={addPoOpen} onOpenChange={setAddPoOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>添加已有採購單</DialogTitle><DialogDescription>搜尋並選擇要關聯到此快遞單號的採購單。</DialogDescription></DialogHeader>
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={poSearch} onChange={e => setPoSearch(e.target.value)} placeholder="搜尋採購單編號、商品、供應商..." className="pl-8" />
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>採購單編號</TableHead><TableHead>採購日期</TableHead><TableHead>供應商</TableHead><TableHead className="text-right">項目數</TableHead><TableHead className="text-right">數量</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredPOs.map(po => (
                    <TableRow key={po.id}>
                      <TableCell className="font-medium">{po.poCode}</TableCell>
                      <TableCell>{po.poDate}</TableCell>
                      <TableCell>{po.supplier}</TableCell>
                      <TableCell className="text-right">{po.itemCount}</TableCell>
                      <TableCell className="text-right">{po.totalQty}</TableCell>
                      <TableCell><Button size="sm" onClick={() => handleAddPO(po)}>關聯</Button></TableCell>
                    </TableRow>
                  ))}
                  {filteredPOs.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">無可關聯的採購單</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </DialogContent>
        </Dialog>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>已關聯採購單（{selectedTracking.linkedPOs.length} 筆）</CardTitle>
            <Button size="sm" onClick={() => { setPoSearch(''); setAddPoOpen(true); }}><Plus className="h-4 w-4 mr-1" />添加採購單</Button>
          </CardHeader>
          <CardContent>
            {selectedTracking.linkedPOs.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">尚未關聯任何採購單</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>採購單編號</TableHead><TableHead>採購日期</TableHead><TableHead>供應商</TableHead><TableHead className="text-right">項目數</TableHead><TableHead className="text-right">數量</TableHead><TableHead>關聯狀態</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {selectedTracking.linkedPOs.map(po => (
                    <TableRow key={po.id}>
                      <TableCell className="font-medium">{po.poCode}</TableCell>
                      <TableCell>{po.poDate}</TableCell>
                      <TableCell>{po.supplier}</TableCell>
                      <TableCell className="text-right">{po.itemCount}</TableCell>
                      <TableCell className="text-right">{po.totalQty}</TableCell>
                      <TableCell><Badge variant={po.status === 'confirmed' ? 'default' : 'outline'}>{po.status === 'confirmed' ? '已確認' : '已關聯'}</Badge></TableCell>
                      <TableCell><Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleUnlinkPO(po.id)}><X className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Layer 2: Consolidation detail ----
  if (view === 'detail' && selectedShipment) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setView('list'); setSelectedShipment(null); }}><ArrowLeft className="h-4 w-4 mr-1" />返回列表</Button>
          <Package className="h-6 w-6" />
          <h1 className="text-2xl font-bold">集運單 — {selectedShipment.code}</h1>
          <Badge variant={statusVariant(selectedShipment.status)}>{statusLabel(selectedShipment.status)}</Badge>
        </div>
        <Card>
          <CardHeader><CardTitle>集運單基本資料</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-muted-foreground">集運單編號：</span>{selectedShipment.code}</div>
            <div><span className="text-muted-foreground">集運日期：</span>{selectedShipment.date}</div>
            <div><span className="text-muted-foreground">名稱/備註：</span>{selectedShipment.name}</div>
            <div><span className="text-muted-foreground">狀態：</span>{statusLabel(selectedShipment.status)}</div>
            <div><span className="text-muted-foreground">建立人：</span>{selectedShipment.createdBy}</div>
            <div><span className="text-muted-foreground">建立時間：</span>{selectedShipment.createdAt}</div>
            <div><span className="text-muted-foreground">快遞單號數：</span>{selectedShipment.trackingNumbers.length}</div>
            <div><span className="text-muted-foreground">關聯採購單：</span>{selectedShipment.trackingNumbers.reduce((s, t) => s + t.linkedPOs.length, 0)} 筆</div>
            <div><span className="text-muted-foreground">商品總數：</span>{selectedShipment.trackingNumbers.reduce((s, t) => s + t.linkedPOs.reduce((s2, po) => s2 + po.itemCount, 0), 0)} 件</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>快遞單號管理</CardTitle>
            <Button size="sm" onClick={() => setAddTrackingOpen(true)}><Plus className="h-4 w-4 mr-1" />新增快遞單號</Button>
          </CardHeader>
          <CardContent>
            {selectedShipment.trackingNumbers.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">尚無快遞單號，請點「新增快遞單號」</p>
            ) : (
              <div className="space-y-3">
                {selectedShipment.trackingNumbers.map(tn => (
                  <Card key={tn.id} className="cursor-pointer hover:border-primary transition-colors" onClick={() => { setSelectedTracking(tn); setView('tracking'); }}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="font-medium flex items-center gap-2"><Truck className="h-4 w-4" />{tn.trackingNumber}</div>
                        <div className="text-xs text-muted-foreground">{tn.carrier} · 寄件日期：{tn.shipDate} · 重量：{tn.weight != null ? `${tn.weight} kg` : '未輸入'}{tn.note && ` · ${tn.note}`}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline">已關聯 {tn.linkedPOs.length} 筆採購單</Badge>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteTracking(tn.id); }}><X className="h-4 w-4" /></Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Dialog open={addTrackingOpen} onOpenChange={setAddTrackingOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>新增快遞單號</DialogTitle><DialogDescription>輸入快遞單號及其基本資訊。</DialogDescription></DialogHeader>
            <div className="space-y-3">
              <div><Label>快遞單號</Label><Input value={newTracking.trackingNumber} onChange={e => setNewTracking(s => ({ ...s, trackingNumber: e.target.value }))} placeholder="SF123456789CN" /></div>
              <div><Label>快遞公司</Label><Select value={newTracking.carrier} onValueChange={v => setNewTracking(s => ({ ...s, carrier: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CARRIERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>寄件日期</Label><Input type="date" value={newTracking.shipDate} onChange={e => setNewTracking(s => ({ ...s, shipDate: e.target.value }))} /></div>
              <div><Label>重量 (kg)</Label><Input type="number" step="0.1" value={newTracking.weight} onChange={e => setNewTracking(s => ({ ...s, weight: e.target.value }))} placeholder="選填" /></div>
              <div><Label>備註</Label><Input value={newTracking.note} onChange={e => setNewTracking(s => ({ ...s, note: e.target.value }))} placeholder="選填" /></div>
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setAddTrackingOpen(false)}>取消</Button><Button onClick={handleAddTracking}>新增</Button></div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ---- Layer 1: Consolidation list ----
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3"><Globe className="h-6 w-6" /><h1 className="text-2xl font-bold">集運倉管理</h1></div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" />新增集運單</Button>
      </div>
      <Card>
        <CardHeader><CardTitle>集運單列表</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜尋集運單編號、名稱或快遞單號..." className="pl-8" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="狀態篩選" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部狀態</SelectItem>
                <SelectItem value="draft">草稿</SelectItem>
                <SelectItem value="pending">集運中</SelectItem>
                <SelectItem value="shipped">已出倉</SelectItem>
                <SelectItem value="received">已完成</SelectItem>
                <SelectItem value="cancelled">已取消</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>集運單編號</TableHead><TableHead>集運日期</TableHead><TableHead>集運單名稱/備註</TableHead><TableHead className="text-right">快遞單號</TableHead><TableHead className="text-right">關聯採購單</TableHead><TableHead className="text-right">商品總數</TableHead><TableHead>狀態</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.map(s => (
                <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { setSelectedShipment(s); setView('detail'); }}>
                  <TableCell className="font-medium">{s.code}</TableCell>
                  <TableCell>{s.date}</TableCell>
                  <TableCell>{s.name}</TableCell>
                  <TableCell className="text-right">{s.trackingNumbers.length}</TableCell>
                  <TableCell className="text-right">{s.trackingNumbers.reduce((sum, t) => sum + t.linkedPOs.length, 0)}</TableCell>
                  <TableCell className="text-right">{s.trackingNumbers.reduce((sum, t) => sum + t.linkedPOs.reduce((s2, po) => s2 + po.itemCount, 0), 0)}</TableCell>
                  <TableCell><Badge variant={statusVariant(s.status)}>{statusLabel(s.status)}</Badge></TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setSelectedShipment(s); setView('detail'); }}><FileText className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">尚無集運單</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>新增集運單</DialogTitle><DialogDescription>建立新的集運批次。</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label>集運日期</Label><Input type="date" value={newShipment.date} onChange={e => setNewShipment(s => ({ ...s, date: e.target.value }))} /></div>
            <div><Label>集運單名稱/備註</Label><Input value={newShipment.name} onChange={e => setNewShipment(s => ({ ...s, name: e.target.value }))} placeholder="例如：10月底深圳集運" /></div>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button onClick={handleCreate}>建立</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
