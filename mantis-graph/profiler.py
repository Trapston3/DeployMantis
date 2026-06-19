"""
MantisStyle AST Style Analyzer
==============================
Parses Python files in the workspace using the AST (Abstract Syntax Tree) module to
derive project-wide naming conventions, error handling preferences, and docstring styles.
"""

import os
import ast
import re
import json
import logging
from typing import Dict, Any, List

logger = logging.getLogger("deploymantis.mantis_graph.profiler")

_CACHE_FILE = os.path.join(os.path.dirname(__file__), ".style_profile_cache.json")


class StyleVisitor(ast.NodeVisitor):
    """AST NodeVisitor to collect naming conventions, docstrings, and try-except metrics."""

    def __init__(self):
        self.class_names: List[str] = []
        self.function_names: List[str] = []
        self.constant_names: List[str] = []
        
        self.total_classes = 0
        self.classes_with_docstrings = 0
        self.total_functions = 0
        self.functions_with_docstrings = 0
        
        self.docstring_texts: List[str] = []
        
        self.total_try_blocks = 0
        self.bare_excepts = 0
        self.excepts_with_logging = 0
        
        self.current_scope = "module"

    def visit_ClassDef(self, node: ast.ClassDef):
        self.total_classes += 1
        self.class_names.append(node.name)
        
        doc = ast.get_docstring(node)
        if doc:
            self.classes_with_docstrings += 1
            self.docstring_texts.append(doc)
            
        old_scope = self.current_scope
        self.current_scope = "class"
        self.generic_visit(node)
        self.current_scope = old_scope

    def visit_FunctionDef(self, node: ast.FunctionDef):
        self.total_functions += 1
        self.function_names.append(node.name)
        
        doc = ast.get_docstring(node)
        if doc:
            self.functions_with_docstrings += 1
            self.docstring_texts.append(doc)
            
        old_scope = self.current_scope
        self.current_scope = "function"
        self.generic_visit(node)
        self.current_scope = old_scope

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
        self.total_functions += 1
        self.function_names.append(node.name)
        
        doc = ast.get_docstring(node)
        if doc:
            self.functions_with_docstrings += 1
            self.docstring_texts.append(doc)
            
        old_scope = self.current_scope
        self.current_scope = "function"
        self.generic_visit(node)
        self.current_scope = old_scope

    def visit_Assign(self, node: ast.Assign):
        # Identify constants defined at module or class scope (all uppercase)
        if self.current_scope in ("module", "class"):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    name = target.id
                    if name.isupper() and len(name) > 1:
                        self.constant_names.append(name)
        self.generic_visit(node)

    def visit_Try(self, node: ast.Try):
        self.total_try_blocks += 1
        for handler in node.handlers:
            if handler.type is None:
                self.bare_excepts += 1
            
            # Check if exceptions use logging
            has_logging = False
            for subnode in ast.walk(handler):
                if isinstance(subnode, ast.Call):
                    func_name = ""
                    if isinstance(subnode.func, ast.Name):
                        func_name = subnode.func.id
                    elif isinstance(subnode.func, ast.Attribute):
                        func_name = subnode.func.attr
                    
                    if func_name.lower() in ("error", "exception", "warning", "warn", "info", "debug", "critical"):
                        has_logging = True
                        break
            if has_logging:
                self.excepts_with_logging += 1
        self.generic_visit(node)


# ── Classification Helpers ────────────────────────────────────

def _classify_name_style(names: List[str], default: str) -> str:
    if not names:
        return default
        
    pascal_re = re.compile(r"^[A-Z][a-zA-Z0-9]*$")
    snake_re = re.compile(r"^[a-z0-9_]+$")
    camel_re = re.compile(r"^[a-z][a-zA-Z0-9]*$")
    upper_re = re.compile(r"^[A-Z_][A-Z0-9_]*$")
    
    pascal_count = 0
    snake_count = 0
    camel_count = 0
    upper_count = 0
    
    for name in names:
        if upper_re.match(name):
            upper_count += 1
        elif pascal_re.match(name):
            pascal_count += 1
        elif snake_re.match(name):
            snake_count += 1
        elif camel_re.match(name):
            camel_count += 1
            
    counts = {
        "PascalCase": pascal_count,
        "snake_case": snake_count,
        "camelCase": camel_count,
        "UPPER_SNAKE": upper_count
    }
    
    majority_style = max(counts, key=counts.get)
    # If majority has no matches, return default
    if counts[majority_style] == 0:
        return default
    return majority_style


