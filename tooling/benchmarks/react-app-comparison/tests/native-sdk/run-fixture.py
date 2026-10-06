"""Finite canonical real-SDK recorder checks; not browser/performance acceptance."""
# Run: /opt/fluo-native-debug/bin/python3.11 run-fixture.py <fresh-output-root>
# Requires the already-provisioned Python 3.11.2 / Frida 17.21.0 Linux ARM64 guest.
import base64
import ctypes
import hashlib
import json
import mmap
import os
from pathlib import Path
import queue
import struct
import subprocess
import sys
import threading
import time

import frida

ROOT = Path(__file__).resolve().parent
OUTPUT = Path(sys.argv[1]).resolve()
OUTPUT.mkdir(exist_ok=False)
AGENT = ROOT.parent.parent / "src/native-lifetime-agent.js"
SOURCE = AGENT.read_text()
RECORDER = SOURCE.split("new CModule(`\n", 1)[1].split("\n  `, { journal, state,", 1)[0]
FIELDS = ["resource", "resourceBirth", "loader", "loaderBirth", "identifier",
          "observerCall", "call", "parent", "thread", "normal", "hooks"]
NAMES = ["hooks-ready", "resource-birth", "loader-birth", "identifier",
         "cancel-enter", "error-enter", "error-return", "cancel-return"]
libc = ctypes.CDLL(None, use_errno=True)
libc.mmap.restype = ctypes.c_void_p
libc.mmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int,
                     ctypes.c_int, ctypes.c_int, ctypes.c_long]
libc.munmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
libc.mprotect.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int]
atomic_page = mmap.mmap(-1, mmap.PAGESIZE, prot=mmap.PROT_READ | mmap.PROT_WRITE)
atomic_page.write(struct.pack("<II", 0x88dffc00, 0xd65f03c0))
atomic_address = ctypes.addressof(ctypes.c_char.from_buffer(atomic_page))
assert libc.mprotect(atomic_address, mmap.PAGESIZE, mmap.PROT_READ | mmap.PROT_EXEC) == 0
acquire = ctypes.CFUNCTYPE(ctypes.c_uint32, ctypes.c_void_p)(atomic_address)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def emit(case, **fields):
    print(json.dumps({"case": case, **fields}, sort_keys=True), flush=True)


def decode(raw):
    attempted, committed, dropped, callbacks, calls, failed, owned = struct.unpack_from("<7I", raw, 28)
    assert attempted == committed and not any([dropped, callbacks, calls, failed]) and owned == 1
    assert len(raw) == 512 + attempted * 128
    result = []
    previous = 0
    for index in range(attempted):
        offset = 512 + index * 128
        marker, kind, ns = struct.unpack_from("<IIQ", raw, offset)
        mask = struct.unpack_from("<I", raw, offset + 104)[0]
        assert marker == index + 1 and 1 <= kind <= 8 and mask >> 11 == 0
        assert raw[offset + 108:offset + 128] == bytes(20)
        assert ns >= previous
        previous = ns
        values = struct.unpack_from("<11Q", raw, offset + 16)
        event = {"event": NAMES[kind - 1], "seq": marker, "ns": str(ns)}
        for field, value, number in zip(FIELDS, values, range(11)):
            if not mask & (1 << number):
                assert value == 0, (index, field, value)
                continue
            if field in {"resource", "loader"}:
                value = hex(value)
            elif field == "identifier":
                value = str(value)
            elif field == "parent":
                value = value or None
            elif field == "normal":
                assert value == 1
                value = True
            event[field] = value
        result.append(event)
    return result


def check_calls(events):
    stacks = {}
    pairs = {}
    for event in events:
        if event["event"] not in {"cancel-enter", "cancel-return", "error-enter", "error-return"}:
            continue
        thread, call = event["thread"], event["call"]
        stack = stacks.setdefault(thread, [])
        if event["event"].endswith("-enter"):
            assert call not in pairs
            assert event["parent"] == (stack[-1] if stack else None)
            stack.append(call)
            pairs[call] = event
        else:
            assert stack.pop() == call and event["normal"] is True
            entered = pairs[call]
            assert event["event"] == entered["event"].replace("-enter", "-return")
            assert {k: v for k, v in event.items() if k not in {"event", "seq", "ns", "normal"}} == {
                k: v for k, v in entered.items() if k not in {"event", "seq", "ns"}
            }
    assert all(not stack for stack in stacks.values())


