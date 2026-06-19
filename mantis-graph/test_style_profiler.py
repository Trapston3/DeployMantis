# mantis-graph/test_style_profiler.py
import os
import sys
import tempfile
import json
import pytest

# Add mantis-graph to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from profiler import analyze_style

def test_analyze_style_synthetic_conventions():
    # Create a temporary directory representing a workspace
    with tempfile.TemporaryDirectory() as tmpdir:
        # Write a python file with predefined styles:
        # - PascalCase classes (MyClass, TestClass)
        # - snake_case functions (my_func, run_process)
        # - UPPER_SNAKE constants (API_LIMIT, MAX_RETRY)
        # - Google style docstrings (contains Args: / Returns:)
        # - Explicit try/except with logging
        code = """
import logging
logger = logging.getLogger("test")

API_LIMIT = 100
MAX_RETRY = 3

class MyClass:
    def __init__(self):
        self.value = 1

class TestClass:
    pass

def my_func(x: int) -> int:
    \"\"\"
    Increments the given value.
    
    Args:
        x: The value to increment.
        
    Returns:
        The incremented value.
    \"\"\"
    try:
        return x + 1
    except Exception as e:
        logger.exception("Increment failed")
        raise e

def run_process():
    pass
"""
        with open(os.path.join(tmpdir, "code_sample.py"), "w", encoding="utf-8") as f:
            f.write(code)

        # Walk and parse
        profile = analyze_style(tmpdir, force=True)

        # Asserts
        assert profile["naming"]["classes"] == "PascalCase"
        assert profile["naming"]["functions"] == "snake_case"
        assert profile["naming"]["constants"] == "UPPER_SNAKE"
        assert profile["docstrings"]["style"] == "google"
        assert profile["error_handling"]["prefer_explicit"] is True
