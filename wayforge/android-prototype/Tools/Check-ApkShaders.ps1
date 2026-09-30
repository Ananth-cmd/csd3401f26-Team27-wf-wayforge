param([Parameter(Mandatory=$true)][string]$Apk)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Apk).Path)
try {
    $entry = $archive.GetEntry('assets/bin/Data/Resources/unity_builtin_extra')
    if (!$entry) { throw 'APK has no built-in shader asset.' }
    $stream = $entry.Open()
    $buffer = [IO.MemoryStream]::new()
    try {
        $stream.CopyTo($buffer)
        $serialized = [Text.Encoding]::ASCII.GetString($buffer.ToArray())
        foreach ($shader in @('UI/Default', 'UI/DefaultETC1')) {
            if (!$serialized.Contains($shader + [char]0)) { throw "APK is missing Canvas shader: $shader" }
            Write-Output "APK_SHADER_PRESENT: $shader"
        }
    } finally { $stream.Dispose(); $buffer.Dispose() }
} finally { $archive.Dispose() }
Write-Output 'APK_SHADER_CHECK_OK: required shader names are present in the packaged shader asset. Device rendering still requires a phone check.'
