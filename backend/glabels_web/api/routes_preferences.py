"""Preferences of this installation: region and unit."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..preferences import UNITS, PreferenceError
from .deps import AppState, state

router = APIRouter(prefix="/api/preferences", tags=["preferences"])


class PreferencesOut(BaseModel):
    # Empty means: follow the browser's language setting.
    locale: str = ""
    unit: str = "mm"
    units: list[str] = Field(default_factory=lambda: list(UNITS))


class PreferencesIn(BaseModel):
    locale: str | None = Field(default=None, max_length=20)
    unit: str | None = None


@router.get("", response_model=PreferencesOut)
def read(app: AppState = Depends(state)) -> PreferencesOut:
    current = app.preferences.get()
    return PreferencesOut(locale=current.locale, unit=current.unit)


@router.put("", response_model=PreferencesOut)
def write(request: PreferencesIn, app: AppState = Depends(state)) -> PreferencesOut:
    try:
        saved = app.preferences.save(locale=request.locale, unit=request.unit)
    except PreferenceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return PreferencesOut(locale=saved.locale, unit=saved.unit)
