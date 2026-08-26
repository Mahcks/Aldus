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
