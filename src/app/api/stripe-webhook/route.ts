import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import {
  DEFAULT_CREDITS,
  getOrCreateProfile,
  updateProfileTier,
  setStripeCustomerId,
} from "@/lib/profile";

export const runtime = "nodejs";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(request: Request) {
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ received: false }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  const body = await request.arrayBuffer();
  const payload = Buffer.from(body);

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (unknownError) {
    console.error("Stripe webhook signature verification failed", unknownError);
    return NextResponse.json({ received: false }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.supabase_user_id;
        if (userId) {
          await getOrCreateProfile(userId);
          await updateProfileTier(userId, "pro", 9999);
          const customerId = typeof session.customer === "string" ? session.customer : null;
          if (customerId) {
            try {
              await setStripeCustomerId(userId, customerId);
            } catch (setError) {
              console.warn("Failed to persist Stripe customer ID", setError);
            }
          }
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.supabase_user_id;
        if (!userId) {
          break;
        }
        await getOrCreateProfile(userId);
        if (subscription.status === "active" || subscription.status === "trialing") {
          await updateProfileTier(userId, "pro", 9999);
        } else if (subscription.status === "canceled" || subscription.status === "unpaid") {
          await updateProfileTier(userId, "free", DEFAULT_CREDITS);
        }
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id ?? null;
        if (userId && customerId) {
          try {
            await setStripeCustomerId(userId, customerId);
          } catch (setError) {
            console.warn("Failed to persist Stripe customer ID", setError);
          }
        }
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.supabase_user_id;
        if (userId) {
          await updateProfileTier(userId, "free", DEFAULT_CREDITS);
        }
        break;
      }
      default:
        break;
    }
  } catch (unknownError) {
    console.error("Stripe webhook handling error", unknownError);
    return NextResponse.json({ received: false }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
