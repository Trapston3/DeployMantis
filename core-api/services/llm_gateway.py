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

        if os.getenv("MOCK_LLM", "false").lower() == "true":
            return self._generate_mock(prompt, system_prompt)

        if INFERENCE_PROVIDER == "ollama":
            return await self._generate_ollama(prompt, system_prompt)
        elif INFERENCE_PROVIDER == "huggingface":
            return await self._generate_huggingface_with_recovery(prompt, system_prompt)
        else:
            raise ValueError(f"Unknown inference provider: {INFERENCE_PROVIDER}")

    def _generate_mock(self, prompt: str, system_prompt: str) -> str:
        p_lower = prompt.lower()
        
        # 1. Secret Flow
        if any(w in p_lower for w in ("secret", "credential", "password", "key", "token", "aws")):
            return (
                "Here is the database and AWS configuration:\n\n"
                "```python\n"
                "AWS_SECRET_KEY = \"AKIAIOSFODNN7EXAMPLE\"\n"
                "DB_CONN = \"postgresql://admin:super_secret_password_123@localhost:5432/db\"\n"
                "```\n"
            )
            
        # 2. Style-aware Code Generation Flow
        # Check system prompt style constraints
        fn_style = "snake_case"
        if "functions use camelCase" in system_prompt:
            fn_style = "camelCase"
        elif "functions use PascalCase" in system_prompt:
            fn_style = "PascalCase"

        doc_style = "google"
        if "sphinx-style" in system_prompt:
            doc_style = "sphinx"
            
        if fn_style == "camelCase":
            fn_name = "calculateSum"
            p1, p2 = "firstVal", "secondVal"
        elif fn_style == "PascalCase":
            fn_name = "CalculateSum"
            p1, p2 = "FirstVal", "SecondVal"
        else:
            fn_name = "calculate_sum"
            p1, p2 = "first_val", "second_val"

        if doc_style == "sphinx":
            doc = (
                f"    \"\"\"Calculate sum.\n\n"
                f"    :param {p1}: First value.\n"
                f"    :param {p2}: Second value.\n"
                f"    :returns: The result.\n"
                f"    \"\"\""
            )
        else:
            doc = (
                f"    \"\"\"Calculate sum.\n\n"
                f"    Args:\n"
                f"        {p1}: First value.\n"
                f"        {p2}: Second value.\n\n"
                f"    Returns:\n"
                f"        The result.\n"
                f"    \"\"\""
            )

        code_block = (
            f"def {fn_name}({p1}, {p2}):\n"
            f"{doc}\n"
            f"    return {p1} + {p2}"
        )
        
        diff_block = (
            f"diff --git a/math_utils.py b/math_utils.py\n"
            f"--- a/math_utils.py\n"
            f"+++ b/math_utils.py\n"
            f"@@ -1,3 +1,6 @@\n"
            f"-def old_sum(x, y):\n"
            f"-    return x + y\n"
            f"+def {fn_name}({p1}, {p2}):\n"
            f"+{doc}\n"
            f"+    return {p1} + {p2}"
        )
        
        return (
            f"Here is the code matching the requested profile:\n\n"
            f"```python\n"
            f"{code_block}\n"
            f"```\n\n"
            f"And here is the patch/diff file:\n\n"
            f"```diff\n"
            f"{diff_block}\n"
            f"```\n"
        )

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
