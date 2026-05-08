import os
import logging
import httpx

logger = logging.getLogger("deploymantis.llm_gateway")

INFERENCE_PROVIDER = os.getenv("INFERENCE_PROVIDER", "ollama")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434/api/generate")

# BYOM: CUSTOM_MODEL_NAME takes precedence over OLLAMA_MODEL
_DEFAULT_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
CUSTOM_MODEL_NAME = os.getenv("CUSTOM_MODEL_NAME", "")
OLLAMA_MODEL = CUSTOM_MODEL_NAME if CUSTOM_MODEL_NAME else _DEFAULT_MODEL

logger.info("LLM Gateway: provider=%s  model=%s", INFERENCE_PROVIDER, OLLAMA_MODEL)
HF_URL = os.getenv("HF_URL", "https://api-inference.huggingface.co/models/meta-llama/Llama-3-8b-chat-hf")
HF_TOKEN = os.getenv("HF_TOKEN", "")

# ── Autonomous Recovery ───────────────────────────────────────
# When enabled, if the primary provider fails (timeout, 5xx),
# the gateway automatically reroutes to the local Ollama model
# and tags the response with X-DeployMantis-Recovered: true.
AUTONOMOUS_RECOVERY = os.getenv("AUTONOMOUS_RECOVERY", "true").lower() == "true"


class LLMGateway:
    """Centralized inference gateway with autonomous fallback recovery."""

    def __init__(self):
        self._recovered = False

    @property
    def was_recovered(self) -> bool:
        """True if the last call used the autonomous recovery path."""
        return self._recovered

    async def generate(self, prompt: str, system_prompt: str = "") -> str:
        self._recovered = False

        if INFERENCE_PROVIDER == "ollama":
            return await self._generate_ollama(prompt, system_prompt)
        elif INFERENCE_PROVIDER == "huggingface":
            return await self._generate_huggingface_with_recovery(prompt, system_prompt)
        else:
            raise ValueError(f"Unknown inference provider: {INFERENCE_PROVIDER}")

    # ── Ollama (Local) ────────────────────────────────────────

    async def _generate_ollama(self, prompt: str, system_prompt: str) -> str:
        full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
        payload = {
            "model": OLLAMA_MODEL,
            "prompt": full_prompt,
            "stream": False
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(OLLAMA_URL, json=payload)
            response.raise_for_status()
            data = response.json()
            return data.get("response", "")

    # ── HuggingFace (Cloud) with Recovery ─────────────────────

    async def _generate_huggingface_with_recovery(self, prompt: str, system_prompt: str) -> str:
        try:
            return await self._generate_huggingface(prompt, system_prompt)
        except (httpx.TimeoutException, httpx.HTTPStatusError) as e:
            # Check if it's a 5xx or timeout
            is_server_error = (
                isinstance(e, httpx.HTTPStatusError) and e.response.status_code >= 500
            )
            is_timeout = isinstance(e, httpx.TimeoutException)

            if (is_server_error or is_timeout) and AUTONOMOUS_RECOVERY:
                error_type = "Timeout" if is_timeout else f"HTTP {e.response.status_code}"
                logger.warning(
                    "External provider down (%s). "
                    "Initiating FallbackMesh recovery via Ollama.",
                    error_type,
                )
                self._recovered = True
                return await self._generate_ollama(prompt, system_prompt)
            raise

    async def _generate_huggingface(self, prompt: str, system_prompt: str) -> str:
        headers = {"Authorization": f"Bearer {HF_TOKEN}"} if HF_TOKEN else {}
        full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
        payload = {"inputs": full_prompt, "parameters": {"max_new_tokens": 512, "temperature": 0.1}}

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(HF_URL, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            if isinstance(data, list) and len(data) > 0 and "generated_text" in data[0]:
                return data[0]["generated_text"].replace(full_prompt, "").strip()
            return str(data)


gateway = LLMGateway()
