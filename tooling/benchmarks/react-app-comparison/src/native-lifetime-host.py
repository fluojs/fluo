"""Owned-process, authenticated Linux/AArch64 headless lifetime observer v1."""
import hashlib
import json
import os
import platform
import select
import struct
import sys
import threading
import time
from pathlib import Path
from typing import Final, TypedDict

import frida

PYTHON_SHA: Final = "304aa87a76ebb13fd22d253ac157f14980ff2cdb23e6274f3b045571405e07dc"
FRIDA_FILES: Final = {
    "__init__.py": "9e0a5fe4cb0148194f23cf208d5a5479d76979032a1a401154b352250e699aae",
    "aio.py": "954124b4cb82abfb52b8d3b61a094ba39f75c52617d9f57f01c95faee4343f4e",
    "_frida.abi3.so": "24bda14795eb6f384511cd1a5ac1663d6030fb0c46ecc708b11358abbb652e40",
}


class Hook(TypedDict):
    event: str
    offset: int
    symbol: str


class BrowserIdentity(TypedDict):
    binarySha256: str
    buildId: str


class HookSchema(TypedDict):
    identity: BrowserIdentity
    hooks: list[Hook]
    shutdownHooks: list[Hook]
    runId: str
    agentSha256: str
    hostSha256: str


