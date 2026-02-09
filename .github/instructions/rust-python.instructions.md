---
description: 'Best practices for Rust-Python mixed programming using PyO3 and Maturin. Covers interoperability, performance, error handling, and project structure.'
applyTo: '**/*.rs, **/*.py, **/Cargo.toml, **/pyproject.toml'
---

# Rust-Python Mixed Programming Instructions

This guide provides best practices for integrating Rust and Python using **PyO3** and **Maturin**. It is designed to help you build high-performance Python extensions with Rust safety.

## General Principles

- **Use PyO3 for Bindings:** PyO3 is the standard crate for writing native Python modules in Rust.
- **Use Maturin for Build/Publish:** Maturin is the recommended build tool and publisher for Rust-based Python packages.
- **Minimize the Boundary Crossing:** distinct between "Rust-land" and "Python-land". Crossing the FFI boundary has overhead; batch operations in Rust where possible.
- **Release the GIL:** For CPU-intensive tasks, release the Global Interpreter Lock (GIL) to allow parallelism in Python threads.
- **Use the `Bounded` API:** For PyO3 >= 0.21, prefer the `Bound<'py, T>` API over the older GIL-ref API for better safety and performance.

## Project Structure

A typical mixed project structure (hybrid):

```
my-project/
├── Cargo.toml          # Rust dependencies
├── pyproject.toml      # Python build configuration (maturin)
├── src/
│   └── lib.rs          # Rust entry point (#[pymodule])
├── python/
│   └── my_project/     # Python stub files (.pyi) and auxiliary Python code
│       ├── __init__.py
│       └── ...
└── tests/              # Rust tests
```

- **Cargo.toml**: Must include `pyo3` with the `extension-module` feature.
- **pyproject.toml**: Must specify `build-backend = "maturin"`.

## PyO3 Best Practices

### defining Classes and Functions

- **Classes:** Use `#[pyclass]` on strict Rust structs.
  - Implement methods in a `#[pymethods]` impl block.
  - Use `#[new]` for the `__init__` constructor.
  - Use `#[getter]` and `#[setter]` for properties.
- **Functions:** Use `#[pyfunction]` for module-level functions.
- **Modules:** Use `#[pymodule]` to define the entry point.

```rust
use pyo3::prelude::*;

#[pyclass]
struct MyClass {
    inner: i32,
}

#[pymethods]
impl MyClass {
    #[new]
    fn new(value: i32) -> Self {
        MyClass { inner: value }
    }

    fn double(&self) -> i32 {
        self.inner * 2
    }
}

#[pymodule]
fn my_module(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<MyClass>()?;
    Ok(())
}
```

### Type Conversions

- **Automatic Conversion:** PyO3 automatically converts simple types (integers, strings, floats, `Vec`, `HashMap`, `Option`).
- **Custom Types:** Implement `FromPyObject` (extract from Python) and `ToPyObject` (convert to Python) traits if needed, or stick to `#[pyclass]`.
- **Avoid Excessive Cloning:** When receiving large data (e.g., strings, bytes), try to use references (e.g., `&str`, `&[u8]`) to avoid copying, but be aware of lifetimes.

### Error Handling

- **Return `PyResult<T>`:** Rust functions exposed to Python should return `PyResult<T>`.
- **Map Errors:** Convert internal Rust errors to Python exceptions using `.map_err()`.
- **Common Exceptions:** Use `PyValueError`, `PyTypeError`, `PyRuntimeError` from `pyo3::exceptions`.

```rust
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

#[pyfunction]
fn divide(a: i32, b: i32) -> PyResult<f64> {
    if b == 0 {
        return Err(PyValueError::new_err("division by zero"));
    }
    Ok(a as f64 / b as f64)
}
```

### Concurrency and the GIL

- **`Python::allow_threads`:** wrap CPU-bound long-running Rust code in `Python::allow_threads` to release the GIL, enabling other Python threads to run.

```rust
#[pyfunction]
fn heavy_computation(py: Python<'_>, data: Vec<i32>) -> usize {
    py.allow_threads(|| {
        // Expensive work here that doesn't touch Python objects
        data.iter().sum::<i32>() as usize
    })
}
```

- **Async/Await:** interacting with Python `asyncio` requires the `pyo3-asyncio` crate (or `pyo3` v0.21+ built-in support if available/stable). Usually involves converting a Rust Future into a Python Awaitable.

## Memory Management

- **Lifetimes:** Python objects behave like shared references. Rust's borrow checker ensures you don't keep references to Python objects invalidly.
- **Circular References:** Rust types in `#[pyclass]` that hold standard Python references (`Py<T>`) can cause leaks. Use PyO3's Garbage Collector integration (`#[pyclass(gc)]`) if you need to participate in Python's cycle detection.

## Testing

- **Rust Tests:** Write standard `#[test]` unit tests for logic that *doesn't* require the Python interpreter.
- **Python Tests:** Use `pytest` to test the compiled extension module.
- **Mixed Tests:** If you need the Python runtime in Rust tests, `pyo3` provides utilities, but often it's easier to test the binding layer from Python.

## Common Pitfalls

- **Panic = Abort:** A Rust panic through the FFI boundary usually aborts the process. Always catch unwinds or use `Result` to return errors.
- **Deadlocks:** be careful when re-acquiring the GIL inside `allow_threads` or using Rust mutexes alongside the GIL.
- **Mutable Aliasing:** Python allows multiple references to the same object. Rust forbids multiple `&mut`. PyO3 enforces runtime checking (`RefCell`-like) for `&mut self` in `#[pymethods]`. `BorrowError` raises `RuntimeError` in Python.

## Resources

- [PyO3 User Guide](https://pyo3.rs/)
- [Maturin Documentation](https://www.maturin.rs/)
- [PyO3 API Docs](https://docs.rs/pyo3/)
