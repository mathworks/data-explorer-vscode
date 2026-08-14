#!/bin/sh
# Leak scan for the public tree. MUST print nothing and exit 1 (no matches) before
# any commit. Covers the standard internal identifiers PLUS the sandbox/job-archive
# paths and the MATLAB launcher used only in this dev environment.
#
# Scans ONLY files git would commit (tracked + untracked-but-not-ignored), so the
# deliberately local-only files (CLAUDE.md, docs/deep-work/, probe out/) don't
# raise false positives. Run from anywhere in the repo.
cd "$(git rev-parse --show-toplevel)" || exit 2
# shellcheck disable=SC2016
# Patterns assembled from fragments so this script never matches itself.
P1="inside""labs"; P2="ip""ws"; P3="mw-npm-""repository"; P4="git""lab"
P5="data-explorer""-ts"; P6="mathworks""/devel"; P7="job""archive"; P8=".z""fs"
P9="sbs""/78"; P10="weiwang.""dexp3"; P11="netbin""/mw"
git ls-files --cached --others --exclude-standard -z \
  | grep -zv 'test/parity/fidelity/leakcheck.sh' \
  | xargs -0 grep -In \
      -e "$P1" -e "$P2" -e "$P3" -e "$P4" -e "$P5" -e "$P6" \
      -e "$P7" -e "$P8" -e "$P9" -e "$P10" -e "$P11"
status=$?
if [ $status -eq 0 ]; then
  echo "LEAK CHECK FAILED — matches above must be removed before commit."
  exit 1
fi
echo "leak check clean"
exit 0
