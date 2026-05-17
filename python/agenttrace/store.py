import os
import json
from typing import Any, Dict, List
from .types import GuardedResult

class Store:
    def __init__(self, storage_path: str):
        self.storage_path = storage_path
        self._ensure_dir()

    def _ensure_dir(self):
        directory = os.path.dirname(self.storage_path)
        if directory and not os.path.exists(directory):
            os.makedirs(directory, exist_ok=True)

    def save(self, result: GuardedResult) -> None:
        try:
            # We must serialize the Pydantic models correctly
            data = result.model_dump()
            with open(self.storage_path, "a") as f:
                f.write(json.dumps(data) + "\n")
        except Exception as e:
            # Don't fail the agent run just because logging failed
            pass

    def get_recent(self, limit: int = 50) -> List[Dict[str, Any]]:
        if not os.path.exists(self.storage_path):
            return []
        
        results = []
        try:
            with open(self.storage_path, "r") as f:
                lines = f.readlines()
                for line in reversed(lines):
                    if not line.strip():
                        continue
                    results.append(json.loads(line))
                    if len(results) >= limit:
                        break
        except Exception:
            pass
        return results
