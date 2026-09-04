const errorCodeMap: Record<string, string> = {
    '23505': '此資料已存在',
    '23503': '關聯資料不存在',
    '23502': '缺少必填欄位',
    '22001': '輸入內容過長',
    '42P01': '資料異常，請稍後再試',
    '42501': '無權限執行此操作',
    'PGRST301': '無權限執行此操作',
    'PGRST116': '找不到資料',
};

const errorMessagePatterns: [RegExp, string][] = [
    [/duplicate key/i, '此資料已存在'],
    [/foreign key constraint/i, '關聯資料不存在'],
    [/row-level security/i, '無權限執行此操作'],
    [/not-null constraint|null value/i, '缺少必填欄位'],
    [/value too long/i, '輸入內容過長'],
    [/invalid input syntax/i, '輸入格式錯誤'],
    [/permission denied/i, '無權限'],
    [/timeout|timed out/i, '連線逾時，請稍後再試'],
    [/network error|failed to fetch|fetch failed/i, '網路連線異常'],
    [/jwt|token.*expired|invalid.*token/i, '登入已過期，請重新登入'],
    [/could not find.*candidate.*function|multiple choices|PGRST300/i, '系統函式簽章衝突，請通知管理員套用 20260901000001 修正（delete_sales_note overload）'],
    [/could not find|not found|找不到資料|找不到相關資料/i, '找不到資料'],
    [/invalid login credentials/i, '帳號或密碼錯誤'],
    [/user already registered/i, '此信箱已註冊'],
    [/email not confirmed/i, '請先驗證您的信箱'],
    [/password should be at least 6 characters/i, '密碼至少需要 6 個字元'],
    [/invalid email/i, '請輸入有效的電子信箱'],
];

function extractRawMessage(error: unknown): string {
    if (!error) return '';
    if (typeof error === 'string') return error;
    const anyErr = error as any;
    const candidates = [
        anyErr?.message,
        anyErr?.error_description,
        anyErr?.details,
        anyErr?.hint,
        anyErr?.msg,
    ].filter(Boolean).map(String);
    if (candidates.length) return candidates.join(' | ');
    if (error instanceof Error) return error.message;
    try { return String(error); } catch { return ''; }
}

function extractDetails(error: unknown): string | undefined {
    const anyErr = error as any;
    if (!anyErr || typeof anyErr !== 'object') return undefined;
    const parts: string[] = [];
    if (anyErr.details) parts.push(String(anyErr.details));
    if (anyErr.hint) parts.push(`提示: ${String(anyErr.hint)}`);
    return parts.length ? parts.join(' | ') : undefined;
}

export function getErrorMessage(error: unknown, fallback = '操作失敗'): string {
    if (!error) return fallback;

    const rawMessage = extractRawMessage(error);
    if (!rawMessage) return fallback;

    const code = (error as any)?.code ? String((error as any).code) : '';
    const details = extractDetails(error);
    const searchable = [rawMessage, details, code].filter(Boolean).join(' | ');

    if (code && errorCodeMap[code]) {
        const base = errorCodeMap[code];
        if (details) return `${base}（${details}）`;
        return base;
    }

    for (const [pattern, translation] of errorMessagePatterns) {
        if (pattern.test(searchable)) {
            if (details && !translation.includes(details)) return `${translation}（${details}）`;
            return translation;
        }
    }

    if (/[\u4e00-\u9fff]/.test(rawMessage)) {
        if (details && !rawMessage.includes(details)) return `${rawMessage}（${details}）`;
        return rawMessage;
    }

    if (code) return `${rawMessage}（${code}）`;
    if (details) return `${rawMessage}（${details}）`;
    return rawMessage || fallback;
}

export function getErrorDetails(error: unknown): { code?: string; message: string; details?: string; hint?: string } {
    const anyErr = error as any;
    return {
        code: anyErr?.code ? String(anyErr.code) : undefined,
        message: extractRawMessage(error) || '未知錯誤',
        details: anyErr?.details ? String(anyErr.details) : undefined,
        hint: anyErr?.hint ? String(anyErr.hint) : undefined,
    };
}
