"""Optional mobile/desktop UI check. Run smoke.py with CHECK_BROWSER=1."""
import os
from playwright.sync_api import sync_playwright


def check(url):
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.getenv("CHROMIUM_PATH") or None,
                                    args=["--no-sandbox"])
        for w, h in [(390, 844), (1366, 900)]:
            page = browser.new_page(viewport={"width": w, "height": h})
            page.goto(url)
            page.get_by_role("button", name="Chọn món").click()
            page.get_by_role("checkbox", name="Trân châu").check()
            page.get_by_label("Ghi chú món").fill("Ít ngọt")
            page.get_by_role("button", name="Thêm ·").click()
            page.get_by_role("button", name="Xem giỏ").click()
            assert page.get_by_text("Trân châu · Ít ngọt").is_visible()
            page.get_by_role("button", name="Đăng nhập để đặt món").click()
            assert page.get_by_role("button", name="Tiếp tục với Google").is_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.close()
        browser.close()
    print("PASS: customer menu, toppings, cart and account at mobile and desktop sizes.")
