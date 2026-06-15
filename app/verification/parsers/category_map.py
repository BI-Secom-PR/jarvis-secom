"""
Mapeamento de categorias de indevidas → chaves internas SECOM.

Cada adserver usa nomenclatura própria para categorias. Este módulo fornece:
  - Mapas por adserver (SENSE_CATEGORY_MAP, METRIKE_CATEGORY_MAP, ADFORCE_CATEGORY_MAP)
  - CATEGORY_MAP global como fallback para adservers sem mapa dedicado
  - normaliza_categoria(texto, adserver=None) — resolução com prioridade adserver-específico

Colunas no template (1-indexed):
  14 = Conteúdo Sensível
  15 = Acidente
  16 = Violência e Crime
  17 = Língua Estrangeira
  18 = Pornografia
  19 = Safeframe
  20 = Aplicativo Móvel
  21 = Teste de Tag
  22 = Não Classificado
  23 = Drogas
"""

# ── Mapas por adserver ────────────────────────────────────────────────────────
# Apenas categorias indevidas — categorias de conteúdo válido (Política, Economia…)
# não figuram aqui e retornam None, caindo no verif_extras.

SENSE_CATEGORY_MAP: dict[str, str] = {
    "sensível":    "conteudo_sensivel",
    "sensivel":    "conteudo_sensivel",
    "violência":   "violencia",
    "violencia":   "violencia",
    "drogas":      "drogas",
    "pornografia": "pornografia",
    "pornography": "pornografia",
    "safeframe":   "safeframe",
}

METRIKE_CATEGORY_MAP: dict[str, str] = {
    "conteúdo sensível": "conteudo_sensivel",
    "conteudo sensivel": "conteudo_sensivel",
    "policial":          "violencia",
    "polícia":           "violencia",
    "policia":           "violencia",
    "safeframe":         "safeframe",
    "teste banner":      "teste_tag",
    "teste de tag":      "teste_tag",
}

ADFORCE_CATEGORY_MAP: dict[str, str] = {
    # Compound safety strings geradas pelo ADFORCE
    "acidentes, violência, crime":      "violencia",
    "acidentes, violencia, crime":      "violencia",
    "acidentes,violência,crime":        "violencia",
    "acidentes,violencia,crime":        "violencia",
    "acidente, crime, violencia":       "violencia",
    "acidente, violência, crime":       "violencia",
    "acidente, violencia, crime":       "violencia",
    "violência, crime":                 "violencia",
    "violencia, crime":                 "violencia",
    "sexo e sexualidade, pornografia":  "pornografia",
    "sexo, sexualidade e pornografia":  "pornografia",
    "pornografia, sexo, sexualidade":   "pornografia",
    "sexo e sexualidade":               "pornografia",
    "sexo, sexualidade, pornografia":   "pornografia",
    "safeframe":                        "safeframe",
}

ADSERVER_MAPS: dict[str, dict[str, str]] = {
    "sense":   SENSE_CATEGORY_MAP,
    "metrike": METRIKE_CATEGORY_MAP,
    "adforce": ADFORCE_CATEGORY_MAP,
}

# ── Fallback global (00px, admotion, ahead, brz e adservers sem mapa próprio) ─
CATEGORY_MAP: dict[str, str] = {
    # Conteúdo Sensível (col 14)
    "conteúdo sensível":                "conteudo_sensivel",
    "conteudo sensivel":                "conteudo_sensivel",
    "sensitive content":                "conteudo_sensivel",
    "sensível":                         "conteudo_sensivel",
    "sensivel":                         "conteudo_sensivel",
    # Drogas (col 23) — chave própria, não agregado em conteudo_sensivel
    "drogas":                           "drogas",
    # Acidente (col 15)
    "acidente":                         "acidente",
    "acidentes violentos":              "acidente",
    "acidentes":                        "acidente",
    # Violência e Crime (col 16)
    "crime":                            "violencia",
    "crimes":                           "violencia",
    "crime violento":                   "violencia",
    "violência":                        "violencia",
    "violencia":                        "violencia",
    "violência e criminalidade":        "violencia",
    "violencia e criminalidade":        "violencia",
    "violência e crime":                "violencia",
    "violencia e crime":                "violencia",
    "violence":                         "violencia",
    "policial":                         "violencia",
    "policia":                          "violencia",
    "polícia":                          "violencia",
    # Língua Estrangeira (col 17)
    "conteúdo em língua estrangeira":   "lingua_estrangeira",
    "conteudo em lingua estrangeira":   "lingua_estrangeira",
    "lingua estrangeira":               "lingua_estrangeira",
    "língua estrangeira":               "lingua_estrangeira",
    "idioma estrangeiro ou traduzido":  "lingua_estrangeira",
    "foreign language":                 "lingua_estrangeira",
    # Pornografia (col 18)
    "pornografia":                      "pornografia",
    "pornography":                      "pornografia",
    "sexo e sexualidade":               "pornografia",
    "sexo":                             "pornografia",
    "conteúdo adulto e sexual":         "pornografia",
    "conteudo adulto e sexual":         "pornografia",
    "adult":                            "pornografia",
    "sexuality":                        "pornografia",
    # Safeframe (col 19)
    "safeframe":                        "safeframe",
    # Aplicativo Móvel (col 20)
    "aplicativo móvel":                 "app_movel",
    "aplicativo movel":                 "app_movel",
    "mobile app":                       "app_movel",
    # Teste de Tag (col 21)
    "teste de tag":                     "teste_tag",
    "teste banner":                     "teste_tag",
    # Não Classificado (col 22)
    "não classificado":                 "nao_classificado",
    "nao classificado":                 "nao_classificado",
    "indeterminado":                    "nao_classificado",
    "indeterminados":                   "nao_classificado",
}

# Todas as chaves internas zeradas — base para inicializar indevidas
INDEVIDAS_ZERO: dict[str, int] = {
    "conteudo_sensivel":  0,
    "drogas":             0,
    "acidente":           0,
    "violencia":          0,
    "lingua_estrangeira": 0,
    "pornografia":        0,
    "safeframe":          0,
    "app_movel":          0,
    "teste_tag":          0,
    "nao_classificado":   0,
}


def normaliza_categoria(texto: str, adserver: str | None = None) -> str | None:
    """
    Mapeia um nome de categoria para a chave interna SECOM.

    Se adserver for informado e tiver mapa dedicado, usa esse mapa exclusivamente
    (categorias não listadas retornam None — são conteúdo válido, não indevidas).
    Caso contrário usa o CATEGORY_MAP global como fallback.

    Retorna None se a categoria não for reconhecida como indevida.
    """
    if not texto or not isinstance(texto, str):
        return None
    key = texto.split('\n')[0].strip().lower()
    if adserver:
        adserver_map = ADSERVER_MAPS.get(adserver.lower())
        if adserver_map is not None:
            return adserver_map.get(key)
    return CATEGORY_MAP.get(key)
