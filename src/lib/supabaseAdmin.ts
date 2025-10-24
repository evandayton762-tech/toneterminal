import { createClient } from "@supabase/supabase-js";

const detectedUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;

const supabaseUrl =
  detectedUrl && detectedUrl.startsWith("https://") ? detectedUrl : undefined;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.warn(
    "Supabase admin client missing NEXT_PUBLIC_SUPABASE_URL (https://...) or SUPABASE_SERVICE_ROLE_KEY."
  );
}

export const supabaseAdmin =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: {
          persistSession: false,
        },
      })
    : undefined;
