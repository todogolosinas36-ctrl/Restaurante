import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://ujzxtqehjsrdfdynlwwc.supabase.co";
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_OnpGCUWIJGXwUZQC6cZpjw_oGmi_9mc";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
