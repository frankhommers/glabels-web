"""Printers: adding, choosing, removing, and following jobs.

The printers live in our own list; state and jobs are queried directly from
the printer. No print service sits in between.
"""

from __future__ import annotations

import logging

from anyio import to_thread
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from ..printing import Printer, PrintingError, PrintingUnavailable
from ..printing.ipp_client import JOB_STATE_NAMES, UNKNOWN_STATE
from .deps import AppState, state

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/printers", tags=["printers"])


class PrinterOut(BaseModel):
    name: str
    uri: str
    info: str = ""
    location: str = ""
    is_default: bool = False
    # Queried live from the printer; empty when it does not respond.
    state: str = ""
    # IPP printer-state (3 idle, 4 processing, 5 stopped); 0 when unreachable.
    state_code: int = 0
    state_message: str = ""
    accepting: bool = False
    make_and_model: str = ""
    reachable: bool = False


class PrinterListOut(BaseModel):
    available: bool
    message: str | None = None
    printers: list[PrinterOut] = Field(default_factory=list)


class ProbeRequest(BaseModel):
    uri: str = Field(max_length=512)


class ProbeOut(BaseModel):
    reachable: bool
    uri: str
    name: str = ""
    make_and_model: str = ""
    state: str = ""
    state_code: int = 0
    accepting: bool = False
    document_formats: list[str] = Field(default_factory=list)
    media: list[str] = Field(default_factory=list)
    media_ready: list[str] = Field(default_factory=list)
    resolutions: list[str] = Field(default_factory=list)
    accepts_pdf: bool = False
    problems: list[str] = Field(default_factory=list)


class AddPrinterRequest(BaseModel):
    name: str = Field(max_length=127)
    uri: str = Field(max_length=512)
    info: str = Field(default="", max_length=255)
    location: str = Field(default="", max_length=255)


# IPP job-state: 3 pending, 4 held, 5 processing, 6 stopped, 7 canceled,
# 8 aborted, 9 completed. With 3 and 5 something is happening the interface
# can wait for; 4 and 6 wait for a human.
ACTIVE_JOB_STATES = {3, 5}


class JobOut(BaseModel):
    request_id: str
    job_id: int
    printer: str
    title: str
    created_at: str
    state: str = ""
    # The IPP code, so the interface can show the state in its own language.
    # 0 when the printer reported nothing.
    state_code: int = 0
    state_message: str = ""
    reachable: bool = False
    finished: bool = False
    # Is the job still pending or processing? Then it is worth asking again.
    active: bool = False


class JobListOut(BaseModel):
    items: list[JobOut]
    total: int


class ClearJobsOut(BaseModel):
    removed: int


def _base(printer: Printer) -> PrinterOut:
    return PrinterOut(
        name=printer.name,
        uri=printer.uri,
        info=printer.info,
        location=printer.location,
        is_default=printer.is_default,
    )


@router.get("", response_model=PrinterListOut)
async def list_printers(
    status: bool = Query(True, description="Ask the printers for their state"),
    app: AppState = Depends(state),
) -> PrinterListOut:
    if not app.printers.available():
        return PrinterListOut(
            available=False,
            message=f"{app.printers.tool} is missing from this installation; printing is not possible",
        )

    printers = app.registry.list()
    if not status:
        return PrinterListOut(available=True, printers=[_base(printer) for printer in printers])

    def probe_all() -> list[PrinterOut]:
        result = []
        for printer in printers:
            out = _base(printer)
            try:
                probe = app.printers.probe(printer.uri, timeout=4)
            except PrintingError as exc:
                log.warning("could not fetch the state of %s: %s", printer.name, exc)
                probe = None
            if probe is not None and probe.reachable:
                out = out.model_copy(
                    update={
                        "state": probe.state,
                        "state_code": probe.state_code,
                        "accepting": probe.accepting,
                        "make_and_model": probe.make_and_model,
                        "reachable": True,
                        "state_message": "; ".join(probe.problems),
                    }
                )
            else:
                out = out.model_copy(
                    update={"state": "unreachable", "state_message": "the printer does not respond"}
                )
            result.append(out)
        return result

    return PrinterListOut(available=True, printers=await to_thread.run_sync(probe_all))


@router.post("/probe", response_model=ProbeOut)
async def probe(request: ProbeRequest, app: AppState = Depends(state)) -> ProbeOut:
    """Check whether the destination is reachable and what it supports."""
    try:
        result = await to_thread.run_sync(app.printers.probe, request.uri)
    except PrintingUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except PrintingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ProbeOut(**result.__dict__)


