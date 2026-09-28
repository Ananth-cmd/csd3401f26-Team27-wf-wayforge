

Known-good `.wfb` outputs. `data/golden/<name>.wfb` is the expected result of converting
`data/plans/<name>.svg|png|jpg`; CI checks every one with `tools/run_golden.py`.

To add or refresh one after a deliberate change to the converter:
```
wf_cli convert data/plans/simple.svg out.wfb
python tools/compare_golden.py out.wfb data/golden/simple.wfb --update
```
