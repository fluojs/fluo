"""Owned-process, authenticated Linux/AArch64 headless lifetime observer v1."""
import hashlib
import base64
import ctypes
import json
import mmap
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
    journals = {}
    snapshots = set()
    stopped_epochs = set()
    parent_scripts = {}
    retirements = {}
    exit_records = {}
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
    libc = ctypes.CDLL(None, use_errno=True)
    libc.mmap.restype = ctypes.c_void_p
    libc.mmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_long]
    libc.munmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
    libc.mprotect.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int]
    # Host reads publication markers with the same native AArch64 acquire,
    # not struct.unpack_from masquerading as an atomic shared-memory load.
    acquire_code = mmap.mmap(-1, mmap.PAGESIZE, prot=mmap.PROT_READ | mmap.PROT_WRITE)
    acquire_code.write(struct.pack("<II", 0x88dffc00, 0xd65f03c0))
    acquire_address = ctypes.addressof(ctypes.c_char.from_buffer(acquire_code))
    if libc.mprotect(acquire_address, mmap.PAGESIZE, mmap.PROT_READ | mmap.PROT_EXEC) != 0:
        raise RuntimeError("native acquire primitive unavailable")
    acquire = ctypes.CFUNCTYPE(ctypes.c_uint32, ctypes.c_void_p)(acquire_address)

    def emit(message):
        # Frida detach waits for its callback on another thread. Output must
        # never reacquire the state lock held by the command doing detach.
        with output_lock:
            print(json.dumps(message), flush=True)

    def error(message):
        errors.append(message)
        emit({"error": message})

    def detached(pid, process_birth, renderer_hooks, reason, crash):
        record = {"event": "detached", "pid": pid, "processBirth": process_birth,
                  "ns": str(time.monotonic_ns()), "reason": reason, "closing": closing,
                  "rendererHooks": renderer_hooks}
        retirements[process_birth] = record
        emit({"lifecycle": record})
        if not closing and renderer_hooks and reason not in {"process-terminated", "process-replaced"}:
            error(f"process {pid}/{process_birth} unsupported detach: {reason}")
        if crash:
            error(f"owned process crash {pid}/{process_birth}: {crash}")
        detach_events[process_birth].set()

    def watch_exit(pid: int, os_birth: str, process_birth: str, fd: int, completed: threading.Event) -> None:
        """Retain kernel exit readiness; reaped statuses remain explicitly missing."""
        try:
            readable, _, _ = select.select([fd, stop_read], [], [])
            if fd not in readable:
                return
            status = None
            try:
                fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
                if os_birth == f"{pid}:{fields[19]}" and fields[0] in {"Z", "X"}:
                    status = int(fields[49])
            except (FileNotFoundError, ProcessLookupError):
                # pidfd proves exit, not an exit status already reaped by its parent.
                status = None
            record = {"event": "owned-exit", "pid": pid, "processBirth": process_birth, "osBirth": os_birth,
                               "ns": str(time.monotonic_ns()), "exitCodeRaw": status,
                               "missing": status is None}
            exit_records[os_birth] = record
            emit({"lifecycle": record})
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
            previous = process_births[pid]
            if previous in scripts and retirements.get(previous, {}).get("reason") != "process-replaced":
                raise RuntimeError("unsupported renderer session replacement")
            del sessions[pid]
        if pid != root_pid and pid not in descendants(root_pid):
            raise RuntimeError(f"refuse unowned process {pid}")
        path, _ = authenticate(pid, schema)
        process_births[pid] = f"{birth(pid)}:{process_epochs.get(pid, 0)}"
        attached_birth = process_births[pid]
        if pid not in exit_watchers:
            completed = threading.Event()
            os_birth = birth(pid)
            fd = os.pidfd_open(pid)
            if birth(pid) != os_birth:
                os.close(fd)
                raise RuntimeError("pidfd OS birth mismatch")
            watcher = threading.Thread(target=watch_exit,
                                       args=(pid, os_birth, attached_birth, fd, completed))
            exit_watchers[pid] = (watcher, completed)
            watcher.start()
        session = device.attach(pid)
        sessions[pid] = session
        detach_events[attached_birth] = threading.Event()
        session.on("detached", lambda reason, crash=None: detached(pid, attached_birth, renderer, reason, crash))
        # Retain the session and child gating through natural process exit.
        # Release stops request hooks without changing a live Frida agent.
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
            scripts[attached_birth] = script
            script.on("message", lambda message, data: error(f"agent {pid}: {message}"))
            script.load()
            descriptor = script.exports_sync.initialize({
                "runId": schema["runId"], "processBirth": process_births[pid],
                "execEpoch": process_epochs.get(pid, 0), "loadedPath": path, "hooks": schema["hooks"],
            })
            before = birth(pid)
            if before != attached_birth.rsplit(":", 1)[0]:
                raise RuntimeError("journal owner birth changed before acquisition")
            if (descriptor["pid"] != pid or descriptor["processBirth"] != attached_birth
                    or descriptor["runId"] != schema["runId"] or descriptor["version"] != 2
                    or descriptor["capacity"] != 500000 or descriptor["stride"] != 128
                    or descriptor["headerSize"] != 512 or descriptor["size"] != 64000512
                    or descriptor["protocol"] != "aarch64-release-acquire-v2"):
                raise RuntimeError("foreign/unsupported journal descriptor")
            fd = os.open(f"/proc/{pid}/fd/{descriptor['fd']}", os.O_RDONLY | os.O_CLOEXEC)
            if birth(pid) != before:
                os.close(fd)
                raise RuntimeError("journal owner birth changed during acquisition")
            stat = os.fstat(fd)
            if stat.st_size != descriptor["size"]:
                os.close(fd)
                raise RuntimeError("journal descriptor size mismatch")
            address = libc.mmap(None, stat.st_size, mmap.PROT_READ, mmap.MAP_SHARED, fd, 0)
            if address == ctypes.c_void_p(-1).value:
                os.close(fd)
                raise RuntimeError("host journal mapping failed")
            owner = {**descriptor, "osBirthBefore": before, "osBirthAfter": birth(pid),
                     "device": stat.st_dev, "inode": stat.st_ino,
                     "acquiredNs": str(time.monotonic_ns())}
            journals[attached_birth] = (fd, address, owner)
            header = ctypes.string_at(address, 512)
            if (struct.unpack_from("<7I", header) !=
                    (0x4e4c4a32, 2, 500000, 128, 512, pid, process_epochs.get(pid, 0))
                    or header[64:192].split(b"\0", 1)[0].decode() != schema["runId"]
                    or header[192:320].split(b"\0", 1)[0].decode() != attached_birth
                    or owner["osBirthBefore"] != owner["osBirthAfter"]):
                raise RuntimeError("host-acquired journal header ownership mismatch")
            result = script.exports_sync.acknowledge_ownership()
            owner["acknowledgedNs"] = str(time.monotonic_ns())
            emit({"journalOwnership": owner})
            if result["loadedPath"] != path or result["arch"] != "arm64" or result["pointerSize"] != 8 or result["hooks"] != 7:
                raise RuntimeError("partial hooks/loaded module mismatch")
            process_records[attached_birth] = {"pid": pid, "processBirth": attached_birth, "role": role,
                              "authenticated": True, "hooks": result["hooks"], "readyNs": result["readyNs"],
                              "executedPath": path, "loadedPath": result["loadedPath"],
                              "binarySha256": schema["identity"]["binarySha256"],
                              "buildId": schema["identity"]["buildId"], "base": result["base"]}
            emit({"process": process_records[attached_birth]})

    def snapshot(process_birth):
        """Read only stopped live hooks or an immutable retired image; retain torn raw."""
        fd, address, owner = journals[process_birth]
        attempted = acquire(address + 28)
        committed = acquire(address + 32)
        counts = [acquire(address + offset) for offset in (36, 40, 44, 48, 52)]
        markers = [acquire(address + 512 + index * 128) for index in range(min(attempted, 500000))]
        raw = ctypes.string_at(address, 512 + min(attempted, 500000) * 128)
        dropped, callbacks, calls, failed, owned = counts
        complete = (0 < attempted == committed <= 500000 and not any(counts[:4]) and owned == 1
                    and markers == list(range(1, attempted + 1)))
        names = ["hooks-ready", "resource-birth", "loader-birth", "identifier",
                 "cancel-enter", "error-enter", "error-return", "cancel-return"]
        fields = ["resource", "resourceBirth", "loader", "loaderBirth", "identifier",
                  "observerCall", "call", "parent", "thread", "normal", "hooks"]
        events = []
        for index in range(min(committed, 500000)):
            offset = 512 + index * 128
            marker, kind = struct.unpack_from("<II", raw, offset)
            if marker != index + 1 or not 1 <= kind <= len(names):
                complete = False
                break
            values = struct.unpack_from("<12Q", raw, offset + 8)
            mask = struct.unpack_from("<I", raw, offset + 104)[0]
            event = {"event": names[kind - 1], "runId": schema["runId"], "pid": owner["pid"],
                     "processBirth": process_birth, "seq": marker, "ns": str(values[0])}
            for number, field in enumerate(fields):
                if mask & (1 << number):
                    value = values[number + 1]
                    match field:
                        case "resource" | "loader":
                            value = hex(value)
                        case "identifier":
                            value = str(value)
                        case "parent":
                            value = value or None
                        case "normal":
                            value = value == 1
                    event[field] = value
            events.append(event)
        record = process_records[process_birth]
        if record["role"] == "gated-child":
            if any(event["event"] == "resource-birth" for event in events):
                record["role"] = "renderer"
                emit({"processRole": {"pid": record["pid"], "processBirth": process_birth,
                                      "role": "renderer", "source": "native-resource-hook"}})
            else:
                complete = False
                error(f"unverified native child role: {process_birth}")
        retirement = retirements.get(process_birth)
        end_kind = "live"
        end_ns = str(time.monotonic_ns())
        if retirement:
            end_kind = "exec" if retirement["reason"] == "process-replaced" else "retired"
            end_ns = retirement["ns"]
        journal_record = {"ownership": owner, "raw": base64.b64encode(raw).decode(),
                          "snapshotNs": str(time.monotonic_ns()), "complete": complete}
        emit({"journal": journal_record, "events": events,
              "buffer": {"pid": record["pid"], "processBirth": process_birth,
                         "dropped": dropped, "sequence": committed, "complete": complete},
              "processEnd": {"processBirth": process_birth, "endNs": end_ns, "endKind": end_kind}})
        snapshots.add(process_birth)
        if not complete:
            raise RuntimeError(f"incomplete native journal {process_birth}")

    def install_shutdown():
        nonlocal shutdown_script
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

    def install_parent(pid):
        """Observe only actual wait/reap calls in authenticated owned parents."""
        process_birth = process_births[pid]
        if process_birth in parent_scripts:
            return
        script = sessions[pid].create_script(source)
        parent_scripts[process_birth] = script
        def parent_message(message, data):
            match message["type"]:
                case "send":
                    emit({"lifecycle": message["payload"]})
                case _:
                    error(f"parent wait agent {pid}: {message}")
        script.on("message", parent_message)
        script.load()
        script.exports_sync.initialize_parent({
            "runId": schema["runId"], "processBirth": process_birth,
            "loadedPath": str(Path(f"/proc/{pid}/exe").resolve(strict=True)),
            "targets": [{"pid": number, "osBirth": value.rsplit(":", 1)[0]}
                        for number, value in process_births.items()],
        })

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
                        attach(child.pid, renderer, "renderer" if b"--type=renderer" in child_args else "gated-child")
                    case "exec":
                        previous = process_births.get(child.pid)
                        if previous and retirements.get(previous, {}).get("reason") != "process-replaced":
                            raise RuntimeError("exec missing authenticated old-image retirement")
                        process_epochs[child.pid] = process_epochs.get(child.pid, 0) + 1
                        renderer = b"--type=renderer" in child_args
                        attach(child.pid, renderer, "renderer" if renderer else "non-renderer")
                        emit({"lifecycle": {"event": "exec-success", "pid": child.pid,
                              "previousBirth": previous, "processBirth": process_births[child.pid],
                              "ns": str(time.monotonic_ns()), "gated": True}})
                    case _:
                        raise RuntimeError(f"unsupported gated origin: {child.origin}")
                for process_birth, script in parent_scripts.items():
                    if process_birth not in retirements:
                        if script.exports_sync.register_child({
                                "runId": schema["runId"], "pid": child.pid,
                                "osBirth": process_births[child.pid].rsplit(":", 1)[0]}) is not True:
                            raise RuntimeError("parent child ownership not acknowledged before resume")
                if b"--type=zygote" in child_args and not renderer:
                    install_parent(child.pid)
            except Exception as exc:
                error(f"owned child hook coverage failed: {child.pid}: {exc}")
            finally:
                emit({"lifecycle": {"event": "child-resume", "pid": child.pid,
                      "processBirth": process_births.get(child.pid), "ns": str(time.monotonic_ns())}})
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
                            for pid in owned:
                                args = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").split()
                                if pid == root_pid or b"--type=zygote" in args:
                                    install_parent(pid)
                            install_shutdown()
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
                            if any(process_births.get(pid) not in scripts for pid in renderers):
                                raise RuntimeError("renderer appeared without gated hooks")
                            for process_birth, record in process_records.items():
                                pid = record["pid"]
                                if record["role"] == "gated-child" and pid in renderers and process_births[pid] == process_birth:
                                    record["role"] = "renderer"
                                    emit({"processRole": {"pid": pid, "processBirth": process_birth, "role": "renderer"}})
                            for process_birth, script in scripts.items():
                                try:
                                    if process_birth not in retirements:
                                        if script.exports_sync.stop() is not True:
                                            raise RuntimeError("native hook stop not acknowledged")
                                    stopped_epochs.add(process_birth)
                                except Exception as exc:
                                    error(f"native stop {process_birth}: {exc}")
                                try:
                                    snapshot(process_birth)
                                except Exception as exc:
                                    error(f"native snapshot {process_birth}: {exc}")
                            drained = True
                            response.update({"drained": not errors, "ns": str(time.monotonic_ns())})
                        case "release" | "close":
                            closing = True
                            release_errors = len(errors)
                            for process_birth, script in ([] if released else scripts.items()):
                                try:
                                    if not drained:
                                        if process_birth not in retirements:
                                            if script.exports_sync.stop() is not True:
                                                raise RuntimeError("cleanup hook stop not acknowledged")
                                        stopped_epochs.add(process_birth)
                                        snapshot(process_birth)
                                except Exception as exc:
                                    error(f"script cleanup {process_birth}: {exc}")
                            # Request hooks are stopped, but exec children can
                            # still be resuming. Keep their gates resident until
                            # browser shutdown instead of mutating live agents.
                            for session in (reversed(list(sessions.values())) if request["command"] == "close" else []):
                                try:
                                    if not session.is_detached:
                                        session.disable_child_gating()
                                        session.detach()
                                except Exception as exc:
                                    error(f"session cleanup: {exc}")
                            response["detached"] = all(session.is_detached for session in sessions.values())
                            released = (drained and not errors and len(errors) == release_errors
                                        and len(stopped_epochs) == len(scripts))
                            response["released"] = released
                            response["shutdownReady"] = released and shutdown_script is not None
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
        for process_birth, (fd, address, owner) in journals.items():
            if process_birth not in snapshots:
                attempted = acquire(address + 28)
                emit({"retainedJournalFailure": {
                    "ownership": owner, "complete": False, "snapshotNs": str(time.monotonic_ns()),
                    "raw": base64.b64encode(ctypes.string_at(
                        address, 512 + min(attempted, 500000) * 128)).decode(),
                }})
            libc.munmap(address, owner["size"])
            os.close(fd)
        acquire_code.close()


if __name__ == "__main__":
    main()
