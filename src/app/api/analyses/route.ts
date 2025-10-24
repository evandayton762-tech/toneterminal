import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getRecentAnalyses } from "@/lib/analysis";

const buildError = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return buildError(
      "Supabase configuration missing on server.",
      500
    );
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return buildError("Authorization header missing.", 401);
  }

  const accessToken = authorization.replace("Bearer ", "");
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user) {
    return buildError("Invalid or expired session.", 401);
  }

  const analyses = await getRecentAnalyses(user.id, 10);
  return NextResponse.json({ items: analyses });
}
