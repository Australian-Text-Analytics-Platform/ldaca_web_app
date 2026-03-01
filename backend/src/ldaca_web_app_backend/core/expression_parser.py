"""Safe translation of user-provided column expressions to Polars expressions.

The Aggregate tab allows analysts to type lightweight expressions such as
``"
A + B
A / (B + 1)
when(A > 0, A, 0)
```
which need to be converted to `polars.Expr` objects on the backend before
being executed.  This module provides a conservative AST-based parser that only
permits a curated subset of Python syntax and maps it to Polars expression
constructs.  Any unsupported syntax raises a `ValueError` with a descriptive
message so the UI can surface actionable feedback.
"""

from __future__ import annotations

import ast
import math
from dataclasses import dataclass
from typing import Any, Callable, Iterable, List, Sequence

import polars as pl

__all__ = [
    "build_polars_expression",
    "ExpressionParseError",
]


class ExpressionParseError(ValueError):
    """Raised when an expression cannot be translated into a Polars expression.

    Used by:
    - aggregate/expression endpoints in `api.workspaces.nodes`

    Why:
    - Allows UI-facing handlers to return clear parse/validation errors.
    """


@dataclass
class _ExprWrapper:
    expr: pl.Expr
    literal_value: Any | None = None

    @property
    def is_literal(self) -> bool:
        return self.literal_value is not None


_ALLOWED_CONSTANTS: dict[str, Any] = {
    "pi": math.pi,
    "e": math.e,
}


def build_polars_expression(expression: str, *, columns: Iterable[str]) -> pl.Expr:
    """Parse *expression* into a Polars expression.

    Args:
        expression: User supplied expression string (evaluated in ``eval`` mode)
        columns: Iterable of valid column names for the active node

    Returns:
        A ``polars.Expr`` ready to be passed to ``with_columns``.

    Raises:
        ExpressionParseError: if the expression contains unsupported syntax or
        references unknown columns/functions.

    Used by:
    - expression preview/apply handlers in `api.workspaces.nodes`

    Why:
    - Restricts user expressions to a safe, curated AST subset.
    """

    expression = expression.strip()
    if not expression:
        raise ExpressionParseError("Expression cannot be empty")

    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as exc:  # pragma: no cover - exercised via integration tests
        raise ExpressionParseError(f"Invalid expression syntax: {exc.msg}") from exc

    builder = _PolarsExpressionBuilder(columns=set(columns))
    try:
        wrapped = builder.visit(tree.body)
    except ExpressionParseError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise ExpressionParseError(str(exc)) from exc

    return wrapped.expr


