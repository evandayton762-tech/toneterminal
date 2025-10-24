import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolvePlanContext } from "@/middleware/planGate";

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json(
        {
          error:
            "Supabase configuration missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        },
        { status: 500 }
      );
    }

    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Authorization header missing." },
        { status: 401 }
      );
    }

    const accessToken = authorization.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !user) {
      return NextResponse.json(
        { error: "Invalid or expired session." },
        { status: 401 }
      );
    }

    const context = await resolvePlanContext(user.id);
    const { profile, plan } = context;

    return NextResponse.json({
      userId: user.id,
      email: user.email,
      ...profile,
      tier: plan.id,
    });
  } catch (error) {
    console.error("check-credits error", error);
    return NextResponse.json(
      { error: "Unable to fetch credits. Please try again later." },
      { status: 500 }
    );
  }
}
