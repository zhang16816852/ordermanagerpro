import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { imageStorageService } from '@/services/imageStorageService';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { ImageIcon, Star, Trash2, Upload, Loader2, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// =============================================
// 類型定義
// =============================================
export interface ProductImage {
    id: string;
    entity_type: 'product' | 'variant';
    entity_id: string;
    storage_path: string | null;
    external_url: string | null;
    url: string;
    is_cover: boolean;
    sort_order: number;
    alt_text: string | null;
    created_at: string;
}

interface ProductImageManagerProps {
    entityType: 'product' | 'variant';
    entityId: string;
    className?: string;
}

// =============================================
// 產品圖片管理元件
// 支援：上傳 / 設封面 / 刪除 / 排序
// =============================================
export function ProductImageManager({ entityType, entityId, className }: ProductImageManagerProps) {
    const queryClient = useQueryClient();
    const [dragOver, setDragOver] = useState(false);

    // 查詢此實體的所有圖片
    const { data: images = [], isLoading } = useQuery({
        queryKey: ['product-images', entityType, entityId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('product_images')
                .select('*')
                .eq('entity_type', entityType)
                .eq('entity_id', entityId)
                .order('sort_order', { ascending: true });

            if (error) throw error;
            return data as ProductImage[];
        },
        enabled: !!entityId,
    });

    // 上傳圖片 Mutation
    const uploadMutation = useMutation({
        mutationFn: async (files: File[]) => {
            const folder = `${entityType}s/${entityId}`;
            const isFirstImage = images.length === 0;

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const { url, storagePath } = await imageStorageService.upload(file, folder);

                const { error } = await supabase.from('product_images').insert({
                    entity_type: entityType,
                    entity_id: entityId,
                    storage_path: storagePath,
                    url,
                    is_cover: isFirstImage && i === 0, // 第一張自動設為封面
                    sort_order: images.length + i,
                    alt_text: null,
                });

                if (error) throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['product-images', entityType, entityId] });
            toast.success('圖片上傳成功');
        },
        onError: (err: Error) => toast.error(getErrorMessage(err)),
    });

    // 設為封面 Mutation
    const setCoverMutation = useMutation({
        mutationFn: async (imageId: string) => {
            // 先取消所有封面標記
            await supabase
                .from('product_images')
                .update({ is_cover: false })
                .eq('entity_type', entityType)
                .eq('entity_id', entityId);

            // 設定新封面
            const { error } = await supabase
                .from('product_images')
                .update({ is_cover: true })
                .eq('id', imageId);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['product-images', entityType, entityId] });
            toast.success('封面圖片已更新');
        },
        onError: () => toast.error('封面設定失敗'),
    });

    // 刪除圖片 Mutation
    const deleteMutation = useMutation({
        mutationFn: async (image: ProductImage) => {
            // 先從 Storage 刪除實際檔案
            if (image.storage_path) {
                await imageStorageService.delete(image.storage_path);
            }
            // 再從資料庫刪除記錄
            const { error } = await supabase
                .from('product_images')
                .delete()
                .eq('id', image.id);

            if (error) throw error;

            // 若刪除的是封面，把剩餘第一張設為封面
            if (image.is_cover) {
                const remaining = images.filter(img => img.id !== image.id);
                if (remaining.length > 0) {
                    await supabase
                        .from('product_images')
                        .update({ is_cover: true })
                        .eq('id', remaining[0].id);
                }
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['product-images', entityType, entityId] });
            toast.success('圖片已刪除');
        },
        onError: () => toast.error('圖片刪除失敗'),
    });

    // 處理檔案選擇
    const handleFiles = useCallback((files: FileList | null) => {
        if (!files || files.length === 0) return;
        const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (validFiles.length === 0) {
            toast.error('請選擇圖片檔案 (jpg, png, webp, gif)');
            return;
        }
        uploadMutation.mutate(validFiles);
    }, [uploadMutation]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
    }, [handleFiles]);

    if (!entityId) {
        return (
            <div className="text-center py-8 text-muted-foreground text-sm">
                請先儲存產品後，再管理圖片
            </div>
        );
    }

    return (
        <div className={cn('space-y-4', className)}>
            {/* 上傳區域 */}
            <div
                className={cn(
                    'border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer',
                    dragOver
                        ? 'border-primary bg-primary/5'
                        : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30'
                )}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => document.getElementById(`img-upload-${entityId}`)?.click()}
            >
                <input
                    id={`img-upload-${entityId}`}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    className="hidden"
                    onChange={(e) => handleFiles(e.target.files)}
                />
                {uploadMutation.isPending ? (
                    <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <span className="text-sm text-muted-foreground">上傳中...</span>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-2">
                        <Upload className="h-8 w-8 text-muted-foreground" />
                        <span className="text-sm font-medium">點擊或拖曳圖片至此上傳</span>
                        <span className="text-xs text-muted-foreground">支援 JPG、PNG、WebP，最大 5MB，可多選</span>
                    </div>
                )}
            </div>

            {/* 圖片 Grid */}
            {isLoading ? (
                <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : images.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                    <ImageIcon className="h-10 w-10 opacity-30" />
                    <span className="text-sm">尚未上傳任何圖片</span>
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {images.map((image) => (
                        <div
                            key={image.id}
                            className={cn(
                                'group relative aspect-square rounded-lg overflow-hidden border-2 transition-all',
                                image.is_cover
                                    ? 'border-primary ring-2 ring-primary/30'
                                    : 'border-transparent hover:border-muted-foreground/30'
                            )}
                        >
                            <img
                                src={image.url}
                                alt={image.alt_text || '產品圖片'}
                                className="w-full h-full object-cover"
                            />

                            {/* 封面標記 */}
                            {image.is_cover && (
                                <div className="absolute top-1.5 left-1.5">
                                    <span className="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded">
                                        封面
                                    </span>
                                </div>
                            )}

                            {/* 操作按鈕 (hover 顯示) */}
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                                {!image.is_cover && (
                                    <Button
                                        size="icon"
                                        variant="secondary"
                                        className="h-8 w-8"
                                        title="設為封面"
                                        onClick={() => setCoverMutation.mutate(image.id)}
                                        disabled={setCoverMutation.isPending}
                                    >
                                        <Star className="h-4 w-4" />
                                    </Button>
                                )}
                                <Button
                                    size="icon"
                                    variant="destructive"
                                    className="h-8 w-8"
                                    title="刪除圖片"
                                    onClick={() => {
                                        if (confirm('確定要刪除此圖片？')) {
                                            deleteMutation.mutate(image);
                                        }
                                    }}
                                    disabled={deleteMutation.isPending}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