class _PolarsExpressionBuilder(ast.NodeVisitor):
    """Translate a restricted Python AST into Polars expressions.

    Used by:
    - `build_polars_expression`

    Why:
    - Encapsulates all parsing/validation rules in a single visitor.
    """

    def __init__(self, *, columns: set[str]):
        self._columns = columns

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _wrap(self, expr: pl.Expr, literal: Any | None = None) -> _ExprWrapper:
        return _ExprWrapper(expr=expr, literal_value=literal)

    def _ensure_column_exists(self, name: str) -> None:
        if name not in self._columns:
            raise ExpressionParseError(
                f"Unknown column '{name}'. Available columns: {sorted(self._columns)}"
            )

    def _literal_from_constant(self, value: Any) -> _ExprWrapper:
        return self._wrap(pl.lit(value), value)

    def _handle_string_constant(self, value: str) -> _ExprWrapper:
        if value in self._columns:
            return self._wrap(pl.col(value))
        return self._literal_from_constant(value)

    def _ensure_literal(self, wrapper: _ExprWrapper, *, context: str) -> Any:
        if wrapper.literal_value is None:
            raise ExpressionParseError(f"Expected literal value for {context}")
        return wrapper.literal_value

    def _literal_sequence(self, node: ast.AST, *, context: str) -> Sequence[Any]:
        if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
            values: List[Any] = []
            for element in node.elts:  # type: ignore[attr-defined]
                wrapped = self.visit(element)
                values.append(self._ensure_literal(wrapped, context=context))
            return values
        wrapped = self.visit(node)
        literal = self._ensure_literal(wrapped, context=context)
        if isinstance(literal, (list, tuple, set)):
            return list(literal)
        return [literal]

    def _combine_bool(self, op: ast.boolop, values: list[_ExprWrapper]) -> _ExprWrapper:
        if isinstance(op, ast.And):
            expr = values[0].expr
            for value in values[1:]:
                expr = expr & value.expr
            return self._wrap(expr)
        if isinstance(op, ast.Or):
            expr = values[0].expr
            for value in values[1:]:
                expr = expr | value.expr
            return self._wrap(expr)
        raise ExpressionParseError(f"Unsupported boolean operator: {ast.dump(op)}")

    def _apply_compare(self, operator: ast.cmpop, left: pl.Expr, right: Any) -> pl.Expr:
        if isinstance(operator, ast.Eq):
            return left == right
        if isinstance(operator, ast.NotEq):
            return left != right
        if isinstance(operator, ast.Gt):
            return left > right
        if isinstance(operator, ast.GtE):
            return left >= right
        if isinstance(operator, ast.Lt):
            return left < right
        if isinstance(operator, ast.LtE):
            return left <= right
        if isinstance(operator, ast.In):
            if isinstance(right, pl.Expr):
                return left.is_in(right)
            if isinstance(right, Sequence):
                return left.is_in(list(right))
            raise ExpressionParseError(
                "Right-hand side of 'in' must be a literal list or expression"
            )
        if isinstance(operator, ast.NotIn):
            if isinstance(right, pl.Expr):
                return ~left.is_in(right)
            if isinstance(right, Sequence):
                return ~left.is_in(list(right))
            raise ExpressionParseError(
                "Right-hand side of 'not in' must be a literal list or expression"
            )
        raise ExpressionParseError(
            f"Unsupported comparison operator: {type(operator).__name__}"
        )

    # ------------------------------------------------------------------
    # Node visitors
    # ------------------------------------------------------------------
    def visit_BinOp(self, node: ast.BinOp) -> _ExprWrapper:
        left = self.visit(node.left)
        right = self.visit(node.right)
        op = node.op
        if isinstance(op, ast.Add):
            # When either operand is a string literal, treat + as concatenation
            if (left.is_literal and isinstance(left.literal_value, str)) or (
                right.is_literal and isinstance(right.literal_value, str)
            ):
                return self._wrap(
                    pl.concat_str([
                        left.expr.cast(pl.Utf8, strict=False),
                        right.expr.cast(pl.Utf8, strict=False),
                    ])
                )
            return self._wrap(left.expr + right.expr)
        if isinstance(op, ast.Sub):
            return self._wrap(left.expr - right.expr)
        if isinstance(op, ast.Mult):
            return self._wrap(left.expr * right.expr)
        if isinstance(op, ast.Div):
            return self._wrap(left.expr / right.expr)
        if isinstance(op, ast.FloorDiv):
            return self._wrap(left.expr // right.expr)
        if isinstance(op, ast.Mod):
            return self._wrap(left.expr % right.expr)
        if isinstance(op, ast.Pow):
            return self._wrap(left.expr**right.expr)
        raise ExpressionParseError(f"Unsupported binary operator: {type(op).__name__}")

    def visit_BoolOp(self, node: ast.BoolOp) -> _ExprWrapper:
        if not node.values:
            raise ExpressionParseError(
                "Boolean operations require at least one operand"
            )
        operands = [self.visit(value) for value in node.values]
        return self._combine_bool(node.op, operands)

    def visit_UnaryOp(self, node: ast.UnaryOp) -> _ExprWrapper:
        operand = self.visit(node.operand)
        if isinstance(node.op, ast.USub):
            return self._wrap(-operand.expr)
        if isinstance(node.op, ast.UAdd):
            return self._wrap(+operand.expr)
        if isinstance(node.op, ast.Not):
            return self._wrap(operand.expr.not_())
        raise ExpressionParseError(
            f"Unsupported unary operator: {type(node.op).__name__}"
        )

    def visit_Compare(self, node: ast.Compare) -> _ExprWrapper:
        if len(node.ops) != len(node.comparators):
            raise ExpressionParseError("Malformed comparison expression")
        left_wrapper = self.visit(node.left)
        result_expr: pl.Expr | None = None
        current_left = left_wrapper.expr
        for operator, comparator_node in zip(node.ops, node.comparators):
            if isinstance(operator, (ast.In, ast.NotIn)):
                rhs_values = self._literal_sequence(
                    comparator_node, context="membership comparison"
                )
                compare_expr = self._apply_compare(operator, current_left, rhs_values)
            else:
                right_wrapper = self.visit(comparator_node)
                compare_expr = self._apply_compare(
                    operator, current_left, right_wrapper.expr
                )
                current_left = right_wrapper.expr
            result_expr = (
                compare_expr if result_expr is None else result_expr & compare_expr
            )
        return self._wrap(result_expr if result_expr is not None else current_left)

    def visit_IfExp(self, node: ast.IfExp) -> _ExprWrapper:
        condition = self.visit(node.test)
        body = self.visit(node.body)
        otherwise = self.visit(node.orelse)
        expr = pl.when(condition.expr).then(body.expr).otherwise(otherwise.expr)
        return self._wrap(expr)

    def visit_Call(self, node: ast.Call) -> _ExprWrapper:
        if isinstance(node.func, ast.Attribute):
            raise ExpressionParseError(
                "Attribute access is not permitted in expressions"
            )
        func_name = getattr(node.func, "id", None)
        if not isinstance(func_name, str):
            raise ExpressionParseError("Unsupported callable in expression")
        arg_wrappers = [self.visit(arg) for arg in node.args]

        handlers: dict[str, Callable[[list[_ExprWrapper]], _ExprWrapper]] = {
            "abs": lambda args: self._wrap(args[0].expr.abs()),
            "sqrt": lambda args: self._wrap(args[0].expr.sqrt()),
            "log": self._handle_log,
            "log10": lambda args: self._wrap(args[0].expr.log10()),
            "exp": lambda args: self._wrap(args[0].expr.exp()),
            "sin": lambda args: self._wrap(args[0].expr.sin()),
            "cos": lambda args: self._wrap(args[0].expr.cos()),
            "tan": lambda args: self._wrap(args[0].expr.tan()),
            "floor": lambda args: self._wrap(args[0].expr.floor()),
            "ceil": lambda args: self._wrap(args[0].expr.ceil()),
            "round": self._handle_round,
            "clip": self._handle_clip,
            "min": lambda args: self._wrap(
                pl.min_horizontal([arg.expr for arg in args])
            ),
            "max": lambda args: self._wrap(
                pl.max_horizontal([arg.expr for arg in args])
            ),
            "coalesce": lambda args: self._wrap(
                pl.coalesce([arg.expr for arg in args])
            ),
            "fill_null": self._handle_fill_null,
            "when": self._handle_when,
            "lit": self._handle_lit,
            "col": self._handle_col,
        }

        handler = handlers.get(func_name)
        if handler is None:
            raise ExpressionParseError(
                f"Unsupported function '{func_name}' in expression"
            )
        return handler(arg_wrappers)

    def visit_Name(self, node: ast.Name) -> _ExprWrapper:
        if node.id in _ALLOWED_CONSTANTS:
            return self._literal_from_constant(_ALLOWED_CONSTANTS[node.id])
        self._ensure_column_exists(node.id)
        return self._wrap(pl.col(node.id))

    def visit_Constant(self, node: ast.Constant) -> _ExprWrapper:  # type: ignore[override]
        value = node.value
        if isinstance(value, (int, float, bool)) or value is None:
            return self._literal_from_constant(value)
        if isinstance(value, str):
            return self._handle_string_constant(value)
        raise ExpressionParseError(f"Unsupported literal type: {type(value).__name__}")

    def visit_List(
        self, node: ast.List
    ) -> _ExprWrapper:  # pragma: no cover - handled via _literal_sequence
        values = [
            self._ensure_literal(self.visit(elt), context="list element")
            for elt in node.elts
        ]
        return self._wrap(pl.lit(values), values)

    def visit_Tuple(self, node: ast.Tuple) -> _ExprWrapper:  # pragma: no cover
        return self.visit_List(ast.List(elts=node.elts, ctx=node.ctx))

    def generic_visit(self, node: ast.AST) -> Any:  # pragma: no cover - defensive
        raise ExpressionParseError(f"Unsupported expression element: {ast.dump(node)}")

    # ------------------------------------------------------------------
    # Function handlers
    # ------------------------------------------------------------------
    def _handle_round(self, args: list[_ExprWrapper]) -> _ExprWrapper:
        if not args:
            raise ExpressionParseError("round() requires at least one argument")
        expr = args[0].expr
        decimals = 0
        if len(args) > 1:
            decimals = int(self._ensure_literal(args[1], context="round decimals"))
        return self._wrap(expr.round(decimals))

    def _handle_clip(self, args: list[_ExprWrapper]) -> _ExprWrapper:
        if len(args) != 3:
            raise ExpressionParseError(
                "clip() expects exactly three arguments: value, min, max"
            )
        min_value = self._ensure_literal(args[1], context="clip min")
        max_value = self._ensure_literal(args[2], context="clip max")
        return self._wrap(args[0].expr.clip(min_value, max_value))

    def _handle_fill_null(self, args: list[_ExprWrapper]) -> _ExprWrapper:
        if len(args) != 2:
            raise ExpressionParseError("fill_null() expects two arguments")
        return self._wrap(args[0].expr.fill_null(args[1].expr))

    def _handle_when(self, args: list[_ExprWrapper]) -> _ExprWrapper:
        if len(args) != 3:
            raise ExpressionParseError(
                "when() expects three arguments: condition, then, otherwise"
            )
        return self._wrap(
            pl.when(args[0].expr).then(args[1].expr).otherwise(args[2].expr)
        )

    def _handle_log(self, args: list[_ExprWrapper]) -> _ExprWrapper:
        if not args:
            raise ExpressionParseError("log() requires at least one argument")
        expr = args[0].expr
        if len(args) == 1:
            return self._wrap(expr.log())
        base = self._ensure_literal(args[1], context="log base")
        if not isinstance(base, (int, float)) or base <= 0:
            raise ExpressionParseError("log base must be a positive number")
        return self._wrap(expr.log(base))

    def _handle_lit(self, args: list[_ExprWrapper]) -> _ExprWrapper:
        if len(args) != 1:
            raise ExpressionParseError("lit() expects a single argument")
        literal = self._ensure_literal(args[0], context="literal value")
        return self._wrap(pl.lit(literal), literal)

    def _handle_col(self, args: list[_ExprWrapper]) -> _ExprWrapper:
        if len(args) != 1:
            raise ExpressionParseError("col() expects a single argument")
        literal = self._ensure_literal(args[0], context="column name")
        if not isinstance(literal, str):
            raise ExpressionParseError("Column name must be a string")
        self._ensure_column_exists(literal)
        return self._wrap(pl.col(literal))


# The visitor inherits NodeVisitor, so pylint/flake8 will warn about missing return
# statements unless they see explicit returns. We rely on raising ExpressionParseError
# for unsupported nodes, which is intentional.
