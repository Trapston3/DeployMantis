"""
Aegis Reliability Suite — CLI Entrypoint
=========================================
Single-binary CLI that wraps Docker Compose lifecycle
and provides cluster health monitoring.

Commands:
  aegis start   — Bring up all services and open the dashboard
  aegis stop    — Tear down all services
  aegis status  — Probe the orchestrator and print a health table
"""

import os
import sys
import subprocess
import webbrowser
import time

import typer
import httpx
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.text import Text
from rich import box

app = typer.Typer(
    name="aegis",
    help="Aegis Reliability Suite — CLI Manager",
    add_completion=False,
    no_args_is_help=True,
)

console = Console()

# ── Resolve the project root (docker-compose.yml location) ────
# When compiled via PyInstaller the executable lives in /cli,
# so we look one directory up for the compose file.
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.abspath(os.path.join(_SCRIPT_DIR, ".."))

COMPOSE_FILE = os.path.join(_PROJECT_ROOT, "docker-compose.yml")
CORE_API_PORT = os.getenv("CORE_API_PORT", "4000")
DASHBOARD_PORT = os.getenv("DASHBOARD_PORT", "3001")
CORE_API_URL = os.getenv("CORE_API_URL", f"http://localhost:{CORE_API_PORT}")

STATUS_ICONS = {
    "online":   "[bold green]● ONLINE[/bold green]",
    "degraded": "[bold yellow]▲ DEGRADED[/bold yellow]",
    "offline":  "[bold red]✖ OFFLINE[/bold red]",
    "unknown":  "[dim]? UNKNOWN[/dim]",
}


def _compose_cmd(*args: str) -> list[str]:
    """Build a docker compose command list pointing at the project root."""
    return [
        "docker", "compose",
        "-f", COMPOSE_FILE,
        *args,
    ]


def _run_compose(*args: str, silent: bool = True) -> subprocess.CompletedProcess:
    """Execute a docker compose command, optionally suppressing output."""
    cmd = _compose_cmd(*args)
    kwargs: dict = {"cwd": _PROJECT_ROOT}
    if silent:
        kwargs["stdout"] = subprocess.DEVNULL
        kwargs["stderr"] = subprocess.DEVNULL
    return subprocess.run(cmd, **kwargs)


def _wait_for_api(timeout: int = 30) -> bool:
    """Poll the Core API /health endpoint until it responds or we time out."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            resp = httpx.get(f"{CORE_API_URL}/health", timeout=2.0)
            if resp.status_code == 200:
                return True
        except (httpx.ConnectError, httpx.TimeoutException):
            pass
        time.sleep(1)
    return False


# ── Commands ──────────────────────────────────────────────────

@app.command()
def start():
    """
    Launch the Aegis cluster in the background and open the dashboard.

    Runs `docker compose up -d --build`, waits for the Core API to
    become healthy, then opens http://localhost:3001 in the default
    browser.
    """
    console.print(
        Panel(
            "[bold cyan]Aegis Reliability Suite[/bold cyan]\n"
            "[dim]Bringing up the cluster…[/dim]",
            box=box.ROUNDED,
            border_style="cyan",
        )
    )

    with console.status("[bold cyan]Building & starting containers…[/bold cyan]", spinner="dots"):
        result = _run_compose("up", "-d", "--build")

    if result.returncode != 0:
        console.print("[bold red]✖ docker compose up failed.[/bold red]  Run manually for details:")
        console.print(f"  [dim]{' '.join(_compose_cmd('up', '-d', '--build'))}[/dim]")
        raise typer.Exit(code=1)

    console.print("[green]✔ Containers started.[/green]")

    with console.status("[bold cyan]Waiting for Core API…[/bold cyan]", spinner="dots"):
        healthy = _wait_for_api()

    if healthy:
        console.print(f"[green]✔ Core API healthy at {CORE_API_URL}[/green]")
    else:
        console.print(
            "[yellow]⚠ Core API did not respond within 30 s. "
            "Services may still be booting.[/yellow]"
        )

    dashboard_url = f"http://localhost:{DASHBOARD_PORT}"
    console.print(f"\n[bold]Opening dashboard → [link={dashboard_url}]{dashboard_url}[/link][/bold]\n")
    webbrowser.open(dashboard_url)


@app.command()
def stop():
    """
    Tear down the Aegis cluster.

    Runs `docker compose down` and removes stopped containers.
    """
    console.print(
        Panel(
            "[bold red]Aegis Reliability Suite[/bold red]\n"
            "[dim]Shutting down the cluster…[/dim]",
            box=box.ROUNDED,
            border_style="red",
        )
    )

    with console.status("[bold red]Stopping containers…[/bold red]", spinner="dots"):
        result = _run_compose("down")

    if result.returncode == 0:
        console.print("[green]✔ All services stopped.[/green]")
    else:
        console.print("[bold red]✖ docker compose down returned an error.[/bold red]")
        raise typer.Exit(code=1)


@app.command()
def status():
    """
    Print the health status of every service in the cluster.

    Probes the Core API orchestrator at
    GET /api/v1/orchestrator/status and renders a Rich table.
    """
    try:
        resp = httpx.get(f"{CORE_API_URL}/api/v1/orchestrator/status", timeout=5.0)
        resp.raise_for_status()
        data = resp.json()
    except httpx.ConnectError:
        console.print(
            "[bold red]✖ Cannot reach Core API.[/bold red]  "
            "Is the cluster running?  Try [bold]aegis start[/bold]."
        )
        raise typer.Exit(code=1)
    except httpx.TimeoutException:
        console.print("[bold red]✖ Core API timed out.[/bold red]")
        raise typer.Exit(code=1)
    except Exception as exc:
        console.print(f"[bold red]✖ Unexpected error:[/bold red] {exc}")
        raise typer.Exit(code=1)

    services = data.get("services", [])

    table = Table(
        title="Aegis Cluster Health",
        box=box.HEAVY_HEAD,
        title_style="bold cyan",
        header_style="bold white on #1a1a2e",
        border_style="dim cyan",
        show_lines=True,
        padding=(0, 1),
    )
    table.add_column("Service", style="bold white", min_width=16)
    table.add_column("Status", justify="center", min_width=14)
    table.add_column("Container", style="dim", min_width=26)

    for svc in services:
        name = svc.get("name", "—")
        status_key = svc.get("status", "unknown")
        container = svc.get("container", "—")
        status_cell = STATUS_ICONS.get(status_key, STATUS_ICONS["unknown"])
        table.add_row(name, status_cell, container)

    console.print()
    console.print(table)
    console.print()

    online = sum(1 for s in services if s.get("status") == "online")
    total = len(services)
    if online == total:
        console.print(f"[bold green]All {total} services healthy ✔[/bold green]")
    else:
        console.print(
            f"[bold yellow]{online}/{total} services online. "
            f"Run [bold]aegis start[/bold] to recover.[/bold yellow]"
        )


@app.command()
def logs(
    service: str = typer.Argument(None, help="Service name (omit for all)"),
    follow: bool = typer.Option(False, "--follow", "-f", help="Stream logs"),
    tail: int = typer.Option(100, "--tail", "-n", help="Number of lines"),
):
    """
    Stream or display container logs.
    """
    args = ["logs", f"--tail={tail}"]
    if follow:
        args.append("--follow")
    if service:
        args.append(service)

    cmd = _compose_cmd(*args)
    try:
        subprocess.run(cmd, cwd=_PROJECT_ROOT)
    except KeyboardInterrupt:
        pass


# ── Entrypoint ────────────────────────────────────────────────

if __name__ == "__main__":
    app()
