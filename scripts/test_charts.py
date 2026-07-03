#!/usr/bin/env python3
"""Testa cada tipo de gráfico do chat Jarvis via Playwright (python).

Login → /chat → envia um prompt canônico por tipo de gráfico → screenshot.
Screenshots em scripts/chart-screenshots/ para inspeção visual.

Uso:
  JARVIS_EMAIL=... JARVIS_PASSWORD=... python3 scripts/test_charts.py [BASE_URL]
  BASE_URL default: http://localhost:3000 (use https://jarvisui-two.vercel.app p/ prod)
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
EMAIL = os.environ.get("JARVIS_EMAIL", "cesarguilherme@gmail.com")
PASSWORD = os.environ.get("JARVIS_PASSWORD")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chart-screenshots")

# Prompts canônicos, um por tipo de gráfico (pedido em f9a062d0: "prompt de teste
# para testar cada tipo de gráfico")
PROMPTS = {
    "bar": "Gráfico de barras: investimento total por plataforma nos últimos 30 dias.",
    "line": "Gráfico de linhas: evolução diária de impressões nos últimos 30 dias.",
    "pie": "Gráfico de pizza: participação de cada plataforma no total de cliques.",
    "scatter": "Gráfico de dispersão: CTR vs investimento por campanha, colorido por plataforma.",
    "geo": "Mapa do Brasil: impressões por estado (região) no último mês.",
}

WAIT_AFTER_SEND_S = 45  # geração de SQL + query + render demora


def main() -> None:
    if not PASSWORD:
        sys.exit("Defina JARVIS_PASSWORD no ambiente (não hardcodear senha).")
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        # login
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.fill('input[type="email"]', EMAIL)
        page.fill('input[type="password"]', PASSWORD)
        page.click('button[type="submit"]')
        page.wait_for_url("**/chat**", timeout=20_000)
        print(f"login OK → {page.url}")

        for name, prompt in PROMPTS.items():
            box = page.locator("textarea, [contenteditable='true']").first
            box.click()
            box.fill(prompt)
            box.press("Enter")
            print(f"[{name}] enviado; aguardando render…")
            time.sleep(WAIT_AFTER_SEND_S)
            path = os.path.join(OUT, f"{name}.png")
            page.screenshot(path=path, full_page=True)
            print(f"[{name}] screenshot → {path}")

        browser.close()
    print(f"\nOK — {len(PROMPTS)} screenshots em {OUT}/ — inspecione visualmente.")


if __name__ == "__main__":
    main()
