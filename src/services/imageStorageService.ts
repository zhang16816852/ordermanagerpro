import { supabase } from '@/integrations/supabase/client';

// =============================================
// 圖片儲存服務介面（Storage 抽象層）
// 目的：預留換源接口，未來切換至 Cloudflare R2
// 或其他 CDN 時，只需實作此介面，不需修改其他程式碼
// =============================================

export interface UploadResult {
    url: string;           // 最終可公開存取的 URL
    storagePath: string;   // 儲存路徑（刪除時使用）
}

export interface IImageStorageService {
    /** 上傳圖片，回傳公開 URL 與儲存路徑 */
    upload(file: File, folder: string): Promise<UploadResult>;
    /** 刪除指定路徑的圖片 */
    delete(storagePath: string): Promise<void>;
    /** 由儲存路徑計算公開 URL */
    getUrl(storagePath: string): string;
}

// =============================================
// Supabase Storage 實作
// =============================================

const BUCKET = 'product-images';
const SUPABASE_URL = 'https://aweqytcelujpqezjitsk.supabase.co';

export class SupabaseStorageService implements IImageStorageService {
    async upload(file: File, folder: string): Promise<UploadResult> {
        // 產生唯一檔名（避免覆蓋）
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        const filename = `${timestamp}-${randomSuffix}.${ext}`;
        const storagePath = `${folder}/${filename}`;

        const { error } = await supabase.storage
            .from(BUCKET)
            .upload(storagePath, file, {
                cacheControl: '3600',
                upsert: false,
            });

        if (error) throw new Error(`圖片上傳失敗: ${error.message}`);

        return {
            url: this.getUrl(storagePath),
            storagePath,
        };
    }

    async delete(storagePath: string): Promise<void> {
        const { error } = await supabase.storage
            .from(BUCKET)
            .remove([storagePath]);

        if (error) throw new Error(`圖片刪除失敗: ${error.message}`);
    }

    getUrl(storagePath: string): string {
        return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
    }
}

// =============================================
// 未來換源範例（注解保留作文件）
// =============================================
// export class CloudflareR2Service implements IImageStorageService {
//     async upload(file, folder) { /* R2 實作 */ }
//     async delete(storagePath) { /* R2 實作 */ }
//     getUrl(storagePath) { return `https://cdn.yoursite.com/${storagePath}`; }
// }

// =============================================
// 單例 - 全站使用此服務
// 未來切換 CDN 只需把這行改成 new CloudflareR2Service()
// =============================================
export const imageStorageService: IImageStorageService = new SupabaseStorageService();
