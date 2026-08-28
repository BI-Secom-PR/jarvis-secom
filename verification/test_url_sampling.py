#!/usr/bin/env python3
"""
Checa a regra de seleção de URLs para a auditoria de IA.

A regra: dentro de cada grupo (veículo, categoria), uma URL entra se sozinha
representa >= URL_SHARE_PCT% das impressões do grupo, no máximo
URL_MAX_POR_GRUPO por grupo; grupo sem ninguém acima do corte rende a maior.

Roda o engine sobre os fixtures ADFORCE/METRIKE/SENSE e confere as invariantes
na amostra real. Não precisa de rede nem de chave de IA.

    python3 verification/test_url_sampling.py
"""
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT / "app/verification"), str(ROOT / "app/verification/parsers")]

import engine  # noqa: E402
from parser_utils import UrlAggregator  # noqa: E402


def seleciona(impressoes, share_pct=engine.URL_SHARE_PCT):
    """Reimplementação mínima da regra, para checar o exemplo canônico."""
    itens = sorted(impressoes, reverse=True)
    limite = sum(itens) * share_pct / 100
    return [i for i in itens if i >= limite][: engine.URL_MAX_POR_GRUPO] or itens[:1]


def test_exemplo_canonico():
    """O exemplo que definiu a regra: 30/29/25/10/5% e depois cauda pulverizada."""
    grupo = [300_000, 290_000, 250_000, 100_000, 50_000, 3_000, 3_000, 2_000, 1_000, 1_000]
    sel = seleciona(grupo)
    assert sel == [300_000, 290_000, 250_000, 100_000, 50_000], sel
    assert sum(sel) / sum(grupo) == 0.99
    print(f"OK exemplo canônico: {len(sel)} URLs, 99,0% das impressões")


def test_grupo_pulverizado():
    """Nenhuma URL atinge o share -> devolve a maior, nunca vazio."""
    grupo = [10] * 500          # cada uma vale 0,2%, abaixo do corte de 2%
    assert seleciona(grupo) == [10]
    assert seleciona([]) == []
    print("OK grupo pulverizado cai no fallback de 1 URL")


def test_teto_por_grupo():
    """Grupo achatado o bastante para todos passarem ainda respeita o teto."""
    grupo = [100] * 30          # cada uma vale 3,33%, acima do corte
    assert len(seleciona(grupo)) == engine.URL_MAX_POR_GRUPO
    print(f"OK teto de {engine.URL_MAX_POR_GRUPO} por grupo respeitado")


def test_agregador_soma_e_descarta_app():
    agg = UrlAggregator()
    for _ in range(3):
        agg.add("GLOBO", "Notícias", "https://g1.globo.com/x", 50, cpm=50)
    agg.add("GLOBO", "Notícias", "app://com.globo.g1.app", 18_000_000)
    agg.add("GLOBO", "Notícias", "", 999)
    itens = agg.items()
    assert len(itens) == 1, itens
    assert itens[0]["impressoes"] == 150, itens          # somou, não amostrou
    assert itens[0]["cpm"] == 150, itens
    print("OK agregador soma impressões e descarta app:// e URL vazia")


def test_amostra_real():
    """Invariantes sobre a amostra que sai do engine nos fixtures do repo.

    Reusa os globs de test_regression.CASES para não duplicar (nem deixar
    desincronizar) a localização dos fixtures.
    """
    import glob as _glob
    import tempfile
    sys.path.insert(0, str(ROOT / "verification"))
    from test_regression import CASES, HERE

    rodou = 0
    tmp = tempfile.mkdtemp(prefix="url-sampling-")
    for adserver, case in CASES.items():
        consol  = Path(HERE) / case["consolidado"]
        comps   = sorted(_glob.glob(str(Path(HERE) / case["comp_glob"])))
        verifs  = sorted(_glob.glob(str(Path(HERE) / case["verif_glob"])))
        if not (consol.exists() and comps and verifs):
            continue
        res = engine.verificar(
            consolidado_path=str(consol), adserver=adserver.lower(),
            comp_paths=comps, verif_paths=verifs,
            output_path=str(Path(tmp) / f"{adserver}.xlsx"),
        )
        amostra = res["url_sample"]
        if not amostra:
            continue
        rodou += 1

        vistos = set()
        por_grupo = defaultdict(list)
        for it in amostra:
            chave = (it["veiculo"], it["categoria"], it["url"])
            assert chave not in vistos, f"{adserver}: URL duplicada na amostra {chave}"
            vistos.add(chave)
            assert not it["url"].startswith("app://"), f"{adserver}: app:// vazou {it['url']}"
            por_grupo[(it["veiculo"], it["categoria"])].append(it)

        for g, itens in por_grupo.items():
            assert len(itens) <= engine.URL_MAX_POR_GRUPO, f"{adserver}: grupo {g} tem {len(itens)}"
            assert itens, f"{adserver}: grupo {g} vazio"

        imps = [i.get("impressoes") or 0 for i in amostra]
        assert imps == sorted(imps, reverse=True), f"{adserver}: amostra fora de ordem"
        print(f"OK {adserver}: {len(amostra)} URLs em {len(por_grupo)} grupos "
              f"(veículo × categoria), sem duplicata, ordenada")

    assert rodou > 0, "nenhum fixture rodou — o teste não provou nada"


if __name__ == "__main__":
    test_exemplo_canonico()
    test_grupo_pulverizado()
    test_teto_por_grupo()
    test_agregador_soma_e_descarta_app()
    test_amostra_real()
    print("\nOK — regra de share validada.")
