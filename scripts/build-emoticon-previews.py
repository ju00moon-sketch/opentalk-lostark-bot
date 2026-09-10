"""Build private, wide Kakao card images without changing their source files.

Run locally with Python and Pillow, then upload the generated directory beside
assets/emoticons. The bot server does not need Python or Pillow.
"""
import hashlib
import io
import json
import re
from pathlib import Path

from PIL import Image, ImageOps, ImageSequence

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "emoticons"
OUTPUT = ROOT / "assets" / "emoticon-previews"
VERSION = b"kakao-emoticon-preview-v1\0"
EXTENSIONS = {".png", ".gif", ".jpg", ".jpeg", ".webp"}
KEYWORD = re.compile(r"[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]{1,20}\Z")


def compose(frame):
    image = ImageOps.exif_transpose(frame).convert("RGBA")
    image = ImageOps.contain(image, (760, 376), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (800, 400), "white")
    canvas.alpha_composite(image, ((800 - image.width) // 2, (400 - image.height) // 2))
    return canvas.convert("RGB")


def build():
    if not SOURCE.is_dir():
        raise RuntimeError("The source image directory is missing")
    if OUTPUT.is_symlink():
        raise RuntimeError("The preview directory must not be a symbolic link")
    OUTPUT.mkdir(exist_ok=True)
    if OUTPUT.resolve() != OUTPUT.parent.resolve() / OUTPUT.name:
        raise RuntimeError("The preview directory must not point to another directory")
    results = []
    for source in sorted(SOURCE.iterdir()):
        if source.suffix.lower() not in EXTENSIONS or not KEYWORD.fullmatch(source.stem):
            continue
        if source.is_symlink() or not source.is_file() or source.resolve().parent != SOURCE.resolve():
            raise RuntimeError(f"Not a direct source file: {source.name}")
        data = source.read_bytes()
        revision = hashlib.sha256(VERSION + data).hexdigest()[:16]
        with Image.open(io.BytesIO(data)) as image:
            frames = []
            durations = []
            for frame in ImageSequence.Iterator(image):
                frame.load()
                durations.append(frame.info.get("duration", 100))
                frames.append(compose(frame))
            animated = len(frames) > 1
            extension = ("gif" if image.format == "GIF" else "webp") if animated else "png"
            output = OUTPUT / f"{source.stem}-{revision}.{extension}"
            if output.is_symlink():
                raise RuntimeError(f"Preview destination must not be a symbolic link: {output.name}")
            temporary = output.with_suffix(output.suffix + ".tmp")
            if temporary.exists() or temporary.is_symlink():
                raise RuntimeError(f"Preview temporary file already exists: {temporary.name}")
            if extension == "gif":
                repeat = {"loop": image.info["loop"]} if "loop" in image.info else {}
                frames[0].save(temporary, format="GIF", save_all=True, append_images=frames[1:],
                               duration=durations, disposal=2, optimize=False, **repeat)
            elif animated:
                frames[0].save(temporary, format="WEBP", save_all=True, append_images=frames[1:],
                               duration=durations, loop=image.info.get("loop", 0), lossless=True)
            else:
                frames[0].save(temporary, format="PNG", optimize=True)
            temporary.replace(output)
            with Image.open(output) as encoded:
                frame_count = encoded.n_frames
            results.append({"source": source.name, "sourceSha256": hashlib.sha256(data).hexdigest(),
                            "preview": output.name, "previewSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                            "width": 800, "height": 400, "sourceFrames": len(frames), "frames": frame_count,
                            "durationMs": sum(durations) if animated else None})
    print(json.dumps({"count": len(results), "images": results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    build()
