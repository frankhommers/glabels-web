"""Driving the existing ``glabels-batch-qt`` renderer.

The CLI does not report every failure with a non-zero exit code: for an
unreadable project file ``main()`` does nothing and still exits with 0. So we
always check that a valid PDF was really produced.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

from ..settings import Settings

log = logging.getLogger(__name__)

PDF_MAGIC = b"%PDF-"


class RenderError(RuntimeError):
    def __init__(self, message: str, *, stderr: str = "", returncode: int | None = None):
        super().__init__(message)
        self.stderr = stderr
        self.returncode = returncode


@dataclass(frozen=True)
class RenderRequest:
    """Print settings; identical for preview and printing."""

    # A number of full sheets, or a number of copies from a start position.
    sheets: int | None = None
    copies: int | None = None
    first: int = 1
    outlines: bool = False
    crop_marks: bool = False
    reverse: bool = False
    # Only relevant when merging: collate copies and start every merge group
    # on a new page.
    collate: bool = False
    group_per_page: bool = False
    merge_source: Path | None = None
    variables: dict[str, str] | None = None

    def to_args(self) -> list[str]:
        args: list[str] = []
        if self.sheets is not None:
            args += ["--sheets", str(self.sheets)]
        elif self.copies is not None:
            args += ["--copies", str(self.copies), "--first", str(self.first)]
        if self.outlines:
            args.append("--outlines")
        if self.crop_marks:
            args.append("--crop-marks")
        if self.reverse:
            args.append("--reverse")
        if self.collate:
            args.append("--collate")
        if self.group_per_page:
            args.append("--group")
        for name, value in (self.variables or {}).items():
            if "=" in name:
                raise ValueError(f"invalid variable name: {name!r}")
            args += ["--define", f"{name}={value}"]
        return args


@dataclass(frozen=True)
class RenderResult:
    pdf_path: Path
    stdout: str
    stderr: str
    returncode: int


class Renderer:
    """Runs render jobs with bounded concurrency."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._semaphore = asyncio.Semaphore(max(1, settings.render_max_concurrency))

    @property
    def mode(self) -> str:
        return "docker" if self._settings.batch_docker_image else "local"

    def available(self) -> bool:
        if self._settings.batch_docker_image:
            return shutil.which("docker") is not None
        return Path(self._settings.batch_command).exists()

    async def render_pdf(self, document_path: Path, output_path: Path, request: RenderRequest) -> RenderResult:
        async with self._semaphore:
            return await self._run(document_path, output_path, request)

    async def _run(self, document_path: Path, output_path: Path, request: RenderRequest) -> RenderResult:
        # The renderer only sees a folder of its own: no access to other
        # documents or host files.
        with tempfile.TemporaryDirectory(prefix="glw-render-") as tmp:
            work = Path(tmp)
            job_input = work / "document.glabels"
            job_output = work / "output.pdf"
            shutil.copyfile(document_path, job_input)

            merge_name: str | None = None
            if request.merge_source is not None:
                # Copy under its own name: upstream looks for a relative merge
                # source next to the document file, so this works without
                # --input and the file stays desktop compatible.
                merge_name = request.merge_source.name
                shutil.copyfile(request.merge_source, work / merge_name)

            args = self._command(work, request, merge_name)
            log.info("render: %s", " ".join(args))

            try:
                proc = await asyncio.create_subprocess_exec(
                    *args,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout_b, stderr_b = await asyncio.wait_for(
                    proc.communicate(), timeout=self._settings.render_timeout_seconds
                )
            except asyncio.TimeoutError as exc:
                proc.kill()
                await proc.wait()
                raise RenderError("rendering took too long and was stopped") from exc
            except FileNotFoundError as exc:
                raise RenderError(f"renderer not found: {exc}") from exc

            stdout = stdout_b.decode("utf-8", "replace")
            stderr = stderr_b.decode("utf-8", "replace")
            returncode = proc.returncode if proc.returncode is not None else -1

            if returncode != 0:
                raise RenderError(
                    f"renderer exited with code {returncode}", stderr=stderr, returncode=returncode
                )
            self._verify_pdf(job_output, stderr=stderr, returncode=returncode)

            output_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(job_output), output_path)
            return RenderResult(output_path, stdout, stderr, returncode)

    def _font_mount(self) -> list[str]:
        """Make user fonts available in the render container.

        Fontconfig searches /usr/local/share/fonts by default, so we mount the
        upload folder there read-only.
        """
        fonts_dir = self._settings.fonts_dir
        if not fonts_dir.is_dir():
            return []
        return ["-v", f"{fonts_dir}:/usr/local/share/fonts:ro"]

    def _command(self, work: Path, request: RenderRequest, merge_name: str | None = None) -> list[str]:
        batch_args = request.to_args()
        if merge_name:
            batch_args += [
                "--input",
                f"/work/{merge_name}" if self.mode == "docker" else str(work / merge_name),
            ]

        if image := self._settings.batch_docker_image:
            return [
                "docker", "run", "--rm",
                "--network", "none",
                "--user", f"{os.getuid()}:{os.getgid()}",
                "-v", f"{work}:/work",
                *self._font_mount(),
                image,
                "--output", "/work/output.pdf",
                *batch_args,
                "/work/document.glabels",
            ]
        return [
            self._settings.batch_command,
            "--output", str(work / "output.pdf"),
            *batch_args,
            str(work / "document.glabels"),
        ]

    async def rasterize(self, pdf_path: Path, output_path: Path, *, page: int = 1, dpi: int = 96) -> Path:
        """Turn one page of the PDF into a PNG for display in the browser.

        We show the print itself, not a second rendering that might differ:
        this is the same PDF that goes to the printer.
        """
        async with self._semaphore:
            with tempfile.TemporaryDirectory(prefix="glw-raster-") as tmp:
                work = Path(tmp)
                shutil.copyfile(pdf_path, work / "input.pdf")
                args = self._rasterize_command(work, page=page, dpi=dpi)
                log.info("rasterize: %s", " ".join(args))
                try:
                    proc = await asyncio.create_subprocess_exec(
                        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                    )
                    _, stderr_b = await asyncio.wait_for(
                        proc.communicate(), timeout=self._settings.render_timeout_seconds
                    )
                except asyncio.TimeoutError as exc:
                    proc.kill()
                    await proc.wait()
                    raise RenderError("rasterizing took too long and was stopped") from exc
                except FileNotFoundError as exc:
                    raise RenderError(f"pdftoppm not found: {exc}") from exc

                stderr = stderr_b.decode("utf-8", "replace")
                produced = work / "page.png"
                if proc.returncode != 0 or not produced.exists() or produced.stat().st_size == 0:
                    raise RenderError(
                        "the page preview could not be made",
                        stderr=stderr,
                        returncode=proc.returncode,
                    )
                output_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(produced), output_path)
                return output_path

    def _rasterize_command(self, work: Path, *, page: int, dpi: int) -> list[str]:
        options = [
            "-png",
            "-r", str(dpi),
            "-f", str(page),
            "-l", str(page),
            "-singlefile",
        ]
        if image := self._settings.batch_docker_image:
            return [
                "docker", "run", "--rm",
                "--network", "none",
                "--user", f"{os.getuid()}:{os.getgid()}",
                "-v", f"{work}:/work",
                "--entrypoint", "pdftoppm",
                image,
                *options,
                "/work/input.pdf",
                "/work/page",
            ]
        return ["pdftoppm", *options, str(work / "input.pdf"), str(work / "page")]

    @staticmethod
    def _verify_pdf(path: Path, *, stderr: str, returncode: int) -> None:
        if not path.exists():
            raise RenderError(
                "the renderer produced no PDF; the document probably could not be read",
                stderr=stderr,
                returncode=returncode,
            )
        if path.stat().st_size == 0:
            raise RenderError("the renderer produced an empty file", stderr=stderr, returncode=returncode)
        with path.open("rb") as fh:
            if fh.read(len(PDF_MAGIC)) != PDF_MAGIC:
                raise RenderError(
                    "the output is not a valid PDF", stderr=stderr, returncode=returncode
                )
