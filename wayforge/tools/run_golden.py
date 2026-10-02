#!/usr/bin/env python3
"""
\\file run_golden.py
\\brief Convert every plan that has a golden file and compare the result

Usage:
    python tools/run_golden.py <path/to/wf_cli> [--tol 0.01]

For each data/golden/<name>.wfb there must be a plan data/plans/<name>.<svg|png|jpg>.
It runs  wf_cli convert <plan> <out.wfb>  and then compare_golden.py on the result.

Exit codes:
    0  every golden file matched (or there is nothing to check yet)
    1  at least one conversion failed or did not match its golden file
    2  bad usage or missing wf_cli

Links: called by the "Golden-file tests" step of the desktop CI job
(.github/workflows/build.yml) with the wf_cli that job just built.
Uses compare_golden.py (same folder) for each comparison.

\\author Joel Chua (c.jialiang@digipen.edu)

Contribution: Joel Chua 100%
  - Pairs each golden file with its source plan by file name
  - Skips cleanly while wf_cli has no `convert` command yet, so CI stays green

AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.

\\date 2026-09-15
\\copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
"""

import argparse     # Command-line parsing (cli path, --tol).
import glob         # Finding every data/golden/*.wfb.
import os           # Path building and file checks.
import subprocess   # Running wf_cli and compare_golden.py.
import sys          # Exit codes and the current Python interpreter.
import tempfile     # Converted files go in a temp folder that is deleted afterwards.

# Paths are worked out from this file's location, so the script works from any current directory.
HERE = os.path.dirname(os.path.abspath(__file__))   # wayforge/tools
ROOT = os.path.dirname(HERE)                        # wayforge
GOLDEN_DIR = os.path.join(ROOT, "data", "golden")   # expected outputs
PLANS_DIR = os.path.join(ROOT, "data", "plans")     # input floor plans
PLAN_EXTS = (".svg", ".png", ".jpg", ".jpeg")       # plan formats wf_cli can convert


def find_plan(name):
    """Return the path of data/plans/<name> with any supported extension, or None."""
    for ext in PLAN_EXTS:
        path = os.path.join(PLANS_DIR, name + ext)
        if os.path.isfile(path):
            return path
    return None


def cli_supports_convert(cli):
    """True if this wf_cli build knows the `convert` command."""
    # Until IMGD1 lands `convert`, wf_cli prints usage and exits 2 for unknown commands.
    p = subprocess.run([cli, "convert"], capture_output=True, text=True)
    return "convert" in (p.stdout + p.stderr)


def main():
    """Run every golden-file test and return the exit code."""
    parser = argparse.ArgumentParser(description="Run all golden-file tests.")
    parser.add_argument("cli", help="path to the wf_cli executable")
    # Kept as a string because it is passed straight through to compare_golden.py.
    parser.add_argument("--tol", default="0.01", help="float tolerance passed to compare_golden.py")
    args = parser.parse_args()

    if not os.path.isfile(args.cli):
        print(f"error: {args.cli}: wf_cli not found", file=sys.stderr)
        return 2

    # Sorted so the output order is the same on every machine.
    goldens = sorted(glob.glob(os.path.join(GOLDEN_DIR, "*.wfb")))
    if not goldens:
        # No golden files yet is not a failure, so CI passes until the first one is added.
        print("no golden files in data/golden/ yet - nothing to check")
        return 0

    if not cli_supports_convert(args.cli):
        print("wf_cli has no `convert` command yet - skipping golden tests")
        return 0

    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        for golden in goldens:
            # data/golden/building_a.wfb -> "building_a"
            name = os.path.splitext(os.path.basename(golden))[0]
            plan = find_plan(name)
            if plan is None:
                print(f"FAIL {name}: no plan data/plans/{name}.<svg|png|jpg> for this golden file")
                failures += 1
                continue

            # Step 1: convert the plan into a fresh .wfb in the temp folder.
            out = os.path.join(tmp, name + ".wfb")
            conv = subprocess.run([args.cli, "convert", plan, out], capture_output=True, text=True)
            if conv.returncode != 0:
                # Show wf_cli's own output so the reason for the failure is in the CI log.
                print(f"FAIL {name}: wf_cli convert exited {conv.returncode}\n{conv.stdout}{conv.stderr}")
                failures += 1
                continue

            # Step 2: compare it with the golden file. sys.executable runs the same
            # Python as this script; compare_golden.py prints its own OK/MISMATCH line.
            cmp = subprocess.run([sys.executable, os.path.join(HERE, "compare_golden.py"),
                                  out, golden, "--tol", args.tol])
            if cmp.returncode != 0:
                failures += 1

    print(f"{len(goldens) - failures}/{len(goldens)} golden tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
