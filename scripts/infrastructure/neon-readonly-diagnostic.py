#!/usr/bin/env python3
"""Bounded, redacted Neon check. Never prints libpq output or connection values."""

import argparse
import json
import os
from pathlib import Path
import shlex
import socket
import ssl
import struct
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urlsplit


def load_urls(path):
    stat = path.stat()
    if path.is_symlink() or stat.st_uid != os.getuid() or stat.st_mode & 0o777 != 0o600:
        raise ValueError("credential file must be owner-owned, regular, mode 0600")
    if not path.is_file():
        raise ValueError("credential file must be regular")
    values = {}
    for line in path.read_text().splitlines():
        tokens = shlex.split(line, comments=True)
        if tokens and tokens[0] == "export":
            tokens = tokens[1:]
        if tokens:
            if len(tokens) != 1 or "=" not in tokens[0]:
                raise ValueError("unsupported credential file syntax")
            key, value = tokens[0].split("=", 1)
            values[key] = value
    urls = [urlsplit(values[key]) for key in ("DIRECT_URL", "DATABASE_URL")]
    for url in urls:
        if url.scheme not in ("postgres", "postgresql") or not all(
            (url.hostname, url.username, url.password, url.path.strip("/"))
        ):
            raise ValueError("invalid connection structure")
    if not (
        urls[1].hostname == urls[0].hostname.replace(".", "-pooler.", 1)
        and urls[0].username == urls[1].username
        and urls[0].password == urls[1].password
        and urls[0].path == urls[1].path
        and urls[0].port == urls[1].port
    ):
        raise ValueError("direct and pooled credentials must be paired")
    return urls


def classify(returncode, stderr):
    if returncode == 0:
        return "pass"
    # Match actual errors, not the word 'timeout' inside a rejected parameter name.
    text = stderr.decode(errors="replace").lower()
    if "unsupported startup parameter" in text:
        return "unsupported_startup_parameter"
    if "timeout expired" in text or "timed out" in text:
        return "connection_timeout"
    if "certificate verify failed" in text or "root certificate" in text:
        return "certificate_failure"
    if "password authentication failed" in text:
        return "authentication_failure"
    return "connection_failure_redacted"


def query(url, negative_control=False):
    # Do not inherit PGOPTIONS, service files or other ambient libpq overrides.
    env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    env.update(
        PGHOST=url.hostname,
        PGPORT=str(url.port or 5432),
        PGUSER=unquote(url.username),
        PGPASSWORD=unquote(url.password),
        PGDATABASE=unquote(url.path[1:]),
        PGCONNECT_TIMEOUT="8",
        PGSSLMODE="verify-full",
        PGSSLROOTCERT=ssl.get_default_verify_paths().cafile or "/etc/ssl/cert.pem",
        PGCHANNELBINDING="require",
    )
    if negative_control:
        env["PGOPTIONS"] = "-c statement_timeout=5000"
    sql = "BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; SELECT 1; ROLLBACK;"
    try:
        result = subprocess.run(
            ["psql", "-X", "-w", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
            env=env, capture_output=True, timeout=20, check=False,
        )
        return classify(result.returncode, result.stderr)
    except subprocess.TimeoutExpired:
        return "process_deadline_20s"


def transport(url):
    results = []
    # One address per family, no retries or polling. Hostname remains TLS SNI.
    for family in (socket.AF_INET, socket.AF_INET6):
        phase = "dns"
        try:
            address = socket.getaddrinfo(
                url.hostname, url.port or 5432, family, socket.SOCK_STREAM,
            )[0][4]
            phase = "tcp"
            with socket.socket(family, socket.SOCK_STREAM) as connection:
                connection.settimeout(4)
                connection.connect(address)
                phase = "postgres_sslrequest"
                connection.sendall(struct.pack("!II", 8, 80877103))
                if connection.recv(1) != b"S":
                    raise ValueError("SSL negotiation rejected")
                phase = "tls"
                with ssl.create_default_context().wrap_socket(
                    connection, server_hostname=url.hostname,
                ) as secure:
                    results.append({"family": family.name, "tls": secure.version(), "verified": True})
        except Exception as error:
            results.append({"family": family.name, "failed_phase": phase, "error_type": type(error).__name__})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--transport", action="store_true")
    parser.add_argument("--startup-negative-control", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        assert classify(1, b"unsupported startup parameter in options: statement_timeout") == "unsupported_startup_parameter"
        assert classify(1, b"timeout expired") == "connection_timeout"
        assert classify(0, b"") == "pass"
        assert classify(1, b"secret-bearing unknown error") == "connection_failure_redacted"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.env"
            path.write_text(
                "DIRECT_URL='postgresql://test:synthetic@ep-test.example/test'\n"
                "export DATABASE_URL='postgresql://test:synthetic@ep-test-pooler.example/test'\n"
            )
            path.chmod(0o600)
            assert len(load_urls(path)) == 2
            path.chmod(0o644)
            try:
                load_urls(path)
            except ValueError:
                pass
            else:
                raise AssertionError("unsafe credential permissions accepted")
            path.chmod(0o600)
            path.write_text(path.read_text().replace("ep-test-pooler", "ep-other-pooler"))
            try:
                load_urls(path)
            except ValueError:
                pass
            else:
                raise AssertionError("unpaired endpoints accepted")
        print("classification/credential safety self-test PASS")
        return 0
    urls = load_urls(Path.home() / ".config/vamotors/dev-neon.env")
    passed = True
    for name, url in zip(("direct", "pooled"), urls):
        if args.transport:
            print(json.dumps({"endpoint": name, "transport": transport(url)}))
        result = query(url)
        print(json.dumps({"endpoint": name, "readonly_select1": result}))
        passed = passed and result == "pass"
    if args.startup_negative_control:
        result = query(urls[1], negative_control=True)
        print(json.dumps({"pooled_startup_negative_control": result}))
        passed = passed and result == "unsupported_startup_parameter"
    return 0 if passed else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({"diagnostic_error_type": type(error).__name__, "details": "suppressed"}))
        sys.exit(1)
