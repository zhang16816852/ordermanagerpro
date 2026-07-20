import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FolderTree, Database, Tag, Smartphone, Link2 } from 'lucide-react';
import { CategoryTab } from './components/CategoryTab';
import { SpecLibraryTab } from './components/SpecLibraryTab';
import { BrandsTab } from './components/BrandsTab';
import { DeviceModelManager } from '../libraries/device-models/DeviceModelManager';
import { CategoryBindingTab } from './components/CategoryBindingTab';

// 規格與分類管理主頁面
export default function AdminCategories() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'categories');

    return (
        <div className="space-y-6">
            {/* 頁面標題 */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">規格、分類與型號管理</h1>
                    <p className="text-muted-foreground">管理多層級分類、全域共享的屬性規格庫及型號標籤</p>
                </div>
            </div>

            {/* 主要 Tab */}
            <Tabs value={activeTab} onValueChange={(v) => {
                setActiveTab(v);
                setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.set("tab", v);
                    return next;
                }, { replace: true });
            }} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="categories" className="flex items-center gap-2">
                        <FolderTree className="h-4 w-4" />
                        分類架構
                    </TabsTrigger>
                    <TabsTrigger value="spec_library" className="flex items-center gap-2">
                        <Database className="h-4 w-4" />
                        規格屬性庫
                    </TabsTrigger>
                    <TabsTrigger value="brands" className="flex items-center gap-2">
                        <Tag className="h-4 w-4" />
                        品牌管理
                    </TabsTrigger>
                    <TabsTrigger value="models" className="flex items-center gap-2">
                        <Smartphone className="h-4 w-4" />
                        型號標籤庫
                    </TabsTrigger>
                    <TabsTrigger value="bindings" className="flex items-center gap-2">
                        <Link2 className="h-4 w-4" />
                        分類綁定管理
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="categories" className="space-y-4">
                    <CategoryTab />
                </TabsContent>

                <TabsContent value="spec_library" className="space-y-4">
                    <SpecLibraryTab />
                </TabsContent>

                <TabsContent value="brands" className="space-y-4">
                    <BrandsTab />
                </TabsContent>

                <TabsContent value="models" className="space-y-4">
                    <div className="rounded-xl border bg-card shadow-sm p-4">
                        <DeviceModelManager />
                    </div>
                </TabsContent>

                <TabsContent value="bindings" className="space-y-4">
                    <div className="rounded-xl border bg-card shadow-sm p-4">
                        <CategoryBindingTab />
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}
