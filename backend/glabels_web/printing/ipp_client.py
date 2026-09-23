"""Talking to an IPP printer directly.

There is no print service in the container. The backend sends the PDF itself
as an IPP ``Print-Job`` and asks for the state afterwards. The IPP requests
live as ``.test`` files next to this module and are run with ``ipptool``,
which returns its answer as a plist.

A consequence of this choice: there is no queue that holds jobs and no
conversion from PDF to another format. A printer that does not accept PDF is
therefore refused when adding it, rather than a print silently coming out
differently later.
"""

from __future__ import annotations

import logging
import plistlib
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from .media import choose_media

log = logging.getLogger(__name__)

REQUESTS_DIR = Path(__file__).parent / "ipp"

ALLOWED_SCHEMES = ("ipp", "ipps")
PDF_FORMAT = "application/pdf"

# Names may be shown in a URL and in the interface; keep them simple.
_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,127}$")

# IPP printer-state and job-state. The interface translates by code; these
# names are for logs and for clients of the API.
PRINTER_STATE_NAMES = {3: "idle", 4: "processing", 5: "stopped"}
JOB_STATE_NAMES = {
    3: "pending",
    4: "held",
    5: "processing",
    6: "stopped",
    7: "canceled",
    8: "aborted",
    9: "completed",
}
FINISHED_JOB_STATES = {7, 8, 9}
UNKNOWN_STATE = "unknown"


class PrintingError(RuntimeError):
    """A printer operation failed."""


class PrintingUnavailable(PrintingError):
    """The tools needed are missing from this installation."""


@dataclass(frozen=True)
class ProbeResult:
    """What the printer itself says it supports."""

    reachable: bool
    uri: str
    name: str = ""
    make_and_model: str = ""
    state: str = ""
    state_code: int = 0
    accepting: bool = False
    document_formats: list[str] = field(default_factory=list)
    media: list[str] = field(default_factory=list)
    media_ready: list[str] = field(default_factory=list)
    resolutions: list[str] = field(default_factory=list)
    accepts_pdf: bool = False
    problems: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class JobStatus:
    job_id: int
    state: str
    state_code: int
    reasons: list[str] = field(default_factory=list)
    name: str = ""
    impressions_completed: int = 0

    @property
    def finished(self) -> bool:
        return self.state_code in FINISHED_JOB_STATES


def validate_name(name: str) -> str:
    cleaned = (name or "").strip()
    if not _NAME_RE.match(cleaned):
        raise PrintingError(
            "invalid printer name; use letters, digits, dot, hyphen or underscore"
        )
    return cleaned


def validate_uri(uri: str) -> str:
    cleaned = (uri or "").strip()
    parts = urlsplit(cleaned)
    if parts.scheme not in ALLOWED_SCHEMES:
        raise PrintingError("only ipp:// and ipps:// destinations are supported")
    if not parts.hostname:
        raise PrintingError("the printer URI has no host name")
    if not parts.path or parts.path == "/":
        raise PrintingError("the printer URI has no path; usually that is /ipp/print")
    return cleaned


def _as_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return [str(value)]


def _as_int(value: object, default: int = 0) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


