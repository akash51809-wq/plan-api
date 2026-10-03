from browser_manager import BrowserManager
from config import LOGIN_URL, OPERATOR_LOOK_URL, USERNAME, PASSWORD, MOBILE_NUMBER


def main():
    browser = BrowserManager()

    try:
        page = browser.start()

        if not USERNAME or not PASSWORD:
            raise ValueError(
                "PLANAPI_USERNAME and PLANAPI_PASSWORD must be set in the environment or .env file."
            )

        page.goto(LOGIN_URL, wait_until="domcontentloaded")
        page = browser.login(USERNAME, PASSWORD)

        page.goto(OPERATOR_LOOK_URL, wait_until="domcontentloaded")

        mobile_number = MOBILE_NUMBER or "9876543210"
        result = browser.operator_look.run_lookup(page, mobile_number)
        print(result)

    finally:
        browser.close()


if __name__ == "__main__":
    main()
