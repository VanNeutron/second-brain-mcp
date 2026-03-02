import { createHash } from "node:crypto";
import { supabase } from "./supabase.js";

export interface ApiKey {
  id: string;
  name: string;
  permissions: string[];
}

export async function authenticateRequest(
  authHeader: string | undefined
): Promise<ApiKey | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  const keyHash = createHash("sha256").update(token).digest("hex");

  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, permissions, expires_at, is_active")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .single();

  if (error || !data) {
    return null;
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return null;
  }

  // Update last_used_at (fire-and-forget)
  supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then();

  return {
    id: data.id,
    name: data.name,
    permissions: data.permissions,
  };
}

export function hasPermission(apiKey: ApiKey, permission: string): boolean {
  return apiKey.permissions.includes(permission);
}
