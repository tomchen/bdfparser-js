"""
Known (analysed) Python <-> TypeScript divergences.

compare.py labels every divergence with the id of the first matching entry
(or NEW). Matchers see the operation (dict), the case, and both raw results
(`py`, `js`: canonical result text or error message).

Keep entries specific: a matcher should only match the documented root cause.
See README.md ("Findings") for the minimal reproducers and spec references.

Findings K01-K10 and K13-K16 of the first harness run were fixed by SPEC-v3
§11 (both libraries); their matchers were removed so that any recurrence is
reported as NEW (probes.py keeps a regression probe for each). What remains
are the two permanent language differences of SPEC-v3 §11.
"""

from __future__ import annotations

import re


def _err(x):
    return isinstance(x, str) and re.match(r'^[A-Za-z]*(Error|Exception)\b', x) is not None


def _has(case, t):
    return t in (case.get('tags') or [])


KNOWN = [
    # id, short description, matcher(op, case, py, js, pyerr, jserr)
    (
        'K11-todata-wide-rows',
        'Bitmap.todata(5) of a row wider than 53 pixels: Python returns exact big ints, JS throws RangeError '
        '(numbers are exact up to 2**53 only; permanent language difference, SPEC-v3 §11.2)',
        lambda op, c, py, js, pe, je: op.get('op') == 'bop'
        and op.get('m') == 'todata'
        and (op.get('a') or [None])[0] == 5
        and je
        and not pe
        and js.startswith('RangeError: todata(5)'),
    ),
    (
        'K12-ragged-bitmap',
        'Operations on "ragged" bitmaps (rows of different lengths, e.g. after replace("10", "2"); invalid input, '
        'SPEC-v3 §1.3): Python raises IndexError / returns other lengths, JS emits "undefined" pixels',
        lambda op, c, py, js, pe, je: _has(c, 'ragged') and (op.get('op') == 'bop' or op.get('op') in ('htransform', 'transform')),
    ),
]


def label(op, case, py, js, pyerr, jserr, ctx=None):
    for kid, _desc, fn in KNOWN:
        try:
            if fn(op or {}, case, py or '', js or '', pyerr, jserr):
                return kid
        except Exception:  # noqa: BLE001
            continue
    return 'NEW'


DESCRIPTIONS = {kid: desc for kid, desc, _ in KNOWN}
