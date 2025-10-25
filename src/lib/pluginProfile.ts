import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sanitizePluginSelection } from "@/lib/pluginInventory";
import type { DawId } from "@/data/daws";

export type PluginProfileRow = {
  id: string;
  user_id: string;
  daw: string;
  plugins: string[];
  created_at: string | null;
  updated_at: string | null;
};

const TABLE = "user_plugin_profiles";

function ensureAdmin() {
  if (!supabaseAdmin) {
    throw new Error(
      "Supabase admin client is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return supabaseAdmin;
}

export async function getPluginProfile(
  userId: string,
  daw: DawId
): Promise<PluginProfileRow | null> {
  const client = ensureAdmin();
  const { data, error } = await client
    .from(TABLE)
    .select("id, user_id, daw, plugins, created_at, updated_at")
    .eq("user_id", userId)
    .eq("daw", daw)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to load plugin profile: ${error.message}`);
  }

  return (data as PluginProfileRow | null) ?? null;
}

export async function upsertPluginProfile(
  userId: string,
  daw: DawId,
  plugins: string[]
): Promise<PluginProfileRow> {
  const client = ensureAdmin();
  const sanitized = sanitizePluginSelection(daw, plugins);

  const { data, error } = await client
    .from(TABLE)
    .upsert(
      {
        user_id: userId,
        daw,
        plugins: sanitized,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,daw" }
    )
    .select("id, user_id, daw, plugins, created_at, updated_at")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to save plugin profile: ${error?.message ?? "Unknown error"}`
    );
  }

  return data as PluginProfileRow;
}

export async function deletePluginProfile(userId: string, daw: DawId): Promise<void> {
  const client = ensureAdmin();
  const { error } = await client
    .from(TABLE)
    .delete()
    .eq("user_id", userId)
    .eq("daw", daw);

  if (error) {
    throw new Error(`Failed to delete plugin profile: ${error.message}`);
  }
}
