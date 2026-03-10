import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FolderTree, Database, Tag } from 'lucide-react';
import { CategoryTab } from './components/CategoryTab';
import { SpecLibraryTab } from './components/SpecLibraryTab';
import { BrandsTab } from './components/BrandsTab';

// 規格與分類管理主頁面
export default function AdminCategories() {
    const [activeTab, setActiveTab] = useState('categories');

    return (
        <div className="space-y-6">
            {/* 頁面標題 */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">規格與分類管理</h1>
                    <p className="text-muted-foreground">管理多層級分類及全域共享的屬性規格庫</p>
                </div>
            </div>

            {/* 三個主要 Tab */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
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
            </Tabs>
        </div>
    );
}
