import os
from dotenv import load_dotenv

load_dotenv()

BASE_URL = os.getenv("PLANAPI_BASE_URL", "https://planapi.in")
LOGIN_URL = os.getenv("PLANAPI_LOGIN_URL", f"{BASE_URL}/Login.aspx")
OPERATOR_LOOK_URL = os.getenv("PLANAPI_OPERATOR_LOOK_URL", f"{BASE_URL}/OperatorLook.aspx")
USERNAME = os.getenv("PLANAPI_USERNAME", "")
PASSWORD = os.getenv("PLANAPI_PASSWORD", "")
MOBILE_NUMBER = os.getenv("PLANAPI_MOBILE", "")
HEADLESS = os.getenv("PLAYWRIGHT_HEADLESS", "false").lower() == "true"
