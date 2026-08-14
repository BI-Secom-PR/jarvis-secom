#!/usr/bin/env python3
"""End-to-end do caminho novo de storage: sobe um triad real pro Supabase,
monta o body que a rota /run manda, e chama _run_engine — exercitando o
_materialize (download por signed URL + nome explícito) contra o engine real.

Compara o resultado com um run direto do engine sobre os mesmos arquivos locais.
Se os dois divergirem, o caminho de storage corrompeu ou renomeou algo.

Uso:  bun --env-file=.env.local scripts/mint-urls.ts | python3 scripts/test-storage-roundtrip.py
      (ou simplesmente:  python3 scripts/test-storage-roundtrip.py  — ele chama o bun sozinho)
"""
import glob
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VERIF = os.path.join(ROOT, "verification")
sys.path.insert(0, os.path.join(ROOT, "api", "py"))
sys.path.insert(0, os.path.join(ROOT, "app", "verification"))

CASE = {
    "adserver": "adforce",
    "consolidado": "ADFORCE/VERIFICATION - NOVO POSICIONAMENTO - BA/CONSOLIDADO/Consolidado Verification NOVO POSICIONAMENTO - BA - JAN - 26.xlsx",
    "comp_glob": "ADFORCE/VERIFICATION - NOVO POSICIONAMENTO - BA/COMPROVANTES/JANEIRO/*.xlsx",
    "verif_glob": "ADFORCE/VERIFICATION - NOVO POSICIONAMENTO - BA/VERIFICATION/*JANEIRO*.xlsx",
}


def upload(paths):
    """Sobe os arquivos e devolve [{url, name}] via o helper TS (mesmo lib/storage.ts da rota)."""
    out = subprocess.run(
        ["bun", "--env-file=.env.local", os.path.join("scripts", "upload-fixtures.ts"), *paths],
        cwd=ROOT, capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise SystemExit(f"upload falhou:\n{out.stderr}")
    return json.loads(out.stdout)


def summarize(result):
    """Reduz o resultado ao que importa comparar: veículos, status e impressões."""
    return sorted(
        (v.get("veiculo"), v.get("status"), v.get("impressoes_comprovante"), v.get("impressoes_consolidado"))
        for v in result["veiculos"]
    )


def main():
    consolidado = os.path.join(VERIF, CASE["consolidado"])
    comps = sorted(glob.glob(os.path.join(VERIF, CASE["comp_glob"])))
    verifs = sorted(glob.glob(os.path.join(VERIF, CASE["verif_glob"])))
    assert os.path.exists(consolidado) and comps and verifs, "fixtures ADFORCE sumiram"
    print(f"triad: 1 consolidado + {len(comps)} comprovantes + {len(verifs)} verifs")

    import verification as vapi

    # ── A) caminho base64 (on-prem), como referência ──────────────────────────
    def b64(p):
        import base64
        return base64.b64encode(open(p, "rb").read()).decode()

    ref = vapi._run_engine({
        "adserver": CASE["adserver"],
        "consolidado_b64": b64(consolidado),
        "consolidado_name": os.path.basename(consolidado),
        "comp_files": [{"name": os.path.basename(p), "b64": b64(p)} for p in comps],
        "verif_files": [{"name": os.path.basename(p), "b64": b64(p)} for p in verifs],
        "url_sample_pct": 0,
    })
    print(f"✓ base64 (on-prem): {len(ref['veiculos'])} veículos")

    # ── B) caminho storage (signed URLs), o que mudou ─────────────────────────
    all_files = upload([consolidado, *comps, *verifs])
    by_name = {f["name"]: f for f in all_files}
    got = vapi._run_engine({
        "adserver": CASE["adserver"],
        "consolidado_url": by_name[os.path.basename(consolidado)]["url"],
        "consolidado_name": os.path.basename(consolidado),
        "comp_files": [by_name[os.path.basename(p)] for p in comps],
        "verif_files": [by_name[os.path.basename(p)] for p in verifs],
        "url_sample_pct": 0,
    })
    print(f"✓ storage (signed URL): {len(got['veiculos'])} veículos")

    # ── C) os dois têm que ser idênticos ──────────────────────────────────────
    if summarize(ref) != summarize(got):
        print("\n✗ DIVERGIU")
        for a, b in zip(summarize(ref), summarize(got)):
            if a != b:
                print(f"  base64={a}\n  storage={b}")
        raise SystemExit(1)

    print(f"✓ idênticos — {len(summarize(got))} veículos batem em status e impressões")
    print(f"  parse_errors: base64={len(ref['parse_errors'])} storage={len(got['parse_errors'])}")

    # O teste não pode deixar lixo no bucket de staging.
    subprocess.run(
        ["bun", "--env-file=.env.local", os.path.join("scripts", "upload-fixtures.ts"), "--cleanup",
         *[f["path"] for f in all_files]],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    print("✓ bucket limpo")


if __name__ == "__main__":
    main()
