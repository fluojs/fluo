"""Execute the real host release/close branch without Frida or native injection."""
import json
import sys
import textwrap
import time
from pathlib import Path


class Session:
    def __init__(self):
        self.is_detached = False
        self.operations = []

    def disable_child_gating(self):
        self.operations.append("disable")

    def detach(self):
        self.operations.append("detach")
        self.is_detached = True


source = (Path(__file__).parents[2] / "src/native-lifetime-host.py").read_text()
branch = source.split('case "release" | "close":\n', 1)[1].split('case "begin-close":', 1)[0]
program = compile("while True:\n" + textwrap.indent(textwrap.dedent(branch), "    ")
                  + "\n    break\n", "<host release/close>", "exec")
session = Session()
errors = ["owned process abnormal exit: 124/7"] if sys.argv[1] == "error" else []
messages = []
state = {
    "request": {"command": "release"}, "response": {}, "closing": False,
    "released": False, "drained": True, "scripts": {}, "stopped_epochs": set(),
    "sessions": {124: session}, "errors": errors, "shutdown_script": True,
    "exit_watchers": {}, "detach_events": {}, "time": time,
    "emit": messages.append, "error": errors.append,
}
exec(program, state)
if sys.argv[1] == "close":
    state["request"] = {"command": "close"}
    state["response"] = {}
    exec(program, state)
print(json.dumps({
    "operations": session.operations,
    "response": state["response"],
    "errors": errors,
}))
