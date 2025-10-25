import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getOrCreateProfile,
  setStripeCustomerId,
} from "@/lib/profile";

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

    const token = authorization.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return buildError("Invalid or expired session.", 401);
    }

    const profile = await getOrCreateProfile(user.id);
    let customerId = profile.stripe_customer_id ?? null;

    if (!customerId) {
      try {
        const search = await stripe.customers.search({
          query: `metadata['supabase_user_id']:'${user.id}'`,
        });
        if (search.data.length > 0) {
          customerId = search.data[0].id;
        }
      } catch (searchError) {
        console.warn("Stripe customer search failed", searchError);
      }
    }

    if (!customerId && user.email) {
      const { data } = await stripe.customers.list({
        email: user.email,
        limit: 1,
      });
      if (data.length > 0) {
        customerId = data[0].id;
      }
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: {
          supabase_user_id: user.id,
        },
      });
      customerId = customer.id;
    } else {
      try {
        await stripe.customers.update(customerId, {
          metadata: {
            supabase_user_id: user.id,
          },
        });
      } catch (updateMetaError) {
        console.warn("Unable to update Stripe customer metadata", updateMetaError);
      }
    }

    if (customerId && customerId !== profile.stripe_customer_id) {
      try {
        await setStripeCustomerId(user.id, customerId);
      } catch (setError) {
        console.warn("Failed to persist Stripe customer ID", setError);
      }
    }

    const origin =
      request.headers.get("origin") ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      "http://localhost:3000";

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId!,
      return_url: `${origin}/account`,
    });

    if (!session.url) {
      return buildError("Unable to create billing portal session.", 500);
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("/api/customer-portal error", error);
    return buildError("Unable to open customer portal. Please try again.", 500);
  }
}
