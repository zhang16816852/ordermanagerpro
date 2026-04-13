import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface SupabaseActionOptions<TData, TVariables> {
    successMessage?: string;
    errorMessage?: string;
    loadingMessage?: string;
    invalidateKeys?: any[][];
    onSuccess?: (data: TData, variables: TVariables) => void;
    onError?: (error: Error) => void;
}

/**
 * 標準化 Supabase Mutation Hook
 * 整合了 Toast 通知與 Query 失效邏輯
 */
export function useSupabaseAction<TData = any, TVariables = any>(
    mutationFn: (variables: TVariables) => Promise<TData>,
    options: SupabaseActionOptions<TData, TVariables> = {}
) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn,
        onMutate: () => {
            if (options.loadingMessage) {
                toast.loading(options.loadingMessage, { id: 'supabase-action' });
            }
        },
        onSuccess: (data, variables) => {
            toast.dismiss('supabase-action');
            
            if (options.successMessage) {
                toast.success(options.successMessage);
            }

            if (options.invalidateKeys) {
                options.invalidateKeys.forEach(key => {
                    queryClient.invalidateQueries({ queryKey: key });
                });
            }

            if (options.onSuccess) {
                options.onSuccess(data, variables);
            }
        },
        onError: (error: Error) => {
            toast.dismiss('supabase-action');
            const message = options.errorMessage || `操作失敗: ${error.message}`;
            toast.error(message);
            
            if (options.onError) {
                options.onError(error);
            }
        },
    });
}
