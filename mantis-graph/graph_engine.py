import os
import ast
import fnmatch

class RepositoryIndexer:
    def __init__(self, root_dir: str):
        self.root_dir = os.path.abspath(root_dir)
        self.index = {
            "classes": [],
            "functions": [],
            "calls": [],
        }

    def should_ignore(self, path: str) -> bool:
        ignore_patterns = [
            '**/.*', '**/__pycache__', '**/venv', '**/env', '**/node_modules',
            '**/tmp_clones', '**/dist', '**/build', '**/.pytest_cache', '**/tests'
        ]
        rel_path = os.path.relpath(path, self.root_dir)
        for pat in ignore_patterns:
            if fnmatch.fnmatch(rel_path, pat) or fnmatch.fnmatch(os.path.basename(path), pat):
                return True
        return False

    def index_repo(self):
        for root, dirs, files in os.walk(self.root_dir):
            # Prune ignored dirs in place to avoid walking them
            dirs[:] = [d for d in dirs if not self.should_ignore(os.path.join(root, d))]
            for file in files:
                if file.endswith('.py'):
                    file_path = os.path.join(root, file)
                    if not self.should_ignore(file_path):
                        try:
                            self.index_file(file_path)
                        except Exception:
                            pass
        return self.index

    def index_file(self, file_path: str):
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            source = f.read()
        
        try:
            tree = ast.parse(source, filename=file_path)
        except SyntaxError:
            return

        rel_file_path = os.path.relpath(file_path, self.root_dir).replace("\\", "/")

        class FileVisitor(ast.NodeVisitor):
            def __init__(self, rel_path: str):
                self.rel_path = rel_path
                self.current_class = None
                self.classes = []
                self.functions = []
                self.calls = []

            def visit_ClassDef(self, node: ast.ClassDef):
                docstring = ast.get_docstring(node) or ""
                self.classes.append({
                    "name": node.name,
                    "file": self.rel_path,
                    "line": node.lineno,
                    "docstring": docstring
                })
                old_class = self.current_class
                self.current_class = node.name
                self.generic_visit(node)
                self.current_class = old_class

            def visit_FunctionDef(self, node: ast.FunctionDef):
                docstring = ast.get_docstring(node) or ""
                self.functions.append({
                    "name": node.name,
                    "class": self.current_class,
                    "file": self.rel_path,
                    "line": node.lineno,
                    "docstring": docstring
                })
                self.generic_visit(node)

            def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
                docstring = ast.get_docstring(node) or ""
                self.functions.append({
                    "name": node.name,
                    "class": self.current_class,
                    "file": self.rel_path,
                    "line": node.lineno,
                    "docstring": docstring
                })
                self.generic_visit(node)

            def visit_Call(self, node: ast.Call):
                caller = self.current_class
                func_name = None
                if isinstance(node.func, ast.Name):
                    func_name = node.func.id
                elif isinstance(node.func, ast.Attribute):
                    func_name = node.func.attr
                
                if func_name:
                    self.calls.append({
                        "caller": caller,
                        "callee": func_name,
                        "file": self.rel_path,
                        "line": node.lineno
                    })
                self.generic_visit(node)

        visitor = FileVisitor(rel_file_path)
        visitor.visit(tree)
        self.index["classes"].extend(visitor.classes)
        self.index["functions"].extend(visitor.functions)
        self.index["calls"].extend(visitor.calls)

def query_index(index: dict, q: str):
    q_lower = q.lower()
    results = {
        "classes": [],
        "functions": [],
        "relations": []
    }
    
    for cls in index.get("classes", []):
        if q_lower in cls["name"].lower() or q_lower in cls["docstring"].lower():
            results["classes"].append(cls)

    for fn in index.get("functions", []):
        if q_lower in fn["name"].lower() or q_lower in fn["docstring"].lower():
            results["functions"].append(fn)

    for call in index.get("calls", []):
        caller_str = call["caller"] or ""
        if q_lower in caller_str.lower() or q_lower in call["callee"].lower():
            results["relations"].append(call)

    return results
