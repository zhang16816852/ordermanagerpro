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
    [/could not find|not found/i, '找不到資料'],
    [/invalid login credentials/i, '帳號或密碼錯誤'],
    [/user already registered/i, '此信箱已註冊'],
    [/email not confirmed/i, '請先驗證您的信箱'],
    [/password should be at least 6 characters/i, '密碼至少需要 6 個字元'],
    [/invalid email/i, '請輸入有效的電子信箱'],
];

export function getErrorMessage(error: unknown, fallback = '操作失敗'): string {
    if (!error) return fallback;

    const message = typeof error === 'string'
        ? error
        : error instanceof Error
            ? error.message
            : String(error);

    if (!message) return fallback;

    const code = (error as any)?.code;
    if (code && errorCodeMap[code]) return errorCodeMap[code];

    for (const [pattern, translation] of errorMessagePatterns) {
        if (pattern.test(message)) return translation;
    }

    // 若訊息含有中文，代表已是自訂中文訊息，直接回傳
    if (/[\u4e00-\u9fff]/.test(message)) return message;

    return fallback;
}
