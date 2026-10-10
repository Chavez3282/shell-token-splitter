# Shell Token Splitter

Splits a shell command string into argument tokens following POSIX quoting and escape rules.

```js
import { tokenize, tokenizeStrict } from 'shell-token-splitter';

tokenize('ls -l "my dir"');        // ['ls', '-l', 'my dir']
tokenizeStrict("echo 'ok'");       // ['echo', 'ok'] — throws on malformed input
```

## Why

Every shell wraps argument parsing in quoting rules that are easy to get almost
right. This library implements the POSIX subset that bash, dash, zsh, and
busybox ash agree on: backslash escapes, single quotes with no escapes, double
quotes with backslash-escaping for `"`, `\\`, `$`, <code>`</code>, and newline,
and adjacent-run concatenation (`abc"def"'ghi'` → `abcdefghi`).

The deliberate trade-off: we do **not** expand `$variables` or `\`command\``.
That requires an execution environment and a notion of shell state, which is a
different problem. A `$` or backtick inside double quotes is kept as a literal
byte.

## The awkward edge

Inside double quotes, a backslash before a byte that is **not** one of `" \\ $ \` newline`
is **preserved as a literal backslash** (POSIX). So `"a\\nb"` becomes `a\\nb`,
not `anb`. Many splitters get this wrong by stripping the backslash. If you
need C-style `\\n` translation, do it after tokenizing — that is not the shell's
job.