def sha(path: str | Path) -> str:
    with open(path, "rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def birth(pid: int) -> str:
    # /proc starttime survives PID reuse; comm may contain whitespace/parentheses.
    fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    return f"{pid}:{fields[19]}"


def descendants(pid: int) -> list[int]:
    # Chromium also forks from non-main threads. Linux children is per-thread,
    # so the main-thread list alone cannot establish browser-tree ownership.
    children = set()
    for task in Path(f"/proc/{pid}/task").iterdir():
        try:
            children.update(int(child) for child in (task / "children").read_text().split())
        except FileNotFoundError:
            # A thread that exited during this kernel inventory has no children
            # in that entry; a renderer absent from the complete set fails below.
            continue
    found = []
    for number in sorted(children):
        found.append(number)
        found.extend(descendants(number))
    return found


def authenticate(pid: int, schema: HookSchema) -> tuple[str, str]:
    executable = Path(f"/proc/{pid}/exe").resolve(strict=True)
    raw = executable.read_bytes()
    identity = schema["identity"]
    if executable.name != "headless_shell" or hashlib.sha256(raw).hexdigest() != identity["binarySha256"]:
        raise RuntimeError(f"executed binary hash/name mismatch: {pid}")
    if raw[:7] != b"\x7fELF\x02\x01\x01" or struct.unpack_from("<H", raw, 18)[0] != 183:
        raise RuntimeError("ELF64-LE-AArch64 ABI mismatch")
    offset = struct.unpack_from("<Q", raw, 40)[0]
    size, count = struct.unpack_from("<HH", raw, 58)
    sections = [struct.unpack_from("<IIQQQQIIQQ", raw, offset + index * size) for index in range(count)]
    symbols = {}
    authenticated_hooks = schema["hooks"] + schema["shutdownHooks"]
    build_id = None
    for section in sections:
        if section[1] == 7:
            cursor, end = section[4], section[4] + section[5]
            while cursor < end:
                namesz, descsz, kind = struct.unpack_from("<III", raw, cursor)
                cursor += 12
                name = raw[cursor:cursor + namesz].rstrip(b"\0")
                cursor += (namesz + 3) & ~3
                value = raw[cursor:cursor + descsz]
                cursor += (descsz + 3) & ~3
                if name == b"GNU" and kind == 3:
                    build_id = value.hex()
        if section[1] != 2:
            continue
        strings = sections[section[6]]
        for cursor in range(section[4], section[4] + section[5], section[9]):
            name, info, _, _, address, _ = struct.unpack_from("<IBBHQQ", raw, cursor)
            start = strings[4] + name
            symbol = raw[start:raw.index(b"\0", start)].decode()
            if symbol in [hook["symbol"] for hook in authenticated_hooks]:
                if info & 15 != 2:
                    raise RuntimeError("hook symbol is not a function")
                symbols[symbol] = address
    if build_id != identity["buildId"] or any(symbols.get(hook["symbol"]) != hook["offset"] for hook in authenticated_hooks):
        raise RuntimeError("binary build/symbol schema mismatch")
    # Authenticate the actual executable mappings, not only the selected launch path.
    mappings = Path(f"/proc/{pid}/maps").read_text().splitlines()
    loaded = {line.split(maxsplit=5)[5] for line in mappings if len(line.split(maxsplit=5)) == 6
              and "x" in line.split()[1] and line.split(maxsplit=5)[5].endswith("/headless_shell")}
    if loaded != {str(executable)} or any(sha(path) != identity["binarySha256"] for path in loaded):
        raise RuntimeError("loaded binary mapping identity mismatch")
    return str(executable), build_id


def main() -> None:
    source_path = Path(sys.argv[1])
    source = source_path.read_text()
    lock = threading.RLock()
    output_lock = threading.Lock()
    sessions = {}
    scripts = {}
    exit_watchers = {}
    detach_events = {}
    stop_read, stop_write = os.pipe()
    process_births = {}
    process_records = {}
    process_epochs = {}
    errors = []
    schema = None
    root_pid = None
    closing = False
    prepared = False
    drained = False
    released = False
    shutdown_script = None
    device = frida.get_local_device()

    def emit(message):
        # Frida detach waits for its callback on another thread. Output must
        # never reacquire the state lock held by the command doing detach.
        with output_lock:
            print(json.dumps(message), flush=True)

    def error(message):
        errors.append(message)
        emit({"error": message})

    def detached(pid, process_birth, renderer_hooks, reason, crash):
        emit({"lifecycle": {"event": "detached", "pid": pid, "processBirth": process_birth,
                           "ns": str(time.monotonic_ns()), "reason": reason, "closing": closing,
                           "rendererHooks": renderer_hooks}})
        if not closing and renderer_hooks:
            error(f"process {pid}/{process_birth} detached before drain: {reason}")
        if crash:
            error(f"owned process crash {pid}/{process_birth}: {crash}")
        detach_events[process_birth].set()

    def watch_exit(pid: int, process_birth: str, fd: int, completed: threading.Event) -> None:
        """Retain kernel exit readiness; reaped statuses remain explicitly missing."""
        try:
            readable, _, _ = select.select([fd, stop_read], [], [])
            if fd not in readable:
                return
            status = None
            try:
                fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
                if process_birth.startswith(f"{pid}:{fields[19]}:") and fields[0] in {"Z", "X"}:
                    status = int(fields[49])
            except (FileNotFoundError, ProcessLookupError):
                # pidfd proves exit, not an exit status already reaped by its parent.
                status = None
            emit({"lifecycle": {"event": "owned-exit", "pid": pid, "processBirth": process_birth,
                               "ns": str(time.monotonic_ns()), "exitCodeRaw": status,
                               "missing": status is None}})
            # Preserve raw status. The authenticated replay distinguishes only
            # an observed normal-shutdown SIGTERM from other nonzero exits.
        finally:
            os.close(fd)
            completed.set()

    def attach(pid, renderer, role="renderer"):
        if pid in sessions:
            if not process_births[pid].startswith(f"{birth(pid)}:"):
                raise RuntimeError("PID birth reuse")
            if not sessions[pid].is_detached:
                return
            if pid in scripts:
                raise RuntimeError("renderer exec lost native coverage")
            del sessions[pid]
        if pid != root_pid and pid not in descendants(root_pid):
            raise RuntimeError(f"refuse unowned process {pid}")
        path, _ = authenticate(pid, schema)
        process_births[pid] = f"{birth(pid)}:{process_epochs.get(pid, 0)}"
        attached_birth = process_births[pid]
        if pid not in exit_watchers:
            completed = threading.Event()
            watcher = threading.Thread(target=watch_exit,
                                       args=(pid, attached_birth, os.pidfd_open(pid), completed))
            exit_watchers[pid] = (watcher, completed)
            watcher.start()
        session = device.attach(pid)
        sessions[pid] = session
        detach_events[attached_birth] = threading.Event()
        session.on("detached", lambda reason, crash=None: detached(pid, attached_birth, renderer, reason, crash))
        # Retain the session through natural process exit. Release stops hooks
        # and disables gating without unloading a live process's Frida agent.
        # The inert keeper also prevents live-agent unload if failed/aborted
        # preparation forces bounded observer-child termination.
        keeper = session.create_script("void 0;")
        keeper.load()
        keeper.eternalize()
        emit({"lifecycle": {"event": "session-resident", "pid": pid, "processBirth": attached_birth,
                           "ns": str(time.monotonic_ns()), "until": "owned-process-exit",
                           "eternalized": True}})
        session.enable_child_gating()
        emit({"lifecycle": {"event": "owned-attach", "pid": pid, "processBirth": process_births[pid],
                           "ns": str(time.monotonic_ns()), "rendererHooks": renderer,
                           "executedPath": path, "binarySha256": schema["identity"]["binarySha256"]}})
        if renderer:
            script = session.create_script(source)
            scripts[pid] = script
            script.on("message", lambda message, data: error(f"agent {pid}: {message}"))
            script.load()
            result = script.exports_sync.initialize({
                "runId": schema["runId"], "processBirth": process_births[pid],
                "loadedPath": path, "hooks": schema["hooks"],
            })
            if result["loadedPath"] != path or result["arch"] != "arm64" or result["pointerSize"] != 8 or result["hooks"] != 7:
                raise RuntimeError("partial hooks/loaded module mismatch")
            process_records[pid] = {"pid": pid, "processBirth": process_births[pid], "role": role,
                              "authenticated": True, "hooks": result["hooks"], "readyNs": result["readyNs"],
                              "executedPath": path, "loadedPath": result["loadedPath"],
                              "binarySha256": schema["identity"]["binarySha256"],
                              "buildId": schema["identity"]["buildId"], "base": result["base"]}
            emit({"process": process_records[pid]})

    def handle_child(child):
        # Child gating is installed only on sessions in this browser's tree.
        if child.parent_pid not in sessions:
            return
        with lock:
            try:
                emit({"lifecycle": {"event": "child-added", "pid": child.pid, "parentPid": child.parent_pid,
                                   "ns": str(time.monotonic_ns()), "gated": True, "origin": child.origin}})
                if closing or not process_births[child.parent_pid].startswith(f"{birth(child.parent_pid)}:"):
                    raise RuntimeError("child parent lifetime no longer owned")
                # The owned parent gate suspends this child before workload.
                # Install its independent agent before resume. CDP must later
                # prove renderer role; no worker/utility coverage substitution.
                # Chromium's process-title update may replace NUL argument
                # separators with spaces. Match the exact --type token in
                # either kernel representation, never a URL/time heuristic.
                parent_args = Path(f"/proc/{child.parent_pid}/cmdline").read_bytes().replace(b"\0", b" ").split()
                child_args = Path(f"/proc/{child.pid}/cmdline").read_bytes().replace(b"\0", b" ").split()
                match child.origin:
                    case "fork":
                        # Zygote children become renderers without exec. Browser
                        # fork helpers exec before acquiring a renderer role;
                        # gate that exec but do not invent renderer coverage.
                        renderer = b"--type=zygote" in parent_args
                        attach(child.pid, renderer, "gated-child")
                    case "exec":
                        process_epochs[child.pid] = process_epochs.get(child.pid, 0) + 1
                        renderer = b"--type=renderer" in child_args
                        attach(child.pid, renderer, "gated-child")
                    case _:
                        raise RuntimeError(f"unsupported gated origin: {child.origin}")
            except Exception as exc:
                error(f"owned child hook coverage failed: {child.pid}: {exc}")
            finally:
                device.resume(child.pid)

    def child_added(child):
        # Do not block Frida's callback dispatcher with attach/resume RPCs.
        # The owned child remains gated while this worker installs its hooks.
        if child.parent_pid in sessions:
            threading.Thread(target=handle_child, args=(child,), daemon=True).start()

    device.on("child-added", child_added)
    try:
        for line in sys.stdin:
            request = json.loads(line)
            response = {"id": request["id"]}
            try:
                with lock:
                    match request["command"]:
                        case "prepare":
                            if prepared:
                                raise RuntimeError("observer already prepared")
                            schema = request["schema"]
                            root_pid = request["browserPid"]
                            if platform.system() != "Linux" or platform.machine() != "aarch64":
                                raise RuntimeError("unsupported host ABI")
                            if platform.python_version() != "3.11.2" or sha(sys.executable) != PYTHON_SHA or frida.__version__ != "17.21.0":
                                raise RuntimeError("external runtime version/executable mismatch")
                            package = Path(frida.__file__).parent
                            hashes = {name: sha(package / name) for name in FRIDA_FILES}
                            if hashes != FRIDA_FILES:
                                raise RuntimeError("Frida dependency identity mismatch")
                            if sha(source_path) != schema["agentSha256"] or sha(__file__) != schema["hostSha256"]:
                                raise RuntimeError("agent/host schema source mismatch")
                            owned = [root_pid, *descendants(root_pid)]
                            renderers = request["rendererPids"]
                            if not renderers or any(pid not in owned for pid in renderers):
                                raise RuntimeError("missing/unowned renderer")
                            for pid in owned:
                                # Utility/GPU processes use the same ELF. Gate
                                # descendants but do not pretend they are renderers.
                                attach(pid, pid in renderers)
                            prepared = True
                            response["runtime"] = {
                                "pythonVersion": platform.python_version(), "pythonExecutable": sys.executable,
                                "pythonSha256": sha(sys.executable), "fridaVersion": frida.__version__,
                                "fridaPath": str(package), "fridaFiles": hashes,
                                "permission": "attach only owned browser tree; no host permission mutation",
                            }
                        case "clock":
                            response["ns"] = str(time.monotonic_ns())
                        case "drain":
                            if not prepared:
                                raise RuntimeError("observer not prepared")
                            renderers = request["rendererPids"]
                            if any(pid not in scripts for pid in renderers):
                                raise RuntimeError("renderer appeared without gated hooks")
                            for pid, record in process_records.items():
                                if record["role"] == "gated-child" and pid in renderers:
                                    record["role"] = "renderer"
                                    emit({"processRole": {"pid": pid, "role": "renderer"}})
                                elif record["role"] == "gated-child":
                                    error(f"unverified native child role: {pid}")
                            for pid, script in scripts.items():
                                result = script.exports_sync.drain()
                                emit({"buffer": {"pid": pid, "dropped": result["dropped"],
                                                "sequence": result["sequence"], "complete": result["complete"]},
                                      "events": result["events"]})
                                if result["dropped"] or not result["complete"] or result["sequence"] != len(result["events"]):
                                    raise RuntimeError(f"incomplete native buffer {pid}")
                            drained = True
                            response.update({"drained": not errors, "ns": str(time.monotonic_ns())})
                        case "release" | "close":
                            closing = True
                            for pid, script in ([] if released else scripts.items()):
                                try:
                                    if not drained:
                                        result = script.exports_sync.drain()
                                        emit({"buffer": {"pid": pid, "dropped": result["dropped"],
                                                        "sequence": result["sequence"], "complete": result["complete"]},
                                              "events": result["events"]})
                                        if result["dropped"] or not result["complete"]:
                                            error(f"incomplete cleanup drain: {pid}")
                                    script.exports_sync.stop()
                                except Exception as exc:
                                    error(f"script cleanup {pid}: {exc}")
                            if request["command"] == "release" and not released and drained:
                                shutdown_script = sessions[root_pid].create_script(source)
                                def shutdown_message(message, data):
                                    match message["type"]:
                                        case "send":
                                            emit({"lifecycle": message["payload"]})
                                        case _:
                                            error(f"shutdown agent: {message}")
                                shutdown_script.on("message", shutdown_message)
                                shutdown_script.load()
                                shutdown_script.exports_sync.initialize_shutdown({
                                    "runId": schema["runId"], "processBirth": process_births[root_pid],
                                    "loadedPath": str(Path(f"/proc/{root_pid}/exe").resolve(strict=True)),
                                    "hooks": schema["shutdownHooks"],
                                })
                            for session in ([] if released else reversed(list(sessions.values()))):
                                try:
                                    if not session.is_detached:
                                        session.disable_child_gating()
                                        if request["command"] == "close":
                                            session.detach()
                                except Exception as exc:
                                    error(f"session cleanup: {exc}")
                            response["detached"] = all(session.is_detached for session in sessions.values())
                            released = True
                            if request["command"] == "close":
                                if request.get("browserResult") is not None:
                                    emit({"lifecycle": {"event": "browser-result", **request["browserResult"]}})
                                deadline = time.monotonic() + 5
                                for pid, (_, completed) in exit_watchers.items():
                                    if not completed.wait(max(0, deadline - time.monotonic())):
                                        error(f"owned process exit deadline: {pid}")
                                for process_birth, completed in detach_events.items():
                                    if not completed.wait(max(0, deadline - time.monotonic())):
                                        error(f"owned session detach deadline: {process_birth}")
                                response["detached"] = all(session.is_detached for session in sessions.values())
                                response["ownedExited"] = all(done.is_set() for _, done in exit_watchers.values())
                                emit(response)
                                break
                        case "begin-close":
                            if not released or shutdown_script is None:
                                raise RuntimeError("shutdown observation not ready")
                            emit({"lifecycle": {"event": "graceful-close", "pid": root_pid,
                                               "processBirth": process_births[root_pid],
                                               "ns": str(time.monotonic_ns())}})
                        case _:
                            raise RuntimeError("unknown observer command")
            except Exception as exc:
                response["error"] = f"{type(exc).__name__}: {exc}"
            emit(response)
    finally:
        closing = True
        device.off("child-added", child_added)
        for session in reversed(list(sessions.values())):
            try:
                if not session.is_detached:
                    session.disable_child_gating()
                    session.detach()
            except Exception as exc:
                error(f"final session cleanup: {exc}")
        os.write(stop_write, b"x")
        for watcher, _ in exit_watchers.values():
            watcher.join()
        os.close(stop_read)
        os.close(stop_write)


if __name__ == "__main__":
    main()
