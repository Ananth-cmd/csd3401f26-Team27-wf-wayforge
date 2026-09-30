param([string]$UnityData = 'C:/Program Files/Unity/Hub/Editor/6000.0.70f1/Editor/Data')
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$output = Join-Path $project 'Library/SourceChecks'
New-Item -ItemType Directory -Force $output | Out-Null
$refs = @(Get-ChildItem "$UnityData/UnityReferenceAssemblies/unity-4.8-api" -Filter '*.dll') + @(Get-ChildItem "$UnityData/UnityReferenceAssemblies/unity-4.8-api/Facades" -Filter '*.dll') + @(Get-ChildItem "$UnityData/Managed/UnityEngine" -Filter 'UnityEngine*.dll') + @(Get-ChildItem "$UnityData/Managed" -Filter 'UnityEditor*.dll')
$refs += Get-Item "$project/Library/ScriptAssemblies/UnityEngine.UI.dll"
$sources = @(Get-ChildItem "$project/Assets/WayforgeApp" -Recurse -Filter '*.cs') + @(Get-ChildItem "$project/../unity/Assets/WayforgeAppBridge" -Recurse -Filter '*.cs')
$arguments = @('-nologo','-target:library','-nostdlib+','-langversion:9.0', ('-out:"' + $output + '/SourceCheck.dll"')) + @($refs | ForEach-Object { '-r:"' + $_.FullName + '"' }) + @($sources | ForEach-Object { '"' + $_.FullName + '"' })
$arguments | Set-Content "$output/compile.rsp"
& "$UnityData/NetCoreRuntime/dotnet.exe" "$UnityData/DotNetSdkRoslyn/csc.dll" "@$output/compile.rsp"
if ($LASTEXITCODE -ne 0) { throw 'Unity API compilation failed.' }
Write-Output 'SOURCE_COMPILE_OK: runtime, editor setup, and export bridge compiled against Unity 6.'

# .NET SDK provides a host for the managed routing checks; no NuGet packages are needed.
$dotnetRoot = Split-Path (Get-Command dotnet).Source -Parent
$refVersion = Get-ChildItem "$dotnetRoot/packs/Microsoft.NETCore.App.Ref" -Directory | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
$refDir = Get-ChildItem "$($refVersion.FullName)/ref" -Directory | Select-Object -First 1
$coreRefs = Get-ChildItem $refDir.FullName -Filter '*.dll'
$arguments = @('-nologo','-target:exe','-nostdlib+', ('-out:"' + $output + '/RouteChecks.dll"')) + @($coreRefs | ForEach-Object { '-r:"' + $_.FullName + '"' }) + @('-r:"' + $UnityData + '/Managed/UnityEngine/UnityEngine.CoreModule.dll"', '"' + $project + '/Assets/WayforgeApp/Runtime/BuildingDefinition.cs"', '"' + $PSScriptRoot + '/RouteChecks.cs"')
$arguments | Set-Content "$output/routes.rsp"
& "$UnityData/NetCoreRuntime/dotnet.exe" "$UnityData/DotNetSdkRoslyn/csc.dll" "@$output/routes.rsp"
if ($LASTEXITCODE -ne 0) { throw 'Route check compilation failed.' }
Copy-Item "$UnityData/Managed/UnityEngine/UnityEngine.CoreModule.dll" "$output/UnityEngine.CoreModule.dll" -Force
$major = ([version]$refVersion.Name).Major
@{runtimeOptions=@{tfm="net$major.0";framework=@{name='Microsoft.NETCore.App';version="$major.0.0"}}} | ConvertTo-Json -Depth 4 | Set-Content "$output/RouteChecks.runtimeconfig.json"
& dotnet "$output/RouteChecks.dll"
if ($LASTEXITCODE -ne 0) { throw 'Route checks failed.' }

