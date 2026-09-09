"""Environment configuration for the local WhisperX worker."""

import os


def load():
    accelerator = os.getenv("ALDUS_ALIGNMENT_ACCELERATOR", "cpu")
    if accelerator not in ("cpu", "cuda"):
        raise ValueError("ALDUS_ALIGNMENT_ACCELERATOR must be cpu or cuda")
    compute_type = "float16" if accelerator == "cuda" else "int8"
    try:
        batch_size = int(os.getenv("ALDUS_ALIGNMENT_BATCH_SIZE", "4"))
    except ValueError as error:
        raise ValueError("ALDUS_ALIGNMENT_BATCH_SIZE must be a positive integer") from error
    if batch_size <= 0:
        raise ValueError("ALDUS_ALIGNMENT_BATCH_SIZE must be a positive integer")
    return accelerator, compute_type, batch_size


def gpu_settings(supported, memory_bytes, batch_size):
    """Choose a supported precision and a conservative batch for small GPUs."""
    compute_type = next(
        (value for value in ("float16", "int8_float32", "float32") if value in supported),
        None,
    )
    if compute_type is None:
        raise ValueError("GPU has no supported alignment compute mode")
    if "ALDUS_ALIGNMENT_BATCH_SIZE" not in os.environ and memory_bytes <= 4 * 1024**3:
        batch_size = 1
    return compute_type, batch_size
