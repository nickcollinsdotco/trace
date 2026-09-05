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

## They must land beside the exe, not in a subfolder

The first version of this shipped them to `$INSTDIR\redist\` and achieved
nothing: the loader searches the *application directory*, not subfolders of
it, so all five were still resolved from System32 and a clean machine would
have failed exactly as before. `bundle.resources` therefore uses the map
form, targeting the install root.

It looked correct because it was verified in the wrong place — DLLs copied
next to `target/release/trace.exe` by hand, which is not a layout the
installer ever produces. **Check the installed application's loaded module
paths, not a staged directory.**

## DirectML.dll is committed, and why

It is a build artefact of `ort`, 17.7 MB, and a *load-time* import of
`trace.exe` — without it the app does not start at all. It cannot be staged
during the build, because Tauri validates `bundle.resources` at compile time
and the file is produced by that same compile. There is no point in the build
where staging works, so committing it is what breaks the circle.

The cost of committing an artefact is drift, so `scripts/stage-runtime.mjs`
runs at bundle time, compares the committed copy against the fresh build
output, and refreshes it loudly if `ort` ever produces a different binary.

## Refreshing

Copy the four files from the path above after a Visual Studio update, then
re-run `dumpbin /DEPENDENTS` on the release binary to confirm the set has not
grown.
