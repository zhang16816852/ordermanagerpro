import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

/**
 * ⚠️ 一定要用 Service Role Key
 */
const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,              // 👈 從 .env 來
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!, // 👈 service_role
)
/**
 * 🔹 你的原始 JSON（只取需要的欄位）
 */
const users = [
   /* {
        id: "2434e97f-60f2-4240-b10a-bd69077fc839",
        email: "test003@gmail.com",
    },
    {
        id: "74183fca-01b5-492e-be35-9df5b57c1d52",
        email: "test002@gmail.com",
    },*/
    {
        id: "8a46dfb7-8dae-4066-a518-79ef31ce1df1",
        email: "test001@gmail.com",
    }/*,
    {
        id: "e52c7555-81f5-4d9c-9e62-a1e6b27359b5",
        email: "qaz200581@gmail.com",
    }*/,
]

async function run() {
    for (const user of users) {
        const { error } = await supabase.auth.admin.createUser({
          id: user.id,
          email: user.email,
          email_confirm: true, // ✅ 不寄驗證信
          password: 's1234567',
        })
        /*const { error } = await supabase.auth.admin.updateUserById(user.id, {
            password: 's1234567',
        })*/

        if (error) {
            if (error.message.includes('already')) {
                console.log(`⏭️ already exists: ${user.email}`)
            } else {
                console.error(`❌ failed: ${user.email}`, error.message)
            }
        } else {
            console.log(`✅ created: ${user.email}`)
        }
    }

    console.log('🎉 import finished')
}

run()
