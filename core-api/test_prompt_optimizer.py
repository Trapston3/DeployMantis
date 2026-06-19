# core-api/test_prompt_optimizer.py
import pytest
import sys
import os

# Add core-api to sys.path so we can import services
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.prompt_optimizer import PromptOptimizer

def test_whitespace_normalization():
    payload = {
        "messages": [
            {"role": "system", "content": "  system content stays as is  "},
            {"role": "user", "content": " \n\n user content needs stripping \n\n "},
            {"role": "assistant", "content": " assistant stays same "},
            {"role": "user", "content": "\t another user message  "}
        ]
    }
    optimized = PromptOptimizer.optimize(payload)
    
    # System and assistant remain unchanged
    assert optimized["messages"][0]["content"] == "  system content stays as is  "
    assert optimized["messages"][2]["content"] == " assistant stays same "
    
    # First user message stripped, last user message stripped and directive appended
    assert optimized["messages"][1]["content"] == "user content needs stripping"
    expected_directive = "\n\n(DeployMantis Directive: Think step-by-step and verify your logic before responding)"
    assert optimized["messages"][3]["content"] == "another user message" + expected_directive

def test_multimodal_payload_optimization():
    payload = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": "http://example.com/img.jpg"}},
                    {"type": "text", "text": "  Please analyze this image  \n"}
                ]
            }
        ]
    }
    optimized = PromptOptimizer.optimize(payload)
    user_content = optimized["messages"][0]["content"]
    
    # Image URL should remain unchanged
    assert user_content[0]["image_url"]["url"] == "http://example.com/img.jpg"
    
    # Text block is stripped and has the directive appended
    expected_directive = "\n\n(DeployMantis Directive: Think step-by-step and verify your logic before responding)"
    assert user_content[1]["text"] == "Please analyze this image" + expected_directive

def test_performance_under_5ms():
    import time
    
    # Construct a large conversation history
    payload = {
        "messages": [{"role": "user" if i % 2 == 0 else "assistant", "content": f"  Message content {i}  "} for i in range(100)]
    }
    
    start = time.time()
    optimized = PromptOptimizer.optimize(payload)
    duration_ms = (time.time() - start) * 1000.0
    
    print(f"Large payload optimization duration: {duration_ms:.4f}ms")
    assert duration_ms < 5.0

def test_caveman_optimization():
    payload = {
        "messages": [
            {"role": "user", "content": "  hello  "}
        ]
    }
    headers = {"X-Mantis-Optimization": "caveman"}
    optimized = PromptOptimizer.optimize(payload, headers)
    
    # System message should be inserted at index 0
    assert len(optimized["messages"]) == 2
    assert optimized["messages"][0]["role"] == "system"
    assert "System Override: Enforce zero-fluff conciseness" in optimized["messages"][0]["content"]
    
    # User message directive is still appended
    expected_directive = "\n\n(DeployMantis Directive: Think step-by-step and verify your logic before responding)"
    assert optimized["messages"][1]["content"] == "hello" + expected_directive

