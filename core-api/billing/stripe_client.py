import os
import stripe
import logging

logger = logging.getLogger("deploymantis.billing.stripe_client")

# Initialize Stripe with the API Key if available.
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
STRIPE_TEST_MODE = os.getenv("STRIPE_TEST_MODE", "true").lower() == "true"

# Stripe library automatically picks up stripe.api_key
stripe.api_key = STRIPE_SECRET_KEY

def create_checkout_session(tenant_id: str, org_name: str, price_id: str, seats: int, success_url: str, cancel_url: str) -> str:
    """Create a Stripe Checkout Session for a subscription and return its URL."""
    if not STRIPE_SECRET_KEY:
        logger.warning("STRIPE_SECRET_KEY is not set. Checkout session creation will fail.")
        raise ValueError("Stripe API key is not configured.")

    try:
        # Create checkout session configuration
        session_params = {
            "payment_method_types": ["card"],
            "mode": "subscription",
            "line_items": [
                {
                    "price": price_id,
                    "quantity": seats,
                }
            ],
            "client_reference_id": tenant_id,
            "subscription_data": {
                "metadata": {
                    "tenant_id": tenant_id,
                    "org_name": org_name,
                }
            },
            "success_url": success_url,
            "cancel_url": cancel_url,
        }

        # In Stripe test mode, we might want to flag the session or use test clocks
        session = stripe.checkout.Session.create(**session_params)
        return session.url
    except Exception as e:
        logger.error(f"Error creating Stripe checkout session: {e}")
        raise e

def get_subscription_status(subscription_id: str) -> dict:
    """Retrieve subscription details from Stripe."""
    if not STRIPE_SECRET_KEY:
        raise ValueError("Stripe API key is not configured.")

    try:
        sub = stripe.Subscription.retrieve(subscription_id)
        return {
            "subscription_id": sub.id,
            "status": sub.status,
            "current_period_end": sub.current_period_end,
            "customer_id": sub.customer,
            "items": sub.get("items", {}).get("data", [])
        }
    except Exception as e:
        logger.error(f"Error retrieving Stripe subscription {subscription_id}: {e}")
        raise e

def handle_webhook_event(payload_bytes: bytes, sig_header: str) -> dict:
    """Construct and verify a Stripe Webhook Event."""
    if not STRIPE_WEBHOOK_SECRET:
        logger.warning("STRIPE_WEBHOOK_SECRET is not set. Signature verification is disabled or will fail.")
        # If no secret is configured, we can construct event without verification ONLY if test mode is explicitly configured.
        # But per requirements: "Webhook endpoint must verify Stripe-Signature header using STRIPE_WEBHOOK_SECRET."
        # We will attempt verification.
    
    try:
        event = stripe.Webhook.construct_event(
            payload_bytes, sig_header, STRIPE_WEBHOOK_SECRET
        )
        return event
    except stripe.error.SignatureVerificationError as e:
        logger.error(f"Invalid Stripe Webhook signature: {e}")
        raise ValueError("Invalid signature")
    except Exception as e:
        logger.error(f"Error handling Stripe webhook event: {e}")
        raise e
