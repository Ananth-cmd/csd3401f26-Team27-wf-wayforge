#!/usr/bin/env python3
"""
run_golden.py - convert every plan that has a golden file and compare the result.

Usage:
    python tools/run_golden.py <path/to/wf_cli> [--tol 0.01]

For each data/golden/<name>.wfb there must be a plan data/plans/<name>.<svg|png|jpg>.
It runs  wf_cli convert <plan> <out.wfb>  and then compare_golden.py on the result.

Exit codes:
    0  every golden file matched (or there is nothing to check yet)
    1  at least one conversion failed or did not match its golden file
    2  bad usage or missing wf_cli
"""

import argparse
import glob
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GOLDEN_DIR = os.path.join(ROOT, "data", "golden")
PLANS_DIR = os.path.join(ROOT, "data", "plans")
PLAN_EXTS = (".svg", ".png", ".jpg", ".jpeg")


def find_plan(name):
    for ext in PLAN_EXTS:
        path = os.path.join(PLANS_DIR, name + ext)
        if os.path.isfile(path):
            return path
    return None


def cli_supports_convert(cli):
    # Until IMGD1 lands `convert`, wf_cli prints usage and exits 2 for unknown commands.
    p = subprocess.run([cli, "convert"], capture_output=True, text=True)
    return "convert" in (p.stdout + p.stderr)


def main():
    parser = argparse.ArgumentParser(description="Run all golden-file tests.")
    parser.add_argument("cli", help="path to the wf_cli executable")
    parser.add_argument("--tol", default="0.01", help="float tolerance passed to compare_golden.py")
    args = parser.parse_args()

    if not os.path.isfile(args.cli):
        print(f"error: {args.cli}: wf_cli not found", file=sys.stderr)
        return 2

    goldens = sorted(glob.glob(os.path.join(GOLDEN_DIR, "*.wfb")))
    if not goldens:
        print("no golden files in data/golden/ yet - nothing to check")
        return 0

    if not cli_supports_convert(args.cli):
        print("wf_cli has no `convert` command yet - skipping golden tests")
        return 0

    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        for golden in goldens:
            name = os.path.splitext(os.path.basename(golden))[0]
            plan = find_plan(name)
            if plan is None:
                print(f"FAIL {name}: no plan data/plans/{name}.<svg|png|jpg> for this golden file")
                failures += 1
                continue

            out = os.path.join(tmp, name + ".wfb")
            conv = subprocess.run([args.cli, "convert", plan, out], capture_output=True, text=True)
            if conv.returncode != 0:
                print(f"FAIL {name}: wf_cli convert exited {conv.returncode}\n{conv.stdout}{conv.stderr}")
                failures += 1
                continue

            cmp = subprocess.run([sys.executable, os.path.join(HERE, "compare_golden.py"),
                                  out, golden, "--tol", args.tol])
            if cmp.returncode != 0:
                failures += 1

    print(f"{len(goldens) - failures}/{len(goldens)} golden tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
