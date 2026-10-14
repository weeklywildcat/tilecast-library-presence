"""Build the standard Tilecast OCI image layout from the bounded build tree."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import tarfile

root = Path(__file__).resolve().parents[1]
build = root / "build"
layout = build / "oci"
blobs = layout / "blobs" / "sha256"
blobs.mkdir(parents=True, exist_ok=True)

def compact(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()

def blob(data, media_type):
    digest = hashlib.sha256(data).hexdigest()
    (blobs / digest).write_bytes(data)
    return {"mediaType": media_type, "digest": "sha256:" + digest, "size": len(data)}

manifest = json.loads((build / "tilecast.package.json").read_text())
archive = io.BytesIO()
paths = ["plugin/tilecast.plugin.json", "plugin/runtime/index.js", "runtime/library_presence.wasm", "studio/index.html"]
with gzip.GzipFile(fileobj=archive, mode="wb", mtime=0) as compressed:
    with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for path in paths:
            data = (build / path).read_bytes()
            if len(data) > 16 * 1024 * 1024:
                raise ValueError("Package file exceeds its bound")
            info = tarfile.TarInfo(path)
            info.size, info.mode, info.mtime = len(data), 0o644, 0
            tar.addfile(info, io.BytesIO(data))

artifact = "application/vnd.tilecast.package.v1+json"
image = {"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json", "artifactType": artifact,
         "config": blob(compact(manifest), "application/vnd.tilecast.package.config.v1+json"),
         "layers": [blob(archive.getvalue(), "application/vnd.tilecast.package.content.v1.tar+gzip")]}
descriptor = blob(compact(image), image["mediaType"])
descriptor.update({"artifactType": artifact, "annotations": {"org.opencontainers.image.ref.name": "package"}})
(layout / "oci-layout").write_bytes(compact({"imageLayoutVersion": "1.0.0"}))
(layout / "index.json").write_bytes(compact({"schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json", "manifests": [descriptor]}))
(build / "artifact-digest.txt").write_text(descriptor["digest"] + "\n")
print(descriptor["digest"])
