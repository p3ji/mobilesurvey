# Expression Language — Reference

The authoring tool uses one small, safe expression language everywhere you write logic. This page
is the complete reference for what you can write.

## Where you write expressions

| In the Inspector | Field | Meaning of a `true` result |
| --- | --- | --- |
| Question / Section / Page / Roster / Statement | **Visible when** | Show the element |
| Question | **Validation edit → Fires when** | Trigger the edit message (a *violation*) |
| Branch (if/then/else) | **Branch condition** | Render the *then* children (else *else*) |
| Computation | **Expression** | The value stored in the target variable |
| Variable (derived) | **Compute** | The value of the derived variable |
| Roster | **…or loop while** | Keep repeating |

Expression boxes give **live feedback**: a red border and message if it doesn't parse, and a list
of the variables it references when it does.

> **Safety:** the language has **no access to the browser, the network, or any host code** — it can
> only read your variables and call the built-in functions below. A malformed expression never
> crashes the survey; in preview it fails safe.

---

## Values

| Kind | How to write it | Examples |
| --- | --- | --- |
| **Variable reference** | `$` + the variable name | `$age`, `$lfStatus`, `$hhSize` |
| **Number** | digits (optional decimal) | `0`, `15`, `3.5` |
| **String** | single or double quotes | `'emp'`, `"CA"` |
| **Boolean** | `true` / `false` | `true` |
| **Empty** | `null` | `null` |

Inside a **roster**, the loop index variable is available as a number — e.g. `$m` is the current
member number (1, 2, 3, …). A reference walks outward through enclosing rosters, so an inner
question can read an outer answer.

A variable that hasn't been answered reads as **empty**.

---

## Operators

| Group | Operators | Notes |
| --- | --- | --- |
| Arithmetic | `+`  `-`  `*`  `/`  `%` | `+` also concatenates when an operand is a non-numeric string |
| Comparison | `==`  `!=`  `<`  `<=`  `>`  `>=` | `==`/`!=` are type-aware; the rest compare as numbers |
| Logical | `&&`  `\|\|`  `!` | Also spellable as `and` / `or` / `not` |
| Grouping | `( … )` | Parentheses to control precedence |

Precedence (high → low): unary `!`/`-`, then `* / %`, then `+ -`, then comparisons, then `&&`,
then `||`.

```
$age >= 18 && $country == 'CA'
$lfStatus == 'emp' || $lfStatus == 'abs'
!isAnswered($spouseName)
($hoursActual < $hoursUsual)
```

---

## Functions

| Function | Returns |
| --- | --- |
| `isAnswered(x)` | `true` if `x` has a non-empty value |
| `count(x)` | Length of a list, else `1` for a value / `0` for empty |
| `sum(a, b, …)` or `sum(list)` | Numeric sum (non-numbers ignored) |
| `len(x)` | Length of a string or list |
| `contains(haystack, needle)` | `true` if a list includes the value, or a string includes the substring |
| `matches(text, pattern)` | `true` if `text` matches the regular-expression `pattern` |
| `upper(x)` / `lower(x)` | Upper- / lower-cased string |
| `min(a, b, …)` / `max(a, b, …)` | Smallest / largest number |
| `abs(x)` | Absolute value |
| `round(x)` / `floor(x)` / `ceil(x)` | Rounding |

```
isAnswered($email)
contains($searchMethods, 'net')
matches($postalCode, '^[A-Z]\\d[A-Z]')
round($income / 12)
```

Only these functions exist — names are checked, and nothing from the host environment is reachable.

---

## How values are compared & combined (coercion)

The rules are deliberately predictable:

- **Arithmetic and `<  <=  >  >=`** convert operands to numbers. An **empty/unanswered** value
  becomes "not a number", so a comparison against it is **false**. This means a rule like
  `$age > 99` simply doesn't fire until `age` is answered.
- **`==` / `!=`** are type-aware: numbers compare numerically, booleans as booleans, otherwise as
  strings. Empty and `null` are treated as the same "no value".
- **`&&` / `||`** short-circuit and return a boolean. `!` negates truthiness.
- **`+`** adds when both sides are numeric; if either side is a non-numeric string it **joins**
  them as text.

### "Truthiness" (what counts as true)
Empty string, `null`, `0`, and unanswered all count as **false**; other values count as **true**.

---

## Common patterns

```text
# Show only to working-age respondents
$age >= 15

# Page for employed respondents only
$lfStatus == 'emp' || $lfStatus == 'abs'

# Hard edit: out-of-range household size  (fires when invalid)
$hhSize < 1 || $hhSize > 20

# Soft edit: implausibly high hours  (warns, doesn't block)
$hoursUsual > 80

# Consistency check across two answers
$ftPt == 'pt' && $hoursUsual >= 30

# Derived flag
$lfStatus == 'emp' || $lfStatus == 'abs'

# Skip a follow-up unless a multi-response option was chosen
contains($searchMethods, 'agcy')
```

> **Edits fire on the *violation*.** Write the condition that should *complain*, e.g. `$age < 15`
> for "must be 15+", not `$age >= 15`.