@router.post("", response_model=PrinterOut, status_code=201)
async def add_printer(request: AddPrinterRequest, app: AppState = Depends(state)) -> PrinterOut:
    """Add a printer, but only if it is usable.

    Without a conversion service we can only send PDF; a printer that does not
    accept it would just sit there without ever being able to print.
    """
    try:
        result = await to_thread.run_sync(app.printers.probe, request.uri)
    except PrintingUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except PrintingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if not result.reachable:
        raise HTTPException(
            status_code=422,
            detail="the printer is not reachable: " + ("; ".join(result.problems) or "unknown cause"),
        )
    if not result.accepts_pdf:
        raise HTTPException(
            status_code=422,
            detail=(
                "this printer does not accept PDF. This installation sends PDF straight to the "
                "printer and converts nothing, so printing would not work."
            ),
        )

    try:
        printer = app.registry.add(
            request.name, request.uri, info=request.info, location=request.location
        )
    except PrintingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    log.info("printer added: %s -> %s", printer.name, printer.uri)
    return _base(printer).model_copy(
        update={
            "state": result.state,
            "state_code": result.state_code,
            "accepting": result.accepting,
            "make_and_model": result.make_and_model,
            "reachable": True,
        }
    )


@router.delete("/{name}", status_code=204)
async def remove_printer(name: str, app: AppState = Depends(state)) -> Response:
    try:
        app.registry.remove(name)
    except PrintingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=204)


@router.post("/{name}/default", response_model=PrinterListOut)
async def set_default(name: str, app: AppState = Depends(state)) -> PrinterListOut:
    try:
        app.registry.set_default(name)
    except PrintingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return await list_printers(status=False, app=app)


def _finished_out(record) -> JobOut:
    return JobOut(
        request_id=record.request_id,
        job_id=record.job_id,
        printer=record.printer,
        title=record.title,
        created_at=record.created_at,
        state=JOB_STATE_NAMES.get(record.final_state_code, ""),
        state_code=record.final_state_code,
        state_message=record.final_reasons,
        reachable=True,
        finished=True,
    )


@router.get("/jobs", response_model=JobListOut)
async def list_jobs(
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
    app: AppState = Depends(state),
) -> JobListOut:
    """Jobs sent, newest first, with their state.

    A finished job has a recorded final state; we do not ask for it again.
    Only the rest goes past the printer, and a printer that does not answer
    is tried only once per call.
    """
    app.store.prune_print_requests()
    records = app.store.recent_print_requests(limit, offset)
    total = app.store.count_print_requests()

    def collect() -> list[JobOut]:
        result = []
        unreachable: dict[str, str] = {}
        for record in records:
            if record.finished:
                result.append(_finished_out(record))
                continue
            out = JobOut(
                request_id=record.request_id,
                job_id=record.job_id,
                printer=record.printer,
                title=record.title,
                created_at=record.created_at,
            )
            if not record.printer_uri:
                result.append(out)
                continue
            if record.printer_uri in unreachable:
                result.append(
                    out.model_copy(
                        update={"state": UNKNOWN_STATE, "state_message": unreachable[record.printer_uri]}
                    )
                )
                continue
            try:
                status = app.printers.job_status(record.printer_uri, record.job_id)
            except PrintingError as exc:
                unreachable[record.printer_uri] = str(exc)
                result.append(out.model_copy(update={"state": UNKNOWN_STATE, "state_message": str(exc)}))
                continue
            reasons = ", ".join(status.reasons)
            if status.finished:
                app.store.finish_print_request(record.request_id, status.state_code, reasons)
            result.append(
                out.model_copy(
                    update={
                        "state": status.state,
                        "state_code": status.state_code,
                        "state_message": reasons,
                        "reachable": True,
                        "finished": status.finished,
                        "active": status.state_code in ACTIVE_JOB_STATES,
                    }
                )
            )
        return result

    return JobListOut(items=await to_thread.run_sync(collect), total=total)


@router.post("/jobs/clear", response_model=ClearJobsOut)
def clear_jobs(app: AppState = Depends(state)) -> ClearJobsOut:
    """Clean up the history; jobs that may still be running stay."""
    return ClearJobsOut(removed=app.store.clear_finished_print_requests())


@router.delete("/jobs/{request_id}", status_code=204)
async def cancel_job(request_id: str, app: AppState = Depends(state)) -> Response:
    record = app.store.find_print_request(request_id)
    if record is None:
        raise HTTPException(status_code=404, detail="unknown job")

    def work():
        app.printers.cancel(record.printer_uri, record.job_id)

    try:
        await to_thread.run_sync(work)
    except PrintingUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except PrintingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(status_code=204)