def run_case(variant, command, *, boundary=False, clock=None, retirement=False, publication=False):
    name = (f"{variant}-{command}" + ("-boundary" if boundary else "")
            + (f"-{clock}" if clock else "") + ("-publication" if publication else ""))
    source_path = AGENT
    source = source_path.read_text() + "\n" + (ROOT / "fixture-agent.js").read_text()
    (OUTPUT / f"{name}-loaded.js").write_text(source)
    process = subprocess.Popen([str(ROOT / "headless_shell")], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    lines = queue.Queue()
    def stdout_reader():
        for line in process.stdout:
            lines.put(line)
    reader = threading.Thread(target=stdout_reader)
    reader.start()
    session = None
    fd = None
    address = None
    errors = []
    raw = b""
    try:
        ready = json.loads(lines.get(timeout=10))
        assert ready["ready"] is True and ready["pid"] == process.pid
        os_birth = f"{process.pid}:{Path(f'/proc/{process.pid}/stat').read_text().rsplit(')', 1)[1].split()[19]}"
        session = frida.attach(process.pid)
        detached = threading.Event()
        session.on("detached", lambda *args: detached.set())
        script = session.create_script(source)
        script.on("message", lambda message, data: errors.append(message))
        script.load()
        hooks = script.exports_sync.fixture_hooks()
        assert [hook["event"] for hook in hooks] == [
            "resource", "loader", "observer", "identifier", "identifier", "cancel", "error"]
        descriptor = script.exports_sync.initialize({
            "runId": name, "processBirth": f"{os_birth}:7", "execEpoch": 7,
            "loadedPath": str(ROOT / "headless_shell"), "hooks": hooks,
        })
        assert descriptor["capacity"] == 500000 and descriptor["stride"] == 128
        assert descriptor["size"] == 64000512 and descriptor["headerSize"] == 512
        fd = os.open(f"/proc/{process.pid}/fd/{descriptor['fd']}", os.O_RDONLY | os.O_CLOEXEC)
        stat = os.fstat(fd)
        address = libc.mmap(None, descriptor["size"], mmap.PROT_READ, mmap.MAP_SHARED, fd, 0)
        assert address != ctypes.c_void_p(-1).value
        acquired = time.monotonic_ns()
        assert acquire(address + 28) == acquire(address + 52) == 0
        ack = script.exports_sync.acknowledge_ownership()
        acknowledged = time.monotonic_ns()
        assert ack["hooks"] == 7 and ack["arch"] == "arm64"
        assert acquired <= int(ack["readyNs"]) <= acknowledged
        assert acquire(address + 28) == acquire(address + 32) == acquire(address + 52) == 1
        if clock or publication:
            assert script.exports_sync.fixture_alternate(RECORDER,
                                                         f"fixture_clock_{clock}" if clock else None,
                                                         publication) is True
        if boundary:
            script.exports_sync.fixture_boundary()
        # The stdout queue and detached event are subscribed before the action.
        process.stdin.write(command + "\n")
        process.stdin.flush()
        if publication:
            assert json.loads(lines.get(timeout=10)) == {"publication": "before-slot"}
            assert [acquire(address + offset) for offset in [28, 32, 40, 44]] == [2, 1, 1, 1]
            assert acquire(address + 640) == 0
            prepared_payload = ctypes.string_at(address + 644, 124)
            assert struct.unpack_from("<I", prepared_payload)[0] == 6
            assert prepared_payload[104:] == bytes(20)
            process.stdin.write("x")
            process.stdin.flush()
            assert json.loads(lines.get(timeout=10)) == {"publication": "after-slot"}
            assert acquire(address + 640) == 2
            assert acquire(address + 32) == 1
            assert ctypes.string_at(address + 644, 124) == prepared_payload
            process.stdin.write("x")
            process.stdin.flush()
        if command == "abandon":
            assert process.wait(timeout=20) == -15
            assert detached.wait(10)
        else:
            assert json.loads(lines.get(timeout=20)) == {"done": command}
            assert script.exports_sync.stop() is True
        counters = [acquire(address + offset) for offset in range(28, 56, 4)]
        emit(name, stage="raw-snapshot", counters=counters)
        if retirement:
            process.stdin.write("quit\n")
            process.stdin.flush()
            assert process.wait(timeout=10) == 0
            assert detached.wait(10)
        end_ns = time.monotonic_ns()
        if boundary:
            raw = ctypes.string_at(address, 512)
            tail = ctypes.string_at(address + 512 + 499999 * 128, 128)
            (OUTPUT / f"{name}-last-slot.bin").write_bytes(tail)
            assert counters == [500001, 500000, 1, 0, 0, 0, 1], counters
            assert struct.unpack_from("<II", tail) == (500000, 6)
            assert tail[108:] == bytes(20)
        else:
            raw = ctypes.string_at(address, 512 + min(counters[0], 500000) * 128)
        (OUTPUT / f"{name}-journal.bin").write_bytes(raw)
        assert not errors, errors
        assert struct.unpack_from("<7I", raw) == (0x4e4c4a32, 2, 500000, 128, 512, process.pid, 7)
        assert raw[64:192].split(b"\0")[0].decode() == name
        assert raw[192:320].split(b"\0")[0].decode() == f"{os_birth}:7"
        if clock == "failure":
            assert counters == [1, 1, 0, 0, 0, 1, 1], counters
        elif command == "abandon":
            assert counters == [2, 2, 0, 0, 1, 0, 1], counters
        elif not boundary:
            events = decode(raw)
            check_calls(events)
            owner = {**descriptor, "osBirthBefore": os_birth, "osBirthAfter": os_birth,
                     "inode": stat.st_ino, "device": stat.st_dev,
                     "acquiredNs": str(acquired), "acknowledgedNs": str(acknowledged)}
            captured = {"pid": process.pid, "processBirth": f"{os_birth}:7",
                        "readyNs": ack["readyNs"], "endNs": str(end_ns)}
            record = {"journal": {"ownership": owner, "raw": base64.b64encode(raw).decode(),
                                  "complete": True, "snapshotNs": str(time.monotonic_ns())},
                      "process": captured, "runId": name, "events": events}
            (OUTPUT / f"{name}.json").write_text(json.dumps(record, indent=2) + "\n")
            emit(name, verdict="PASS", events=len(events), counters=counters,
                 sourceSha256=sha(source_path.read_bytes()), loadedScriptSha256=sha(source.encode()),
                 journalSha256=sha(raw), mappedAfterRetirement=retirement)
            return events
        emit(name, verdict="PASS", counters=counters,
             sourceSha256=sha(source_path.read_bytes()), loadedScriptSha256=sha(source.encode()),
             journalSha256=sha(raw), rawExit=process.returncode)
        return []
    finally:
        if process.poll() is None:
            process.stdin.write("quit\n")
            process.stdin.flush()
            process.wait(timeout=10)
        if session is not None and not session.is_detached:
            session.detach()
        reader.join(timeout=10)
        assert not reader.is_alive()
        stderr = process.stderr.read()
        assert not stderr, stderr
        if address is not None:
            libc.munmap(address, 64000512)
        if fd is not None:
            os.close(fd)
        emit(name, ownedPid=process.pid, ownedExit=process.returncode,
             ownedProcessGone=not Path(f"/proc/{process.pid}").exists())


def canonical(events):
    return [{k: ("main" if k == "thread" else v)
             for k, v in event.items() if k not in {"ns", "seq"}} for event in events]


try:
    assert frida.__version__ == "17.21.0"
    assert sys.version_info[:3] == (3, 11, 2)
    emit("runtime", frida=frida.__version__, python=sys.version.split()[0],
         fixtureSha256=sha((ROOT / "headless_shell").read_bytes()),
         agentSha256=sha(AGENT.read_bytes()))
    for command in ["sequential", "reuse_nested", "deep", "concurrent"]:
        events = run_case("canonical", command, retirement=command == "sequential")
        if command == "deep":
            assert len(events) == 131
        if command == "concurrent":
            assert len({event["thread"] for event in events if "thread" in event}) == 4
        if command == "sequential":
            assert str(2**64 - 1) in [e["identifier"] for e in events if e["event"] == "identifier"]
            cancels = [e for e in events if e["event"] == "cancel-enter"]
            assert [e.get("resourceBirth") for e in cancels[-4:]] == [1, 3, 0, None]
    run_case("canonical", "one", boundary=True)
    run_case("canonical", "abandon")
    run_case("canonical", "one", clock="failure")
    reentry = run_case("canonical", "one", clock="reentrant")
    assert [e["event"] for e in reentry] == ["hooks-ready", "error-enter", "error-return"]
    run_case("canonical", "one", publication=True)
    emit("finite-native-fixture", verdict="PASS", sourceSha256=sha(AGENT.read_bytes()),
         browserLaunched=False, performanceAcceptance=False)
finally:
    atomic_page.close()
