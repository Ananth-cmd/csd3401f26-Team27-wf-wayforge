$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$assets = Join-Path $project 'Assets/WayforgeApp'
$archive = Join-Path $project 'Archive/PreviousPrototype'
function Move-ProjectFile([string]$source,[string]$destination) {
    $source=[IO.Path]::GetFullPath($source)
    $destination=[IO.Path]::GetFullPath($destination)
    if (!$source.StartsWith($project+[IO.Path]::DirectorySeparatorChar) -or !$destination.StartsWith($project+[IO.Path]::DirectorySeparatorChar)) { throw 'Move outside project refused.' }
    if(Test-Path -LiteralPath $destination) { throw "Destination exists: $destination" }
    New-Item -ItemType Directory -Force (Split-Path $destination -Parent) | Out-Null
    Move-Item -LiteralPath $source -Destination $destination
    if(Test-Path -LiteralPath ($source+'.meta')) { Move-Item -LiteralPath ($source+'.meta') -Destination ($destination+'.meta') }
}
foreach($relative in @('Editor/CanvasDesigner.cs','Editor/ImportedFloorsSetup.cs','Editor/ImportedNavigationSetup.cs','Editor/PrototypeVisualCheck.cs','Runtime/NavigationApp.cs','Runtime/DemoBuilding.cs','Scenes/Navigation.unity','Resources/App.uss','Resources/AppTheme.tss','Resources/MapMaterial.mat','Designer/Data/SIT Campus.asset','Designer/Prefabs/Level 1.prefab','Designer/Prefabs/Level 2.prefab','Designer/Prefabs/Level 3.prefab')) {
    Move-ProjectFile (Join-Path $assets $relative) (Join-Path $archive $relative)
}
New-Item -ItemType Directory -Force (Join-Path $archive 'Editor') | Out-Null
Copy-Item -LiteralPath (Join-Path $assets 'Editor/PrototypeSetup.cs') -Destination (Join-Path $archive 'Editor/PrototypeSetup.cs')
Copy-Item -LiteralPath (Join-Path $assets 'Runtime/BuildingMap.cs') -Destination (Join-Path $archive 'BuildingMap-original.cs')
Move-ProjectFile (Join-Path $assets 'Designer/Scenes/SIT-Editable.unity') (Join-Path $assets 'Scenes/Main.unity')
Move-ProjectFile (Join-Path $assets 'Runtime') (Join-Path $assets 'Scripts')
Move-ProjectFile (Join-Path $assets 'Designer') (Join-Path $assets 'UI')
Move-ProjectFile (Join-Path $assets 'ImportedModels') (Join-Path $assets 'Models')
Move-ProjectFile (Join-Path $assets 'Editor/CanvasFlowCheck.cs') (Join-Path $assets 'Editor/Checks/CanvasFlowCheck.cs')
Write-Output 'PROJECT_ORGANIZED: original files retained under Archive/PreviousPrototype.'
