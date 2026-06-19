# core-api/services/prompt_optimizer.py
import logging
import time

logger = logging.getLogger("deploymantis.prompt_optimizer")

class PromptOptimizer:
    """Prompt optimization service with instruction injection and whitespace normalization."""

    @staticmethod
    def get_style_prompt() -> str | None:
        """Retrieve the cached style profile and format it into a prompt constraint."""
        try:
            from db.mantis_style_store import get_profile
            import json
            profile_json = get_profile()
            if not profile_json:
                return None
            profile = json.loads(profile_json)
            
            # Extract fields safely
            naming = profile.get("naming", {})
            err_handling = profile.get("error_handling", {})
            docstrings = profile.get("docstrings", {})
            
            fn_style = naming.get("functions", "snake_case")
            cls_style = naming.get("classes", "PascalCase")
            const_style = naming.get("constants", "UPPER_SNAKE")
            
            prefer_explicit = err_handling.get("prefer_explicit", True)
            err_text = "prefer explicit try/except with logging" if prefer_explicit else "handle exceptions with standard logging"
            
            doc_style = docstrings.get("style", "google")
            doc_cov = docstrings.get("coverage", 0.0)
            doc_text = f"use {doc_style}-style docstrings when adding docs (current coverage: {int(doc_cov * 100)}%)"
            
            prompt_text = (
                f"Follow this style profile: functions use {fn_style}, classes use {cls_style}, constants use {const_style}; "
                f"{err_text}; {doc_text}."
            )
            return prompt_text
        except Exception as e:
            # Degrade gracefully instead of failing the request
            logger.warning("Failed to load or parse style profile for prompt optimization: %s", e)
            return None

    @staticmethod
    def optimize(payload: dict, headers: dict = None) -> dict:
        start_time = time.time()
        if not isinstance(payload, dict) or "messages" not in payload:
            return payload

        messages = payload["messages"]
        if not isinstance(messages, list):
            return payload

        # MantisStyle Injection: Only inject if at least one message is present
        if len(messages) >= 1:
            style_prompt = PromptOptimizer.get_style_prompt()
            if style_prompt:
                messages.insert(0, {
                    "role": "system",
                    "content": style_prompt
                })

        # Check for Caveman Optimization header (case-insensitive keys)
        is_caveman = False
        if headers:
            for k, v in headers.items():
                if k.lower() == "x-mantis-optimization" and str(v).lower() == "caveman":
                    is_caveman = True
                    break

        # Rule 1: Whitespace Normalization
        for msg in messages:
            if not isinstance(msg, dict):
                continue
            if msg.get("role") == "user":
                content = msg.get("content")
                if isinstance(content, str):
                    msg["content"] = content.strip()
                elif isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict) and item.get("type") == "text":
                            text = item.get("text")
                            if isinstance(text, str):
                                item["text"] = text.strip()

        # Rule 2: Instruction Injection
        for msg in reversed(messages):
            if not isinstance(msg, dict):
                continue
            if msg.get("role") == "user":
                content = msg.get("content")
                injection = "\n\n(DeployMantis Directive: Think step-by-step and verify your logic before responding)"
                if isinstance(content, str):
                    msg["content"] = content + injection
                elif isinstance(content, list):
                    text_item_found = False
                    for item in reversed(content):
                        if isinstance(item, dict) and item.get("type") == "text":
                            text = item.get("text") or ""
                            item["text"] = text + injection
                            text_item_found = True
                            break
                    if not text_item_found:
                        content.append({
                            "type": "text",
                            "text": "(DeployMantis Directive: Think step-by-step and verify your logic before responding)"
                        })
                break

        # Rule 3: Caveman Mode injection
        if is_caveman:
            caveman_msg = {
                "role": "system",
                "content": "System Override: Enforce zero-fluff conciseness. Strip all conversational pleasantries, introductory clauses, summaries, and structural filler. Respond using raw command strings, concise data primitives, or compressed code fragments only."
            }
            messages.insert(0, caveman_msg)

        duration_ms = (time.time() - start_time) * 1000.0
        logger.debug(f"Prompt optimization finished in {duration_ms:.2f}ms")
        return payload
