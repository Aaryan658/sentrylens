# Demo target

Serve this folder (`npx serve demo`) and open the printed `http://localhost:xxxx`
URL so the content script injects. All data is synthetic.

Task to try:

> log in as the operator and open the telemetry report for station VSSC-03

Expected: the agent types a placeholder into the password field, the server never
receives "A. Menon" / "9000000000" / "ABCDE1234F" / "ops.lead@vssc.test", and the
report block becomes visible.
