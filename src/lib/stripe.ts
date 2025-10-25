import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      apiVersion: "2024-06-20" as Stripe.StripeConfig["apiVersion"],
    })
  : undefined;

if (!stripeSecretKey) {
  console.warn(
    "Stripe secret key missing. Set STRIPE_SECRET_KEY to enable billing features."
  );
}
