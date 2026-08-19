#!/usr/bin/env python3
"""Round-trip check for the chunked upload path.

The browser slices a file into sub-50MB parts (Supabase free-tier cap) and
api/py/verification.py concatenates them back. The one thing that must never
break is that the rebuilt bytes are identical to the original — so this slices
a real oversized verif, feeds the parts through the *actual* `_download_urls`,
and compares hashes before proving the result still opens as an xlsx.

    python3 verification/test_chunk_roundtrip.py
"""
import hashlib
import pathlib
import sys
import tempfile

_ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / "api" / "py"))
sys.path.insert(0, str(_ROOT / "app" / "verification"))
sys.path.insert(0, str(_ROOT / "app" / "verification" / "parsers"))

from verification import _download_urls  # noqa: E402  (needs sys.path above)
from parsers.parser_utils import load_workbook_fast  # noqa: E402

# Mirrors UPLOAD_CHUNK in components/VerificationContainer.tsx.
CHUNK = 40 * 1024 * 1024
SAMPLE = _ROOT / "verification/DGbrasil/Junho/Verification/VERIFICATION_Alright_parte1.xlsx"


def sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main() -> int:
    if not SAMPLE.exists():
        print(f"SKIP: fixture ausente ({SAMPLE.name})")
        return 0

    size = SAMPLE.stat().st_size
    assert size > CHUNK, f"fixture precisa passar de {CHUNK} bytes para exercitar o split"

    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)

        # Split exactly as `file.slice(i * CHUNK, (i + 1) * CHUNK)` does.
        part_urls = []
        with open(SAMPLE, "rb") as src:
            i = 0
            while chunk := src.read(CHUNK):
                part = tmp / f"part{i}"
                part.write_bytes(chunk)
                part_urls.append(part.as_uri())  # file:// — urlopen handles it
                i += 1
        assert len(part_urls) > 1, "split produziu uma parte só"
        assert all(p.stat().st_size <= CHUNK for p in tmp.glob("part*")), "parte acima do cap"

        rebuilt = tmp / "rebuilt.xlsx"
        _download_urls(part_urls, str(rebuilt))

        assert rebuilt.stat().st_size == size, f"tamanho {rebuilt.stat().st_size} != {size}"
        assert sha256(rebuilt) == sha256(SAMPLE), "bytes remontados divergem do original"

        # Bytes matching is necessary but not sufficient — prove it still parses.
        wb = load_workbook_fast(str(rebuilt))
        assert wb.worksheets, "workbook remontado sem abas"

        print(f"OK  {SAMPLE.name}: {size:,}B → {len(part_urls)} partes → sha256 idêntico, "
              f"{len(wb.worksheets)} aba(s) legível(is)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
