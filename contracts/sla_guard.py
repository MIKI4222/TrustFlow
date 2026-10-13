# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""SLA Guard v4 - on-chain uptime insurance with enforced claim eligibility.

Security model (all checks run BEFORE the non-deterministic web verdict):

  1. the contract must not be paused
  2. the reported URL must be an ACTIVE owner-configured insured service
  3. the caller must be an ACTIVE eligible payout recipient of that service
  4. the caller's per-service claim cooldown must have expired
  5. the service must not have an already-compensated open incident
  6. the fund must be able to cover a full payout

Only when every guard above passes do validators fetch the endpoint, which means
the web verdict can never trigger a payment for an ineligible caller or for an
incident that was already compensated.

Replay protection is enforced by an incident lifecycle, not only by a clock:
each service carries an incident identifier "<service_id>:<sequence>". The first
approved claim marks that incident as compensated, and every later claim for the
same incident reverts until the incident is closed - either automatically once
the incident window elapses or manually by the owner via resolve_incident().
If the runtime clock is unavailable the automatic path is skipped, so the
lifecycle degrades to a hard stop instead of silently allowing a drain.
"""

import json

from genlayer import *

# --- economics -------------------------------------------------------------
DEFAULT_COMPENSATION = 10_000_000_000_000_000  # 0.01 GEN paid per outage
DEFAULT_PREMIUM = 1_000_000_000_000_000  # 0.001 GEN to subscribe to a service

# --- replay protection defaults --------------------------------------------
DEFAULT_INCIDENT_WINDOW = 3600  # seconds an incident stays compensated
DEFAULT_CLAIM_COOLDOWN = 900  # seconds between claims of one subscriber

# --- claim statuses --------------------------------------------------------
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"

# --- incident states -------------------------------------------------------
INCIDENT_NONE = "none"
INCIDENT_COMPENSATED = "compensated"

# --- web inspection --------------------------------------------------------
BODY_LIMIT = 1500
STATUS_UNKNOWN = -1
STATUS_UNREACHABLE = 0

OUTAGE_KEYWORDS = (
    "internal server error",
    "service unavailable",
    "bad gateway",
    "gateway time-out",
    "gateway timeout",
    "temporarily unavailable",
    "unavailable",
    "timed out",
    "502 bad",
    "503 service",
    "504 gateway",
)


def _norm_address(value) -> str:
    return str(value).strip().lower()


def _days_from_civil(year: int, month: int, day: int) -> int:
    """Days since 1970-01-01 without importing datetime."""
    y = year
    if month <= 2:
        y = y - 1
    era = (y if y >= 0 else y - 399) // 400
    yoe = y - era * 400
    mp = (month + 9) % 12
    doy = (153 * mp + 2) // 5 + day - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def _parse_clock(value) -> int:
    """Best-effort conversion of the runtime clock into epoch seconds."""
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if text == "":
        return 0
    if text.isdigit():
        return int(text)
    try:
        year = int(text[0:4])
        month = int(text[5:7])
        day = int(text[8:10])
        hour = 0
        minute = 0
        second = 0
        if len(text) >= 19 and text[10] in ("T", " "):
            hour = int(text[11:13])
            minute = int(text[14:16])
            second = int(text[17:19])
        return _days_from_civil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second
    except Exception:
        return 0


@gl.evm.contract_interface
class _Wallet:
    class View:
        pass

    class Write:
        pass


class SLAGuard(gl.Contract):
    """Uptime insurance pool arbitrated by GenLayer validators."""

    config: str
    services: DynArray[str]
    subscriptions: DynArray[str]
    claims: DynArray[str]

    def __init__(self):
        self.config = json.dumps(
            {
                "owner": _norm_address(gl.message.sender_address),
                "compensation_amount": DEFAULT_COMPENSATION,
                "premium_amount": DEFAULT_PREMIUM,
                "incident_window": DEFAULT_INCIDENT_WINDOW,
                "claim_cooldown": DEFAULT_CLAIM_COOLDOWN,
                "total_fund": 0,
                "total_paid_out": 0,
                "total_premiums": 0,
                "paused": False,
            }
        )

    # ------------------------------------------------------------------ utils

    def _cfg(self) -> dict:
        return json.loads(self.config)

    def _save(self, cfg: dict) -> None:
        self.config = json.dumps(cfg)

    def _only_owner(self, cfg: dict) -> None:
        assert _norm_address(gl.message.sender_address) == cfg["owner"], "Only the owner may do this"

    def _now(self) -> int:
        try:
            return _parse_clock(gl.message_raw["datetime"])
        except Exception:
            return 0

    def _normalize_url(self, url: str) -> str:
        clean = str(url).strip()
        assert clean != "", "URL must not be empty"
        assert len(clean) <= 512, "URL is too long"
        assert clean.startswith("http://") or clean.startswith("https://"), "URL must start with http:// or https://"
        return clean

    def _pay(self, recipient: str, amount: int) -> None:
        _Wallet(Address(recipient)).emit_transfer(value=u256(int(amount)))

    # --------------------------------------------------------------- services

    def _find_service(self, url: str) -> int:
        target = url.lower()
        for index in range(len(self.services)):
            record = json.loads(self.services[index])
            if str(record["url"]).lower() == target:
                return index
        return -1

    def _service_at(self, index: int) -> dict:
        return json.loads(self.services[index])

    def _store_service(self, index: int, record: dict) -> None:
        self.services[index] = json.dumps(record)

    def _incident_id(self, record: dict) -> str:
        return str(record["id"]) + ":" + str(record["incident_seq"])

    # ---------------------------------------------------------- subscriptions

    def _find_subscription(self, service_id: int, subscriber: str) -> int:
        wanted = _norm_address(subscriber)
        for index in range(len(self.subscriptions)):
            record = json.loads(self.subscriptions[index])
            if int(record["service_id"]) == int(service_id) and record["subscriber"] == wanted:
                return index
        return -1

    def _store_subscription(self, index: int, record: dict) -> None:
        self.subscriptions[index] = json.dumps(record)

    def _upsert_subscription(self, service_id: int, subscriber: str, source: str, now: int) -> None:
        wanted = _norm_address(subscriber)
        index = self._find_subscription(service_id, wanted)
        if index >= 0:
            record = json.loads(self.subscriptions[index])
            record["active"] = True
            record["source"] = source
            record["since"] = now
            self._store_subscription(index, record)
            return
        self.subscriptions.append(
            json.dumps(
                {
                    "service_id": int(service_id),
                    "subscriber": wanted,
                    "active": True,
                    "source": source,
                    "since": now,
                    "last_claim_at": 0,
                    "last_incident_id": "",
                    "claims_made": 0,
                    "paid_total": 0,
                }
            )
        )

    # ------------------------------------------------------------ owner: fund

    @gl.public.write.payable
    def deposit_funds(self) -> None:
        amount = int(gl.message.value or 0)
        assert amount > 0, "Deposit must be greater than zero"
        cfg = self._cfg()
        cfg["total_fund"] = int(cfg["total_fund"]) + amount
        self._save(cfg)

    @gl.public.write
    def withdraw_funds(self, amount: int) -> None:
        cfg = self._cfg()
        self._only_owner(cfg)
        value = int(amount)
        assert value > 0, "Withdrawal must be greater than zero"
        assert value <= int(cfg["total_fund"]), "Insufficient fund balance"
        cfg["total_fund"] = int(cfg["total_fund"]) - value
        self._save(cfg)
        self._pay(cfg["owner"], value)

    @gl.public.write
    def set_compensation_amount(self, amount: int) -> None:
        cfg = self._cfg()
        self._only_owner(cfg)
        value = int(amount)
        assert value > 0, "Compensation must be greater than zero"
        cfg["compensation_amount"] = value
        self._save(cfg)

    @gl.public.write
    def set_premium_amount(self, amount: int) -> None:
        cfg = self._cfg()
        self._only_owner(cfg)
        value = int(amount)
        assert value >= 0, "Premium must not be negative"
        cfg["premium_amount"] = value
        self._save(cfg)

    @gl.public.write
    def set_incident_window(self, seconds: int) -> None:
        cfg = self._cfg()
        self._only_owner(cfg)
        value = int(seconds)
        assert value >= 0, "Window must not be negative"
        cfg["incident_window"] = value
        self._save(cfg)

    @gl.public.write
    def set_claim_cooldown(self, seconds: int) -> None:
        cfg = self._cfg()
        self._only_owner(cfg)
        value = int(seconds)
        assert value >= 0, "Cooldown must not be negative"
        cfg["claim_cooldown"] = value
        self._save(cfg)

    @gl.public.write
    def pause(self) -> None:
        cfg = self._cfg()
        self._only_owner(cfg)
        cfg["paused"] = True
        self._save(cfg)

    @gl.public.write
    def unpause(self) -> None:
        cfg = self._cfg()
        self._only_owner(cfg)
        cfg["paused"] = False
        self._save(cfg)

    # -------------------------------------------------------- owner: policies

    @gl.public.write
    def add_monitored_service(self, target_url: str) -> int:
        cfg = self._cfg()
        self._only_owner(cfg)
        url = self._normalize_url(target_url)
        index = self._find_service(url)
        if index >= 0:
            record = self._service_at(index)
            record["active"] = True
            self._store_service(index, record)
            return int(record["id"])
        service_id = len(self.services)
        self.services.append(
            json.dumps(
                {
                    "id": service_id,
                    "url": url,
                    "active": True,
                    "incident_seq": 0,
                    "incident_state": INCIDENT_NONE,
                    "incident_id": "",
                    "incident_paid_at": 0,
                    "incident_payouts": 0,
                    "claims_total": 0,
                }
            )
        )
        return service_id

    @gl.public.write
    def remove_monitored_service(self, target_url: str) -> None:
        cfg = self._cfg()
        self._only_owner(cfg)
        url = self._normalize_url(target_url)
        index = self._find_service(url)
        assert index >= 0, "Service is not registered"
        record = self._service_at(index)
        record["active"] = False
        self._store_service(index, record)

    @gl.public.write
    def add_beneficiary(self, target_url: str, subscriber: str) -> None:
        cfg = self._cfg()
        self._only_owner(cfg)
        url = self._normalize_url(target_url)
        index = self._find_service(url)
        assert index >= 0, "Service is not registered"
        record = self._service_at(index)
        assert bool(record["active"]), "Service is not active"
        who = _norm_address(subscriber)
        assert who.startswith("0x") and len(who) == 42, "Beneficiary must be a valid address"
        self._upsert_subscription(int(record["id"]), who, "owner", self._now())

    @gl.public.write
    def remove_beneficiary(self, target_url: str, subscriber: str) -> None:
        cfg = self._cfg()
        self._only_owner(cfg)
        url = self._normalize_url(target_url)
        service_index = self._find_service(url)
        assert service_index >= 0, "Service is not registered"
        service_id = int(self._service_at(service_index)["id"])
        index = self._find_subscription(service_id, subscriber)
        assert index >= 0, "Subscription does not exist"
        record = json.loads(self.subscriptions[index])
        record["active"] = False
        self._store_subscription(index, record)

    @gl.public.write
    def resolve_incident(self, target_url: str) -> str:
        """Closes a compensated incident so the service can be claimed again."""
        cfg = self._cfg()
        self._only_owner(cfg)
        url = self._normalize_url(target_url)
        index = self._find_service(url)
        assert index >= 0, "Service is not registered"
        record = self._service_at(index)
        assert record["incident_state"] == INCIDENT_COMPENSATED, "No compensated incident to resolve"
        closed = self._incident_id(record)
        record["incident_seq"] = int(record["incident_seq"]) + 1
        record["incident_state"] = INCIDENT_NONE
        record["incident_id"] = ""
        record["incident_paid_at"] = 0
        record["incident_payouts"] = 0
        self._store_service(index, record)
        return json.dumps({"resolved_incident": closed, "next_incident": self._incident_id(record)})

    # ------------------------------------------------------- client: policies

    @gl.public.write.payable
    def subscribe(self, target_url: str) -> str:
        """Buys eligibility for a service by paying the premium into the fund."""
        cfg = self._cfg()
        assert not bool(cfg["paused"]), "Contract is paused"
        url = self._normalize_url(target_url)
        index = self._find_service(url)
        assert index >= 0, "Service is not insured by this contract"
        record = self._service_at(index)
        assert bool(record["active"]), "Service is not active"

        paid = int(gl.message.value or 0)
        premium = int(cfg["premium_amount"])
        assert paid >= premium, "Premium payment is too small"

        cfg["total_fund"] = int(cfg["total_fund"]) + paid
        cfg["total_premiums"] = int(cfg["total_premiums"]) + paid
        self._save(cfg)

        subscriber = _norm_address(gl.message.sender_address)
        self._upsert_subscription(int(record["id"]), subscriber, "premium", self._now())
        return json.dumps({"service_id": int(record["id"]), "subscriber": subscriber, "premium_paid": paid})

    # ------------------------------------------------------------- the claim

    @gl.public.write
    def report_outage(self, target_url: str) -> str:
        cfg = self._cfg()

        # ---- guard 1: contract must be live -------------------------------
        assert not bool(cfg["paused"]), "Contract is paused"

        url = self._normalize_url(target_url)
        claimant = _norm_address(gl.message.sender_address)
        now = self._now()

        # ---- guard 2: claim is bound to an active insured service ---------
        service_index = self._find_service(url)
        assert service_index >= 0, "URL is not an insured service configured by the owner"
        service = self._service_at(service_index)
        assert bool(service["active"]), "Insured service is not active"
        service_id = int(service["id"])

        # ---- guard 3: caller must be an eligible payout recipient ---------
        subscription_index = self._find_subscription(service_id, claimant)
        assert subscription_index >= 0, "Caller has no policy for this service"
        subscription = json.loads(self.subscriptions[subscription_index])
        assert bool(subscription["active"]), "Caller policy for this service is inactive"

        # ---- guard 4: per-subscriber cooldown -----------------------------
        cooldown = int(cfg["claim_cooldown"])
        last_claim_at = int(subscription["last_claim_at"])
        if cooldown > 0 and now > 0 and last_claim_at > 0:
            elapsed = now - last_claim_at
            assert elapsed >= cooldown, "Claim cooldown is still active for this caller"

        # ---- guard 5: incident lifecycle (replay protection) --------------
        window = int(cfg["incident_window"])
        if service["incident_state"] == INCIDENT_COMPENSATED:
            paid_at = int(service["incident_paid_at"])
            expired = window > 0 and now > 0 and paid_at > 0 and (now - paid_at) >= window
            assert expired, "Incident " + str(service["incident_id"]) + " was already compensated"
            # the window elapsed: close it and open a fresh incident id
            service["incident_seq"] = int(service["incident_seq"]) + 1
            service["incident_state"] = INCIDENT_NONE
            service["incident_id"] = ""
            service["incident_paid_at"] = 0
            service["incident_payouts"] = 0

        incident_id = self._incident_id(service)
        assert str(subscription["last_incident_id"]) != incident_id, "Caller already claimed this incident"

        # ---- guard 6: the pool must cover a full payout -------------------
        compensation = int(cfg["compensation_amount"])
        assert int(cfg["total_fund"]) >= compensation, "Insurance fund cannot cover a payout"

        # ==================================================================
        # Every eligibility and replay guard passed. Only now do validators
        # touch the outside world, so the web verdict can never be the thing
        # that authorises an ineligible or repeated payment.
        # ==================================================================
        def inspect_endpoint() -> str:
            status = STATUS_UNKNOWN
            body = ""
            reached = False
            response = None

            try:
                response = gl.nondet.web.request(url, method="GET")
                reached = True
            except (AttributeError, TypeError):
                try:
                    response = gl.nondet.web.get(url)
                    reached = True
                except Exception:
                    response = None
                    reached = False
            except Exception:
                response = None
                reached = False

            if reached and response is not None:
                for attribute in ("status_code", "status", "code"):
                    try:
                        value = getattr(response, attribute, None)
                        if value is not None:
                            status = int(value)
                            break
                    except Exception:
                        status = STATUS_UNKNOWN
                try:
                    raw = getattr(response, "body", None)
                    if raw is None:
                        raw = getattr(response, "text", None)
                    if isinstance(raw, bytes):
                        body = raw.decode("utf-8", errors="ignore")
                    elif raw is not None:
                        body = str(raw)
                except Exception:
                    body = ""
            else:
                status = STATUS_UNREACHABLE

            body = body[:BODY_LIMIT]
            lowered = body.lower()
            marker = False
            for keyword in OUTAGE_KEYWORDS:
                if keyword in lowered:
                    marker = True
                    break

            if not reached:
                down = True
                reason = "Endpoint unreachable"
            elif status >= 500:
                down = True
                reason = "HTTP " + str(status) + " server error"
            elif 400 <= status < 500:
                down = marker
                reason = (
                    "HTTP " + str(status) + " with an outage marker in the body"
                    if marker
                    else "HTTP " + str(status) + ", client-side error only"
                )
            elif status == STATUS_UNKNOWN:
                down = marker
                reason = (
                    "Status unavailable, outage marker found in the body"
                    if marker
                    else "Status unavailable and no outage marker, treated as healthy"
                )
            else:
                down = False
                reason = "HTTP " + str(status) + ", endpoint is healthy"

            return json.dumps({"down": down, "status_code": status, "reason": reason})

        verdict = json.loads(gl.eq_principle.strict_eq(inspect_endpoint))
        approved = bool(verdict["down"])
        status_code = int(verdict["status_code"])
        reason = str(verdict["reason"])

        payout = 0
        if approved:
            payout = compensation
            cfg["total_fund"] = int(cfg["total_fund"]) - payout
            cfg["total_paid_out"] = int(cfg["total_paid_out"]) + payout
            service["incident_state"] = INCIDENT_COMPENSATED
            service["incident_id"] = incident_id
            service["incident_paid_at"] = now
            service["incident_payouts"] = int(service["incident_payouts"]) + 1
            subscription["last_incident_id"] = incident_id
            subscription["paid_total"] = int(subscription["paid_total"]) + payout

        # cooldown advances for approved and rejected claims alike, so a
        # rejected claim cannot be used to poll the endpoint in a tight loop
        subscription["last_claim_at"] = now
        subscription["claims_made"] = int(subscription["claims_made"]) + 1
        service["claims_total"] = int(service["claims_total"]) + 1

        claim_id = len(self.claims)
        self.claims.append(
            json.dumps(
                {
                    "id": claim_id,
                    "claimant": claimant,
                    "service_id": service_id,
                    "incident_id": incident_id,
                    "target_url": url,
                    "status": STATUS_APPROVED if approved else STATUS_REJECTED,
                    "status_code": status_code,
                    "payout": payout,
                    "reason": reason,
                    "at": now,
                }
            )
        )

        self._store_service(service_index, service)
        self._store_subscription(subscription_index, subscription)
        self._save(cfg)

        if approved:
            self._pay(claimant, payout)

        return json.dumps(
            {
                "claim_id": claim_id,
                "incident_id": incident_id,
                "approved": approved,
                "payout": payout,
                "status_code": status_code,
                "reason": reason,
            }
        )

    # ------------------------------------------------------------------ views

    @gl.public.view
    def get_owner(self) -> str:
        return str(self._cfg()["owner"])

    @gl.public.view
    def get_fund_balance(self) -> int:
        return int(self._cfg()["total_fund"])

    @gl.public.view
    def get_compensation_amount(self) -> int:
        return int(self._cfg()["compensation_amount"])

    @gl.public.view
    def get_premium_amount(self) -> int:
        return int(self._cfg()["premium_amount"])

    @gl.public.view
    def get_total_paid_out(self) -> int:
        return int(self._cfg()["total_paid_out"])

    @gl.public.view
    def is_paused(self) -> str:
        return "true" if bool(self._cfg()["paused"]) else "false"

    @gl.public.view
    def get_claims_count(self) -> int:
        return len(self.claims)

    @gl.public.view
    def get_monitored_services(self) -> list[str]:
        result = []
        for index in range(len(self.services)):
            record = json.loads(self.services[index])
            if bool(record["active"]):
                result.append(str(record["url"]))
        return result

    @gl.public.view
    def get_services(self) -> list[str]:
        result = []
        for index in range(len(self.services)):
            result.append(self.services[index])
        return result

    @gl.public.view
    def get_service(self, target_url: str) -> str:
        index = self._find_service(str(target_url).strip())
        if index < 0:
            return json.dumps({"found": False})
        record = self._service_at(index)
        record["found"] = True
        record["current_incident"] = self._incident_id(record)
        return json.dumps(record)

    @gl.public.view
    def get_subscriptions(self) -> list[str]:
        result = []
        for index in range(len(self.subscriptions)):
            result.append(self.subscriptions[index])
        return result

    @gl.public.view
    def is_eligible(self, target_url: str, subscriber: str) -> str:
        """Explains, without spending gas, whether a claim would be accepted."""
        cfg = self._cfg()
        index = self._find_service(str(target_url).strip())
        if index < 0:
            return json.dumps({"eligible": False, "reason": "URL is not an insured service"})
        service = self._service_at(index)
        if not bool(service["active"]):
            return json.dumps({"eligible": False, "reason": "Insured service is not active"})

        subscription_index = self._find_subscription(int(service["id"]), subscriber)
        if subscription_index < 0:
            return json.dumps({"eligible": False, "reason": "Caller has no policy for this service"})
        subscription = json.loads(self.subscriptions[subscription_index])
        if not bool(subscription["active"]):
            return json.dumps({"eligible": False, "reason": "Caller policy is inactive"})

        now = self._now()
        cooldown = int(cfg["claim_cooldown"])
        last_claim_at = int(subscription["last_claim_at"])
        remaining = 0
        if cooldown > 0 and now > 0 and last_claim_at > 0:
            remaining = cooldown - (now - last_claim_at)
            if remaining < 0:
                remaining = 0
        if remaining > 0:
            return json.dumps(
                {"eligible": False, "reason": "Cooldown active", "cooldown_remaining": remaining}
            )

        incident_id = self._incident_id(service)
        if service["incident_state"] == INCIDENT_COMPENSATED:
            window = int(cfg["incident_window"])
            paid_at = int(service["incident_paid_at"])
            expired = window > 0 and now > 0 and paid_at > 0 and (now - paid_at) >= window
            if not expired:
                return json.dumps(
                    {
                        "eligible": False,
                        "reason": "Incident already compensated",
                        "incident_id": str(service["incident_id"]),
                    }
                )
        if str(subscription["last_incident_id"]) == incident_id:
            return json.dumps(
                {"eligible": False, "reason": "Caller already claimed this incident", "incident_id": incident_id}
            )
        if int(cfg["total_fund"]) < int(cfg["compensation_amount"]):
            return json.dumps({"eligible": False, "reason": "Insurance fund cannot cover a payout"})

        return json.dumps({"eligible": True, "reason": "Claim would be accepted", "incident_id": incident_id})

    @gl.public.view
    def get_claim(self, claim_id: int) -> str:
        index = int(claim_id)
        assert 0 <= index < len(self.claims), "Claim does not exist"
        return self.claims[index]

    @gl.public.view
    def get_claims_history(self, limit: int) -> list[str]:
        count = int(limit)
        if count <= 0:
            count = 10
        total = len(self.claims)
        result = []
        index = total - 1
        while index >= 0 and len(result) < count:
            result.append(self.claims[index])
            index = index - 1
        return result

    @gl.public.view
    def get_stats(self) -> str:
        cfg = self._cfg()
        active_services = 0
        open_incidents = 0
        for index in range(len(self.services)):
            record = json.loads(self.services[index])
            if bool(record["active"]):
                active_services = active_services + 1
            if record["incident_state"] == INCIDENT_COMPENSATED:
                open_incidents = open_incidents + 1

        active_policies = 0
        for index in range(len(self.subscriptions)):
            record = json.loads(self.subscriptions[index])
            if bool(record["active"]):
                active_policies = active_policies + 1

        approved = 0
        for index in range(len(self.claims)):
            record = json.loads(self.claims[index])
            if record["status"] == STATUS_APPROVED:
                approved = approved + 1

        return json.dumps(
            {
                "owner": cfg["owner"],
                "total_fund": int(cfg["total_fund"]),
                "total_paid_out": int(cfg["total_paid_out"]),
                "total_premiums": int(cfg["total_premiums"]),
                "compensation_amount": int(cfg["compensation_amount"]),
                "premium_amount": int(cfg["premium_amount"]),
                "incident_window": int(cfg["incident_window"]),
                "claim_cooldown": int(cfg["claim_cooldown"]),
                "paused": bool(cfg["paused"]),
                "monitored": active_services,
                "active_policies": active_policies,
                "compensated_incidents": open_incidents,
                "claims_total": len(self.claims),
                "claims_approved": approved,
                "claims_rejected": len(self.claims) - approved,
            }
        )
