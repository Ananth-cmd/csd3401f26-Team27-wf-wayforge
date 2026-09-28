# tools

| Script | What it does |
|---|---|
| `compare_golden.py <actual.wfb> <expected.wfb> [--tol 0.01] [--update]` | Compares two `.wfb` files by geometry (ids are ignored). Exit 0 match, 1 mismatch, 2 bad input. |
| `run_golden.py <wf_cli>` | For every `data/golden/<name>.wfb`, runs `wf_cli convert data/plans/<name>.* out.wfb` and compares. Skips until `wf_cli convert` exists. |

Both run in CI (`.github/workflows/build.yml` at the repo root).
