import sqlite3
import os
import json

class PromptKVCache:
    def __init__(self, db_path: str = "prompt_cache.db"):
        self.db_path = os.path.abspath(db_path)
        self.memory_cache = {}
        self._init_db()
        self._load_into_memory()

    def _init_db(self):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS prompt_cache (
                prompt_key TEXT PRIMARY KEY,
                response_text TEXT
            )
        """)
        conn.commit()
        conn.close()

    def _load_into_memory(self):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT prompt_key, response_text FROM prompt_cache")
        rows = cursor.fetchall()
        for k, v in rows:
            self.memory_cache[k] = v
        conn.close()

    def get(self, prompt_key: str) -> str:
        return self.memory_cache.get(prompt_key)

    def set(self, prompt_key: str, response_text: str):
        self.memory_cache[prompt_key] = response_text
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO prompt_cache (prompt_key, response_text)
            VALUES (?, ?)
        """, (prompt_key, response_text))
        conn.commit()
        conn.close()

def make_prompt_key(messages: list, tools: list = None) -> str:
    normalized = {
        "messages": [
            {"role": m.get("role"), "content": m.get("content")}
            for m in messages if isinstance(m, dict)
        ]
    }
    if tools:
        normalized["tools"] = sorted(
            [t.get("function", {}).get("name") for t in tools if isinstance(t, dict) and "function" in t]
        )
    return json.dumps(normalized, sort_keys=True)
