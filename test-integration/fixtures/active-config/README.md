<!-- Copyright 2026 The MathWorks, Inc. -->

# Active configuration fixtures

Copied from data-explorer-core's `test/fixtures/active-config`, where
`test/parity/matlab/gen_active_config.m` writes them (R2027a), for
`test-integration/suite/modelActiveConfig.test.ts`:

| File | What it holds |
|---|---|
| `acs_sets.slx` | three configuration sets, Configuration (active), Fast and Slow |
| `acs_ref.slx` | Configuration (active) and RefFromDict, a `Simulink.ConfigSetRef` into `acs_dict.sldd` (not copied) |
