import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tokenize, tokenizeStrict } from '../src/index.js';

test('simple space-separated args', () => {
  assert.deepEqual(tokenize('ls -l /tmp'), ['ls', '-l', '/tmp']);
});

test('collapses runs of whitespace', () => {
  assert.deepEqual(tokenize('  ls   -l  '), ['ls', '-l']);
});

test('empty string yields no tokens', () => {
  assert.deepEqual(tokenize(''), []);
});

test('whitespace-only string yields no tokens', () => {
  assert.deepEqual(tokenize('   \t\n  '), []);
});

test('single quotes preserve everything literally', () => {
  assert.deepEqual(tokenize("echo 'a b\"\"c'"), ['echo', 'a b""c']);
});

test('empty single quotes produce an empty token', () => {
  assert.deepEqual(tokenize("echo ''"), ['echo', '']);
});

test('double quotes preserve whitespace but drop the quotes', () => {
  assert.deepEqual(tokenize('echo "a b"'), ['echo', 'a b']);
});

test('backslash escapes a space outside quotes', () => {
  assert.deepEqual(tokenize('echo a\\ b'), ['echo', 'a b']);
});

test('backslash before a special byte inside double quotes is removed', () => {
  assert.deepEqual(tokenize('echo "a\\"b"'), ['echo', 'a"b']);
});

test('backslash before a non-special byte inside double quotes is preserved (POSIX)', () => {
  // POSIX: backslash is only special before ", \\, $, `, newline. Before 'n'
  // it is a literal backslash, NOT an escape sequence.
  assert.deepEqual(tokenize('echo "a\\nb"'), ['echo', 'a\\nb']);
});

test('adjacent quoted and unquoted runs concatenate', () => {
  assert.deepEqual(tokenize(`abc'def'"ghi"`), ['abcdefghi']);
});

test('backslash-newline is a line continuation outside quotes', () => {
  assert.deepEqual(tokenize('echo a\\\nb'), ['echo', 'ab']);
});

test('tokenizeStrict throws on unterminated single quote', () => {
  assert.throws(() => tokenizeStrict("echo 'unterminated"), SyntaxError);
});

test('tokenizeStrict throws on unterminated double quote', () => {
  assert.throws(() => tokenizeStrict('echo "unterminated'), SyntaxError);
});

test('tokenizeStrict accepts well-formed input', () => {
  assert.deepEqual(tokenizeStrict('ls -l'), ['ls', '-l']);
});

test('non-string input throws TypeError', () => {
  assert.throws(() => tokenize(42), TypeError);
});

test('tabs and newlines are separators', () => {
  assert.deepEqual(tokenize('a\tb\nc'), ['a', 'b', 'c']);
});
