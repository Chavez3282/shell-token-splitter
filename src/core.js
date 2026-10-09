/**
 * Shell Token Splitter core.
 *
 * POSIX shell tokenization, restricted to a portable subset that is
 * well-defined across modern shells (bash, dash, zsh, busybox ash).
 *
 * Scope decision (stated plainly so callers know exactly what they get):
 *
 *   1. Backslash   — escapes the next byte. Outside quotes it is removed and
 *                    the following byte becomes literal. Inside double quotes
 *                    it only acts as an escape for ", \\, $, `, and newline
 *                    (the POSIX "dollar-quote" subset). Inside single quotes
 *                    it is literally a backslash (single quotes have no escape).
 *   2. Single      — preserves every byte literally until the closing '. No
 *                    escape, not even \\'.
 *   3. Double      — preserves bytes literally except ", \\, $, ` which retain
 *                    special meaning. We strip the quotes but do NOT expand
 *                    $variables or `command` — those need an execution
 *                    environment, which is out of scope. A $ or ` inside double
 *                    quotes is kept as a literal byte.
 *   4. Unquoted    — runs of unescaped whitespace separate tokens.
 *   5. Concat      — adjacent quoted/unquoted runs concatenate into one token:
 *                      abc"def"'ghi'  ->  abcdefghi
 *   6. Newlines    — treated as whitespace separators, like space and tab.
 *
 * The single deliberate ambiguity we resolve: inside double quotes, backslash
 * before a byte that is NOT special is PRESERVED as a literal backslash (POSIX
 * says backslash is only special before certain bytes). Other libraries strip
 * it unconditionally; we follow POSIX.
 */

// Whitespace bytes that separate tokens when unquoted.
// POSIX IFS default is space/tab/newline; we hard-code that rather than accept
// an arbitrary IFS, because modelling real IFS would require a stateful shell
// environment and that is explicitly out of scope.
const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v']);

// Inside double quotes, backslash only acts as an escape before these bytes.
// Before anything else it is a literal backslash. This is the POSIX rule and
// the one place naive splitters diverge.
const DOUBLE_SPECIAL = new Set(['"', '\\', '$', '`']);

/**
 * Internal state machine accumulator. We keep the current token as an array of
 * byte strings and join once at the end — V8 optimises array push/join far
 * better than repeated string concatenation for long inputs.
 *
 * @typedef {Object} State
 * @property {string[]} buf    - bytes accumulated for the current token.
 * @property {boolean}  active - whether the current token has received any
 *                               bytes (or is inside an open quote). Distinguishes
 *                               an empty token "" from the absence of a token.
 * @property {boolean}  err    - set true on a malformed (unterminated) quote.
 */

/**
 * Flush the current token into the results, if any.
 *
 * @param {State} s
 * @param {string[]} out
 */
function flush(s, out) {
  if (s.active) {
    out.push(s.buf.join(''));
    s.buf.length = 0;
    s.active = false;
  }
}

/**
 * Tokenize a shell command string.
 *
 * @param {string} input
 * @returns {string[]} tokens
 */
export function tokenize(input) {
  if (typeof input !== 'string') {
    throw new TypeError('input must be a string');
  }

  const out = [];
  /** @type {State} */
  const s = { buf: [], active: false, err: false };

  let i = 0;
  const n = input.length;

  while (i < n) {
    const c = input[i];

    if (WHITESPACE.has(c)) {
      // Outside quotes, whitespace ends the current token (if any).
      flush(s, out);
      i++;
      continue;
    }

    if (c === "'") {
      // Single quotes: no escape, every byte is literal until the next '.
      s.active = true;
      i++;
      while (i < n && input[i] !== "'") {
        s.buf.push(input[i]);
        i++;
      }
      if (i >= n) {
        // Unterminated single quote — POSIX leaves this undefined across
        // shells. We treat the rest of the input as part of the token so the
        // caller gets something usable rather than silently dropping bytes.
        s.err = true;
        break;
      }
      i++; // consume closing '
      continue;
    }

    if (c === '"') {
      s.active = true;
      i++;
      while (i < n && input[i] !== '"') {
        const d = input[i];
        if (d === '\\') {
          const nxt = i + 1 < n ? input[i + 1] : '';
          // Backslash is an escape only before special bytes or newline.
          // Before anything else it is a literal backslash (POSIX).
          if (DOUBLE_SPECIAL.has(nxt)) {
            s.buf.push(nxt);
            i += 2;
          } else if (nxt === '\n') {
            // Line continuation inside double quotes: drop the backslash
            // and the newline.
            i += 2;
          } else {
            // Literal backslash, keep it and move on one byte.
            s.buf.push('\\');
            i++;
          }
        } else {
          s.buf.push(d);
          i++;
        }
      }
      if (i >= n) {
        s.err = true;
        break;
      }
      i++; // consume closing "
      continue;
    }

    if (c === '\\') {
      s.active = true;
      const nxt = i + 1 < n ? input[i + 1] : '';
      if (nxt === '\n') {
        // Line continuation outside quotes: drop backslash + newline.
        i += 2;
      } else if (nxt === '') {
        // Trailing backslash with no byte to escape. POSIX undefined; we
        // drop it to avoid emitting a token that looks intentional.
        i++;
      } else {
        // Escaped byte becomes literal.
        s.buf.push(nxt);
        i += 2;
      }
      continue;
    }

    // Ordinary byte.
    s.active = true;
    s.buf.push(c);
    i++;
  }

  flush(s, out);
  return out;
}

/**
 * Strict variant: throws on unterminated quotes instead of silently returning
 * a best-effort token list. Use this when malformed input is a programmer
 * error rather than user input.
 *
 * @param {string} input
 * @returns {string[]}
 * @throws {SyntaxError} if a quote is left open
 */
export function tokenizeStrict(input) {
  const tokens = tokenize(input);
  // We re-scan for unterminated quotes rather than instrumenting tokenize()
  // with a throw path, because keeping the hot loop branch-free matters and
  // strict callers accept the cost of a second pass.
  if (hasUnterminatedQuote(input)) {
    throw new SyntaxError('unterminated quote in shell input');
  }
  return tokens;
}

/**
 * Detect an unterminated single or double quote, honouring backslash escapes
 * outside quotes. Returns true if any quote is left open.
 *
 * @param {string} input
 * @returns {boolean}
 */
function hasUnterminatedQuote(input) {
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    if (c === '\\') {
      i += 2; // skip the escaped byte (or the backslash itself if at EOF)
      continue;
    }
    if (c === "'" || c === '"') {
      const close = c;
      i++;
      let closed = false;
      while (i < n) {
        if (input[i] === '\\' && c === '"') {
          // In double quotes backslash may escape the closing quote; skip
          // the next byte so a \" doesn't terminate the string.
          i += 2;
          continue;
        }
        if (input[i] === close) {
          closed = true;
          i++;
          break;
        }
        i++;
      }
      if (!closed) return true;
      continue;
    }
    i++;
  }
  return false;
}
