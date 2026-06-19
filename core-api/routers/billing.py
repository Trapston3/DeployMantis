import os
from fastapi import APIRouter, Request, HTTPException, Header, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import stripe
import logging
from datetime import datetime

from billing import stripe_client, billing_store

logger = logging.getLogger("deploymantis.billing.router")
router = APIRouter()

# Get redirect URLs and price IDs
BILLING_SUCCESS_URL = os.getenv("BILLING_SUCCESS_URL", "http://localhost:3001/billing?success=true")
BILLING_CANCEL_URL = os.getenv("BILLING_CANCEL_URL", "http://localhost:3001/billing?cancel=true")
STRIPE_TEAM_PRICE_ID = os.getenv("STRIPE_TEAM_PRICE_ID", "")
STRIPE_DEV_PRICE_ID = os.getenv("STRIPE_DEV_PRICE_ID", "")

class CheckoutRequest(BaseModel):
    plan: str = "team"  # "developer" or "team"
    seats: int = 1

@router.post("/checkout")
async def checkout(request: Request, body: CheckoutRequest):
    """Create a checkout session for the authenticated tenant."""
    # Ensure tenant_id is available in request state (set by middleware)
    tenant_id = getattr(request.state, "tenant_id", None)
    org_name = getattr(request.state, "org_name", "Development Org")
    
    if not tenant_id:
        raise HTTPException(status_code=401, detail="Authentication required")
        
    price_id = ""
    if body.plan == "team":
        price_id = STRIPE_TEAM_PRICE_ID
    elif body.plan == "developer":
        price_id = STRIPE_DEV_PRICE_ID
    else:
        raise HTTPException(status_code=400, detail=f"Invalid plan: {body.plan}")

    if not price_id:
        raise HTTPException(
            status_code=400, 
            detail=f"Stripe price ID for plan '{body.plan}' is not configured on the server."
        )

    try:
        checkout_url = stripe_client.create_checkout_session(
            tenant_id=tenant_id,
            org_name=org_name,
            price_id=price_id,
            seats=body.seats,
            success_url=BILLING_SUCCESS_URL,
            cancel_url=BILLING_CANCEL_URL
        )
        return {"checkout_url": checkout_url}
    except Exception as e:
        logger.error(f"Checkout error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status")
async def status(request: Request):
    """Get the current billing status for the authenticated tenant."""
    tenant_id = getattr(request.state, "tenant_id", None)
    if not tenant_id:
        raise HTTPException(status_code=401, detail="Authentication required")
        
    billing = await billing_store.get_billing(tenant_id)
    if not billing:
        # Default fallback
        return {
            "tenant_id": tenant_id,
            "stripe_customer_id": None,
            "stripe_subscription_id": None,
            "plan": "hobbyist",
            "status": "active",
            "seats_purchased": 1,
            "current_period_end": None
        }
    return billing

@router.post("/webhook")
async def webhook(request: Request, stripe_signature: Optional[str] = Header(None)):
    """Stripe webhook endpoint. Processes subscription events."""
    if not stripe_signature:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")

    payload = await request.body()
    try:
        event = stripe_client.handle_webhook_event(payload, stripe_signature)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    event_type = event["type"]
    logger.info(f"Received Stripe webhook event: {event_type}")

    try:
        if event_type == "checkout.session.completed":
            session = event["data"]["object"]
            tenant_id = session.get("client_reference_id")
            customer_id = session.get("customer")
            subscription_id = session.get("subscription")
            
            if not tenant_id or not subscription_id:
                logger.warning("checkout.session.completed missing client_reference_id or subscription")
                return JSONResponse(content={"status": "ignored", "reason": "missing client_reference_id or subscription"}, status_code=200)

            # Retrieve subscription details to get seats and price ID
            sub_details = stripe_client.get_subscription_status(subscription_id)
            
            # Map price ID to plan name
            price_id = sub_details["items"][0]["price"]["id"] if sub_details["items"] else ""
            plan = "hobbyist"
            if price_id == STRIPE_TEAM_PRICE_ID:
                plan = "team"
            elif price_id == STRIPE_DEV_PRICE_ID:
                plan = "developer"
                
            seats = sub_details["items"][0]["quantity"] if sub_details["items"] else 1
            status = sub_details["status"]
            period_end = datetime.fromtimestamp(sub_details["current_period_end"]).isoformat()
            
            await billing_store.upsert_billing(
                tenant_id=tenant_id,
                stripe_customer_id=customer_id,
                stripe_subscription_id=subscription_id,
                plan=plan,
                status=status,
                seats_purchased=seats,
                current_period_end=period_end
            )
            
        elif event_type in ("customer.subscription.updated", "customer.subscription.deleted"):
            sub = event["data"]["object"]
            subscription_id = sub["id"]
            customer_id = sub["customer"]
            status = sub["status"]
            period_end = datetime.fromtimestamp(sub["current_period_end"]).isoformat()
            
            # Resolve tenant_id from metadata or lookup DB
            tenant_id = sub.get("metadata", {}).get("tenant_id")
            if not tenant_id:
                record = await billing_store.get_billing_by_subscription(subscription_id, customer_id)
                if record:
                    tenant_id = record["tenant_id"]
            
            if not tenant_id:
                logger.warning(f"Could not resolve tenant_id for subscription event {subscription_id}")
                return JSONResponse(content={"status": "ignored", "reason": "could not resolve tenant"}, status_code=200)

            if event_type == "customer.subscription.deleted":
                # Fallback to hobbyist plan
                await billing_store.upsert_billing(
                    tenant_id=tenant_id,
                    stripe_customer_id=customer_id,
                    stripe_subscription_id=subscription_id,
                    plan="hobbyist",
                    status="canceled",
                    seats_purchased=1,
                    current_period_end=period_end
                )
            else:
                # Updated event
                price_id = sub["items"]["data"][0]["price"]["id"] if sub.get("items", {}).get("data") else ""
                plan = "hobbyist"
                if price_id == STRIPE_TEAM_PRICE_ID:
                    plan = "team"
                elif price_id == STRIPE_DEV_PRICE_ID:
                    plan = "developer"
                    
                seats = sub["items"]["data"][0]["quantity"] if sub.get("items", {}).get("data") else 1
                
                # If status is past_due or unpaid, we still record it. Middleware checks plan/status/seats.
                await billing_store.upsert_billing(
                    tenant_id=tenant_id,
                    stripe_customer_id=customer_id,
                    stripe_subscription_id=subscription_id,
                    plan=plan,
                    status=status,
                    seats_purchased=seats,
                    current_period_end=period_end
                )
        
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Error in webhook handler: {e}")
        return JSONResponse(content={"detail": str(e)}, status_code=500)