def _classify_docstring_style(docs: List[str]) -> str:
    if not docs:
        return "google"
        
    google_count = 0
    sphinx_count = 0
    
    for doc in docs:
        if "Args:" in doc or "Returns:" in doc or "Raises:" in doc:
            google_count += 1
        elif ":param" in doc or ":return" in doc or ":raises" in doc:
            sphinx_count += 1
            
    if google_count > sphinx_count:
        return "google"
    elif sphinx_count > google_count:
        return "sphinx"
    return "google"


# ── Core Analysis Interface ───────────────────────────────────

def analyze_style(workspace_root: str, force: bool = False) -> Dict[str, Any]:
    """
    Analyzes Python files in the workspace using the AST module to build a style profile.
    Caches the profile to disk to avoid walking the entire tree on every request.
    
    Args:
        workspace_root: Absolute path to the repository root directory.
        force: If True, bypasses cache and re-analyzes all files.
    """
    # 1. Check cache first
    if not force and os.path.exists(_CACHE_FILE):
        try:
            with open(_CACHE_FILE, "r", encoding="utf-8") as f:
                cached = json.load(f)
                logger.info("MantisStyle: Loaded cached style profile.")
                return cached
        except Exception as e:
            logger.warning("MantisStyle: Failed to read style cache. Re-profiling. Error: %s", e)

    # 2. Walk workspace and parse ASTs
    visitor = StyleVisitor()
    
    # Ignore patterns (standard directories to skip)
    ignore_dirs = {
        ".git", ".pytest_cache", "venv", "env", "node_modules", "dist", "build", "tmp_clones"
    }
    
    for root, dirs, files in os.walk(workspace_root):
        # Skip ignored directories in place
        dirs[:] = [d for d in dirs if d not in ignore_dirs and not d.startswith(".")]
        
        for file in files:
            if file.endswith(".py"):
                file_path = os.path.join(root, file)
                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        source = f.read()
                    tree = ast.parse(source, filename=file_path)
                    visitor.visit(tree)
                except Exception:
                    # Skip files with syntax errors or encoding issues
                    continue

    # 3. Classify style attributes
    class_style = _classify_name_style(visitor.class_names, "PascalCase")
    function_style = _classify_name_style(visitor.function_names, "snake_case")
    # For constants, default to UPPER_SNAKE
    constant_style = _classify_name_style(visitor.constant_names, "UPPER_SNAKE")
    
    # docstrings
    doc_style = _classify_docstring_style(visitor.docstring_texts)
    total_items = visitor.total_functions + visitor.total_classes
    doc_coverage = 0.0
    if total_items > 0:
        doc_coverage = round((visitor.functions_with_docstrings + visitor.classes_with_docstrings) / total_items, 2)
        
    # error handling
    prefer_explicit = True
    if visitor.total_try_blocks > 0:
        # If bare excepts are more than 20% of total handlers, prefer_explicit = False
        if visitor.bare_excepts / visitor.total_try_blocks > 0.20:
            prefer_explicit = False

    # 4. Construct compact JSON profile
    profile = {
        "naming": {
            "functions": function_style,
            "classes": class_style,
            "constants": constant_style
        },
        "error_handling": {
            "prefer_explicit": prefer_explicit
        },
        "docstrings": {
            "style": doc_style,
            "coverage": doc_coverage
        }
    }

    # 5. Write to cache
    try:
        with open(_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(profile, f, indent=2)
        logger.info("MantisStyle: AST Style profiling complete. Cached to %s", _CACHE_FILE)
    except Exception as e:
        logger.error("MantisStyle: Failed to save style cache: %s", e)

    return profile
