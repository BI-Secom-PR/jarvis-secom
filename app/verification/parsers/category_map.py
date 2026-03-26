"""
Mapeamento centralizado de categorias de indevidas → chaves internas SECOM.

Importado por parser_vetta, parser_adserver_verif e qualquer parser futuro
que precise mapear nomes de categoria para as 9 chaves do template (29 colunas).

Colunas no template (1-indexed):
  14 = Conteúdo Sensível  (agregado geral)
  15 = Acidente
  16 = Violência e Crime
  17 = Língua Estrangeira
  18 = Pornografia
  19 = Safeframe
  20 = Aplicativo Móvel
  21 = Teste de Tag
  22 = Não Classificado
"""

# Mapeamento: nome normalizado (lowercase, strip) → chave interna SECOM
CATEGORY_MAP: dict[str, str] = {
    # Conteúdo Sensível (col 14 — agregado geral)
    "conteúdo sensível":                "conteudo_sensivel",
    "conteudo sensivel":                "conteudo_sensivel",
    "sensitive content":                "conteudo_sensivel",
    "sensível":                         "conteudo_sensivel",
    "sensivel":                         "conteudo_sensivel",
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
    # ADFORCE compound safety strings
    "acidentes, violência, crime":      "violencia",
    "acidentes, violencia, crime":      "violencia",
    "violência, crime":                 "violencia",
    "violencia, crime":                 "violencia",
    "sexo e sexualidade, pornografia":  "pornografia",
    "sexo, sexualidade e pornografia":  "pornografia",
    "sexo e sexualidade":               "pornografia",
    # Safeframe (col 19)
    "safeframe":                        "safeframe",
    # Aplicativo Móvel (col 20)
    "aplicativo móvel":                 "app_movel",
    "aplicativo movel":                 "app_movel",
    "mobile app":                       "app_movel",
    # Teste de Tag (col 21)
    "teste de tag":                     "teste_tag",
    # Não Classificado (col 22)
    "não classificado":                 "nao_classificado",
    "nao classificado":                 "nao_classificado",
    "indeterminado":                    "nao_classificado",
    "indeterminados":                   "nao_classificado",
}

# Todas as chaves internas zeradas — base para inicializar indevidas
INDEVIDAS_ZERO: dict[str, int] = {
    "conteudo_sensivel":  0,
    "acidente":           0,
    "violencia":          0,
    "lingua_estrangeira": 0,
    "pornografia":        0,
    "safeframe":          0,
    "app_movel":          0,
    "teste_tag":          0,
    "nao_classificado":   0,
}


def normaliza_categoria(texto: str) -> str | None:
    """
    Mapeia um nome de categoria para a chave interna SECOM.
    Retorna None se a categoria não for reconhecida.
    """
    if not texto or not isinstance(texto, str):
        return None
    key = texto.strip().lower()
    return CATEGORY_MAP.get(key)
