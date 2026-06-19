import os
import tempfile
from graph_engine import RepositoryIndexer, query_index

def test_ast_indexer():
    with tempfile.TemporaryDirectory() as tmpdir:
        test_file_content = """
class TargetService:
    \"\"\"This is a target test service.\"\"\"
    def __init__(self):
        pass
        
    def execute_logic(self, param):
        self.log_event(param)
        
    async def run_async(self):
        await self.execute_logic("test")

def helper_function():
    \"\"\"A global helper function.\"\"\"
    service = TargetService()
    service.execute_logic(123)
"""
        
        file_path = os.path.join(tmpdir, "test_service.py")
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(test_file_content)

        indexer = RepositoryIndexer(tmpdir)
        index = indexer.index_repo()

        assert len(index["classes"]) == 1
        assert index["classes"][0]["name"] == "TargetService"
        assert "target test service" in index["classes"][0]["docstring"]

        assert len(index["functions"]) == 4
        method_names = [f["name"] for f in index["functions"] if f["class"] == "TargetService"]
        assert "__init__" in method_names
        assert "execute_logic" in method_names
        assert "run_async" in method_names

        helper_funcs = [f for f in index["functions"] if f["class"] is None]
        assert len(helper_funcs) == 1
        assert helper_funcs[0]["name"] == "helper_function"
        assert "global helper function" in helper_funcs[0]["docstring"]

        call_callees = [c["callee"] for c in index["calls"]]
        assert "log_event" in call_callees
        assert "execute_logic" in call_callees
        assert "TargetService" in call_callees

def test_query():
    index = {
        "classes": [
            {"name": "TargetService", "file": "service.py", "line": 2, "docstring": "This is a target test service."}
        ],
        "functions": [
            {"name": "execute_logic", "class": "TargetService", "file": "service.py", "line": 7, "docstring": ""},
            {"name": "helper_function", "class": None, "file": "service.py", "line": 13, "docstring": "A global helper function."}
        ],
        "calls": [
            {"caller": "TargetService", "callee": "log_event", "file": "service.py", "line": 8}
        ]
    }

    res = query_index(index, "Target")
    assert len(res["classes"]) == 1
    assert res["classes"][0]["name"] == "TargetService"

    res = query_index(index, "helper")
    assert len(res["functions"]) == 1
    assert res["functions"][0]["name"] == "helper_function"

    res = query_index(index, "execute")
    assert len(res["functions"]) == 1
    assert res["functions"][0]["name"] == "execute_logic"
