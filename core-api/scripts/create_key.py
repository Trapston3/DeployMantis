import asyncio
import os
import sys
import argparse

# Add parent directory of scripts to sys.path so auth and billing modules can be imported
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from auth import key_store
from billing import billing_store


async def _run(org_name: str, tenant_id: str, scopes: list[str]) -> None:
    """Async core: initialise stores and generate the API key."""
    # Initialise DBs just in case they aren't yet (no-op in PG mode)
    key_store.init_db()
    billing_store.init_db()

    # Generate API key
    raw_key = await key_store.create_key(tenant_id=tenant_id, org_name=org_name, scopes=scopes)

    print("\n========================================================")
    print("  DeployMantis — API Key Generated Successfully")
    print("========================================================")
    print(f"  Organisation: {org_name}")
    print(f"  Tenant ID:    {tenant_id}")
    print(f"  Scopes:       {', '.join(scopes)}")
    print(f"  API Key:      {raw_key}")
    print("========================================================")
    print("  SAVE THIS KEY! It will not be shown again.\n")


def main():
    parser = argparse.ArgumentParser(description="Create a DeployMantis API Key for an Organisation.")
    parser.add_argument("--org", required=True, help="Name of the organization (e.g. dev, acme)")
    parser.add_argument("--tenant", help="Tenant ID (defaults to lowercase organization name)")
    parser.add_argument("--scopes", help="Comma-separated scopes (defaults to all: snap,launch,verify,heal)")

    args = parser.parse_args()

    org_name = args.org
    tenant_id = args.tenant or org_name.lower().replace(" ", "_")

    if args.scopes:
        scopes = [s.strip() for s in args.scopes.split(",") if s.strip()]
    else:
        scopes = ["snap", "launch", "verify", "heal"]

    asyncio.run(_run(org_name, tenant_id, scopes))


if __name__ == "__main__":
    main()