class IppClient:
    def __init__(self, *, timeout: int = 15, tool: str = "ipptool"):
        self._timeout = timeout
        self._tool = tool

    @property
    def tool(self) -> str:
        return self._tool

    def available(self) -> bool:
        try:
            subprocess.run([self._tool, "--version"], capture_output=True, timeout=5, check=False)
        except (FileNotFoundError, subprocess.SubprocessError):
            return False
        return True

    # ------------------------------------------------------------- running
    def _run(
        self,
        uri: str,
        request: str,
        *,
        variables: dict[str, str] | None = None,
        input_file: Path | None = None,
        timeout: int | None = None,
    ) -> dict[str, object]:
        """Run one IPP request and return the response attributes."""
        request_file = REQUESTS_DIR / request
        if not request_file.is_file():
            raise PrintingUnavailable(f"IPP request missing: {request}")

        seconds = timeout or self._timeout
        command = [self._tool, "-T", str(seconds), "-X"]
        for key, value in (variables or {}).items():
            command += ["-d", f"{key}={value}"]
        if input_file is not None:
            command += ["-f", str(input_file)]
        command += [uri, str(request_file)]

        try:
            completed = subprocess.run(
                command, capture_output=True, timeout=seconds + 10, check=False
            )
        except FileNotFoundError as exc:
            raise PrintingUnavailable(f"{self._tool} is not available in this installation") from exc
        except subprocess.TimeoutExpired as exc:
            raise PrintingError("the printer did not respond in time") from exc

        try:
            report = plistlib.loads(completed.stdout)
            test = report["Tests"][0]
        except Exception as exc:
            detail = completed.stderr.decode("utf-8", "replace").strip()
            raise PrintingError(detail or "unreadable answer from the printer") from exc

        if not test.get("Successful"):
            raise PrintingError(_describe_failure(test))

        attributes: dict[str, object] = {}
        for group in test.get("ResponseAttributes", []):
            attributes.update(group)
        return attributes

    # ------------------------------------------------------------- queries
    def probe(self, uri: str, *, timeout: int = 8) -> ProbeResult:
        """Ask the printer itself what it supports.

        IPP transport alone says nothing about the formats and media a printer
        really handles; that is what we fetch here.
        """
        uri = validate_uri(uri)
        try:
            attributes = self._run(uri, "get-printer-attributes.test", timeout=timeout)
        except PrintingUnavailable:
            raise
        except PrintingError as exc:
            return ProbeResult(reachable=False, uri=uri, problems=[str(exc)])

        formats = _as_list(attributes.get("document-format-supported"))
        media = _as_list(attributes.get("media-supported"))
        accepting = bool(attributes.get("printer-is-accepting-jobs", False))
        state_code = _as_int(attributes.get("printer-state"))

        problems: list[str] = []
        accepts_pdf = PDF_FORMAT in formats
        if not accepts_pdf:
            problems.append(
                "this printer does not accept PDF. No conversion service runs, so printing "
                "would not work."
            )
        if not media:
            problems.append("the printer reports no media sizes")
        if not accepting:
            problems.append("the printer is not accepting jobs right now")
        for reason in _as_list(attributes.get("printer-state-reasons")):
            if reason and reason != "none":
                problems.append(f"message from the printer: {reason}")

        return ProbeResult(
            reachable=True,
            uri=uri,
            name=str(attributes.get("printer-name", "")),
            make_and_model=str(attributes.get("printer-make-and-model", "")),
            state=PRINTER_STATE_NAMES.get(state_code, UNKNOWN_STATE),
            state_code=state_code,
            accepting=accepting,
            document_formats=formats,
            media=media,
            media_ready=_as_list(attributes.get("media-ready")),
            resolutions=_as_list(attributes.get("printer-resolution-supported")),
            accepts_pdf=accepts_pdf,
            problems=problems,
        )

    # ---------------------------------------------------------------- jobs
    def media_supported(self, uri: str) -> list[str]:
        uri = validate_uri(uri)
        attributes = self._run(uri, "get-printer-attributes.test")
        return _as_list(attributes.get("media-supported"))

    def print_pdf(
        self,
        uri: str,
        pdf: Path,
        *,
        job_name: str,
        page_size_pt: tuple[float, float] | None = None,
    ) -> JobStatus:
        """Send the PDF to the printer.

        With `page_size_pt` we pick the printer's media size that matches the
        page; see `media.py` for why that is needed. If none matches, it is
        left to the printer — no worse than before.
        """
        uri = validate_uri(uri)
        if not pdf.is_file():
            raise PrintingError("the file to print does not exist")

        variables = {"job-name": job_name[:255]}
        request = "print-job.test"
        if page_size_pt is not None:
            media = choose_media(self.media_supported(uri), page_size_pt)
            if media:
                variables["media"] = media
                request = "print-job-media.test"
            else:
                log.warning(
                    "no media size of %s matches %.1f × %.1f pt; the printer chooses",
                    uri,
                    *page_size_pt,
                )

        attributes = self._run(
            uri,
            request,
            variables=variables,
            input_file=pdf,
            # Sending the document may take longer than a simple question.
            timeout=max(self._timeout, 60),
        )
        return _job_status(attributes)

    def job_status(self, uri: str, job_id: int) -> JobStatus:
        uri = validate_uri(uri)
        attributes = self._run(
            uri, "get-job-attributes.test", variables={"job-id": str(int(job_id))}
        )
        return _job_status(attributes)

    def cancel(self, uri: str, job_id: int) -> None:
        uri = validate_uri(uri)
        self._run(uri, "cancel-job.test", variables={"job-id": str(int(job_id))})


def _job_status(attributes: dict[str, object]) -> JobStatus:
    code = _as_int(attributes.get("job-state"))
    return JobStatus(
        job_id=_as_int(attributes.get("job-id")),
        state=JOB_STATE_NAMES.get(code, UNKNOWN_STATE),
        state_code=code,
        reasons=[
            reason for reason in _as_list(attributes.get("job-state-reasons")) if reason != "none"
        ],
        name=str(attributes.get("job-name", "")),
        impressions_completed=_as_int(attributes.get("job-impressions-completed")),
    )


def _describe_failure(test: dict) -> str:
    """Turn ipptool's output into one understandable message."""
    errors = [str(item) for item in test.get("Errors", [])]

    for error in errors:
        # The printer often sends a useful explanation itself.
        if error.startswith("status-message="):
            return error.split("=", 1)[1].strip('"')

    status = str(test.get("StatusCode", "")).strip()
    if status and status != "successful-ok":
        return f"the printer answered with {status}"
    if errors:
        return errors[0]
    return "the printer gave no usable answer"
