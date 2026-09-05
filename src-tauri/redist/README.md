# Visual C++ runtime, shipped app-local

`trace.exe` links `MSVCP140.dll` and `MSVCP140_1.dll` — pulled in by ONNX
Runtime, which is C++ — and those in turn need `VCRUNTIME140.dll` and
`VCRUNTIME140_1.dll`. **None of the four is present on a clean Windows
install.** Without them the app fails to start with "MSVCP140.dll was not
found", before any of its own code runs.

Found by reading `dumpbin /DEPENDENTS` on the release binary, not by testing
on a clean machine — worth recording, because this is invisible on any
machine with Visual Studio or the redistributable already installed, which is
every machine a developer is likely to have.

## Why app-local rather than the redistributable installer

TRACE is meant to work with no network after first setup. Bundling the
redistributable installer, or fetching it during install, both undercut that.
App-local deployment is explicitly supported by Microsoft for the CRT, the
DLL search order prefers the application directory, and it keeps a TRACE
install entirely self-contained.

**The trade-off, stated plainly:** these copies do not receive Windows Update
security fixes. They have to be refreshed by hand when the toolchain updates.
That is a real cost, and the reason to revisit this if TRACE is ever
distributed widely.

## What is here, and where it came from

Version 14.51.36247.0, from the Visual Studio Build Tools redistributable
directory:

```
VC\Redist\MSVC\14.51.36231\x64\Microsoft.VC145.CRT\
```

That directory is the correct source — not `System32`, whose copies are
serviced by the OS and are not licensed for redistribution.

`DirectML.dll` needs none of these; it is statically linked. The
`api-ms-win-crt-*` imports are the Universal CRT, part of Windows since 10
1709, so they are not bundled either.

## Refreshing

Copy the four files from the path above after a Visual Studio update, then
re-run `dumpbin /DEPENDENTS` on the release binary to confirm the set has not
grown.
