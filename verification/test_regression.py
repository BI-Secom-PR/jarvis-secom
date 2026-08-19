#!/usr/bin/env python3
"""Regression do engine de verificação contra os fixtures in-repo.

Roda engine.py sobre uma tríade real de cada adserver e falha se:
o engine der erro, aparecer parse_error, ou o nº de veículos/statuses
divergir do baseline pinado (atualize EXPECTED conscientemente ao mudar regra).

Uso:  python3 verification/test_regression.py
"""
import glob
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(HERE, "..", "app", "verification", "engine.py")

# ponytail: baseline pinado a mão após primeira rodada verde; ajuste junto com mudanças de regra
CASES = {
    "ADFORCE": {
        "consolidado": "ADFORCE/VERIFICATION - NOVO POSICIONAMENTO - BA/CONSOLIDADO/Consolidado Verification NOVO POSICIONAMENTO - BA - JAN - 26.xlsx",
        "comp_glob": "ADFORCE/VERIFICATION - NOVO POSICIONAMENTO - BA/COMPROVANTES/JANEIRO/*.xlsx",
        "verif_glob": "ADFORCE/VERIFICATION - NOVO POSICIONAMENTO - BA/VERIFICATION/*JANEIRO*.xlsx",
    },
    "METRIKE": {
        "consolidado": "METRIKE/VERIFICATION SP ABRIL/Consolidado Verification - Posicionamento SP - CPM.xlsx",
        "comp_glob": "METRIKE/VERIFICATION SP ABRIL/COMPROVANTES/CPM/*.xlsx",
        "verif_glob": "METRIKE/VERIFICATION SP ABRIL/VERIFICATION /CPM/*.xlsx",
    },
    "SENSE": {
        # Always_on = C1 diário + V1 verif (baseline leve). Junho multi (C2/C3/V2/V3)
        # fica em SENSE/Posicionamento_governo_junho/ — smoke manual, não baseline.
        "consolidado": "SENSE/Always_on_20250064/Consolidado - Always_on_20250064 - 27-05 - Ana.xlsx",
        "comp_glob": "SENSE/Always_on_20250064/COMPROVANTE /*.xlsx",
        "verif_glob": "SENSE/Always_on_20250064/VERIFICATION/*.xlsx",
    },
    "DGBRASIL": {
        # Consolidado CPM (19 veículos display); glob de comp/verif inclui também
        # os 3 veículos de vídeo (Claro/Tim/Vivo Ads), que ficam em "sem_consolidado"
        # aqui pois pertencem ao consolidado CPV separado — smoke manual, não baseline.
        "consolidado": "DGbrasil/Junho/Consolidado/Consolidado Junho - CPM.xlsx",
        "comp_glob": "DGbrasil/Junho/Comprovante de Veiculação/*.xlsx",
        "verif_glob": "DGbrasil/Junho/Verification/*.xlsx",
    },
    "00PX25": {
        # Lado CPM (7 veículos). Claro Rewards é CPV-only e cai em "sem_consolidado"
        # aqui — o consolidado CPV é arquivo separado, smoke manual, não baseline.
        # Verification tem uma subpasta por veículo, com N Parts cada.
        "consolidado": "OOPX25/CONSOLIDADOS/Consolidado _ SECOM _ Justiça Tarifária _ Luz do Povo _ CPM.xlsx",
        "comp_glob":   "OOPX25/COMPROVANTES/*CPM*.xlsx",
        "verif_glob":  "OOPX25/VERIFICATIONS/*/Verification*.xlsx",
    },
    "TERATECH": {
        # Lado CPV (3 veículos): a aba ativa desse consolidado já é CONSOLIDADO -
        # CPV. O lado CPM (12 veículos) é smoke manual — o engine lê só a aba
        # ativa, então roda-se uma vez por objetivo.
        "consolidado": "TERATECH/Verification Consolidado TERATECH - AON 20260009 - Junho.xlsx",
        "comp_glob": "TERATECH/comprovantes/*CPV*.xlsx",
        "verif_glob": "TERATECH/verifications/CPV/*.xlsx",
    },
}

# Baseline pinado na rodada verde de 2026-07-03 (DGBRASIL adicionado em 2026-07-21).
# Mudou uma regra de parser/engine de propósito? Rode, confira o diff a olho e
# atualize estes números.
EXPECTED: dict = {
    "ADFORCE": {"n_veiculos": 12, "statuses": ["DIVERGENCIA"] * 2 + ["OK"] * 10},
    "METRIKE": {"n_veiculos": 23,
                "statuses": ["DIVERGENCIA"] * 6 + ["OK"] * 11 + ["PENDENTE"] * 6},
    "SENSE": {"n_veiculos": 8, "statuses": ["DIVERGENCIA"] * 3 + ["OK"] * 5},
    "DGBRASIL": {"n_veiculos": 22,
                 "statuses": ["DIVERGENCIA"] * 6 + ["OK"] * 15 + ["PENDENTE"] * 1},
    "TERATECH": {"n_veiculos": 3, "statuses": ["DIVERGENCIA"] * 3},
    "00PX25": {"n_veiculos": 7, "statuses": ["DIVERGENCIA"] * 2 + ["OK"] * 5},
}


def run_case(adserver: str, case: dict, outdir: str) -> dict:
    consolidado = os.path.join(HERE, case["consolidado"])
    comps = sorted(glob.glob(os.path.join(HERE, case["comp_glob"])))
    verifs = sorted(glob.glob(os.path.join(HERE, case["verif_glob"])))
    assert os.path.exists(consolidado), f"{adserver}: consolidado sumiu: {consolidado}"
    assert comps, f"{adserver}: nenhum comprovante em {case['comp_glob']}"
    cmd = [
        sys.executable, ENGINE, consolidado,
        "--adserver", adserver.lower(),
        "--comp", *comps,
        "--output", os.path.join(outdir, f"{adserver}.xlsx"),
    ]
    if verifs:
        cmd += ["--verif", *verifs]
    proc = subprocess.run(cmd, capture_output=True, text=True,
                          cwd=os.path.join(HERE, "..", "app", "verification"))
    assert proc.returncode == 0, f"{adserver}: engine exit {proc.returncode}\n{proc.stderr[-2000:]}"
    return json.loads(proc.stdout)


def main() -> None:
    failures = []
    with tempfile.TemporaryDirectory() as outdir:
        for adserver, case in CASES.items():
            try:
                r = run_case(adserver, case, outdir)
            except AssertionError as e:
                failures.append(str(e))
                print(f"FAIL {adserver}: {e}")
                continue
            statuses = sorted(v["status"] for v in r["veiculos"])
            n, nerr = len(r["veiculos"]), len(r["parse_errors"])
            print(f"{adserver}: {n} veículos, {nerr} parse_errors, statuses={statuses}")
            if nerr:
                failures.append(f"{adserver}: parse_errors: {r['parse_errors']}")
            if n == 0:
                failures.append(f"{adserver}: 0 veículos no resultado")
            exp = EXPECTED.get(adserver)
            if exp:
                if n != exp["n_veiculos"]:
                    failures.append(f"{adserver}: {n} veículos != baseline {exp['n_veiculos']}")
                if statuses != exp["statuses"]:
                    failures.append(f"{adserver}: statuses {statuses} != baseline {exp['statuses']}")
    if failures:
        print(f"\n{len(failures)} FALHA(S):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print(f"\nOK — engine bate com o baseline nos {len(CASES)} adservers.")


if __name__ == "__main__":
    main()
