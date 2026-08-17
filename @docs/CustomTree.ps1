# CustomTree.ps1 - generiert einen Verzeichnisbaum

# BasePath wird automatisch erkannt: das Skript liegt in <Projekt>/@DOCS/,
# daher ist das Projekt-Root eine Ebene ueber dem Skript-Ordner.
$BasePath = Split-Path -Parent $PSScriptRoot

# Zum manuellen Ueberschreiben: naechste Zeile einkommentieren und Pfad setzen.
# $BasePath = 'D:\App-Server\wa-transcriber'

$ExcludeCompletely = @(
    'dist',
    'build',
    '.cache',
    '.turbo',
    'coverage',
    'logs',
    'tmp',
    '.DS_Store',
    'Thumbs.db'
)

$ShowFolderOnly = @(
    'node_modules',
    '.git',
    '.next',
	'.venv'
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-CustomTree {
    param (
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [string[]]$ExcludeCompletely = @(),
        [string[]]$ShowFolderOnly = @(),
        [string]$BasePath = ''
    )

    $outputLines = @()

    try {
        $items = Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop |
                 Sort-Object { -not $_.PSIsContainer }, Name
    }
    catch {
        Write-Warning "Zugriff auf '$Path' nicht möglich: $($_.Exception.Message)"
        return $outputLines
    }

    $files = @()
    $subDirs = @()

    foreach ($item in $items) {
        $itemName = $item.Name

        if ($ExcludeCompletely -contains $itemName) { continue }

        if ($item.PSIsContainer) {
            $subDirs += $item
        } else {
            $files += $itemName
        }
    }

    $relPath = $Path.Substring($BasePath.Length).TrimStart('\').Replace('\', '/')
    if ($relPath -eq '') { $relPath = '.' }

    $outputLines += "$relPath/:" + ($files -join ',')

    foreach ($dir in $subDirs) {
        if ($ShowFolderOnly -contains $dir.Name) {
            $dirRel = $dir.FullName.Substring($BasePath.Length).TrimStart('\').Replace('\', '/')
            $outputLines += "$dirRel/:"
        } else {
            $outputLines += Get-CustomTree -Path $dir.FullName -ExcludeCompletely $ExcludeCompletely -ShowFolderOnly $ShowFolderOnly -BasePath $BasePath
        }
    }

    return $outputLines
}

# ------------------- Skriptstart -------------------

try {
    $resolvedBase = Resolve-Path -LiteralPath $BasePath -ErrorAction Stop
}
catch {
    Write-Error "Der Basisordner '$BasePath' existiert nicht: $($_.Exception.Message)"
    exit 1
}

$treeOutput = @()
$treeOutput += "# FORMAT: <ordnerpfad>/:<datei1>,<datei2>,...  | Pro Zeile EIN Ordner mit Relativpfad ab Root, danach Doppelpunkt und kommagetrennt seine direkten Dateien. Leere Dateiliste = Ordner ohne direkte Dateien (nur Unterordner) oder ausgeblendeter Inhalt. Jeder Dateipfad ist voll bestimmt durch Ordnerpfad + Dateiname."
$treeOutput += "Root: $($resolvedBase.Path)"
$treeOutput += Get-CustomTree -Path $resolvedBase.Path -ExcludeCompletely $ExcludeCompletely -ShowFolderOnly $ShowFolderOnly -BasePath $resolvedBase.Path

$treeOutput | Out-Host

try {
    $treeOutput | Set-Clipboard
    Write-Host ""
    Write-Host "Der Verzeichnisbaum wurde in die Zwischenablage kopiert." -ForegroundColor Green
}
catch {
    Write-Warning "Konnte nicht in die Zwischenablage kopieren: $($_.Exception.Message)"
}

try { Read-Host -Prompt "Drücke Enter, um das Fenster zu schließen..." | Out-Null } catch { }
