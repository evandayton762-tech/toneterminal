import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOrCreateProfile } from "@/lib/profile";

const STANDARD_PRICE_ID = process.env.STRIPE_PRICE_ID ?? "";
const PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? "";

const buildError = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

export async function POST(request: Request) {
  try {
    if (!stripe) {
      return buildError(
        "Stripe is not configured. Set STRIPE_SECRET_KEY.",
        500
      );
    }

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
      error: authError,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !user) {
      return buildError("Invalid or expired session.", 401);
    }

    const profile = await getOrCreateProfile(user.id);

    const { searchParams } = new URL(request.url);
    const planId = searchParams.get("planId") ?? "standard_15";

    let priceId: string | null = null;
    if (planId === "pro_29") {
      priceId = PRO_PRICE_ID || null;
    } else {
      priceId = STANDARD_PRICE_ID || null;
    }

    if (!priceId) {
      const envHint =
        planId === "pro_29"
          ? "Set STRIPE_PRO_PRICE_ID to your Pro subscription price ID."
          : "Set STRIPE_PRICE_ID to your Standard subscription price ID.";
      return buildError(
        `Stripe price ID missing for ${planId}. ${envHint}`,
        500
      );
    }

    if (profile.tier === "pro" && planId === "pro_29") {
      return buildError("You already have an active Pro subscription.");
    }

    const origin =
      request.headers.get("origin") ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      "https://toneterminal.app";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: user.email ?? undefined,
      automatic_tax: { enabled: false },
      allow_promotion_codes: true,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${origin}/success`,
      cancel_url: `${origin}/account`,
      metadata: {
        supabase_user_id: user.id,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
        },
      },
    });

    if (!session.url) {
      return buildError("Unable to create checkout session.", 500);
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("/api/checkout error", error);
    return buildError("Unable to start checkout. Please try again.", 500);
  }
}
